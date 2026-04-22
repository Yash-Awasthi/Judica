import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import multipart from "@fastify/multipart";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import { db } from "../lib/drizzle.js";
import { uploads } from "../db/schema/uploads.js";
import { eq, and, desc } from "drizzle-orm";
import { AppError } from "../middleware/errorHandler.js";
import { processFile } from "../processors/router.processor.js";
import { randomUUID } from "crypto";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { pipeline } from "stream/promises";
import logger from "../lib/logger.js";

const uploadsPlugin: FastifyPluginAsync = async (fastify) => {
  const uploadAttempts = new Map<string, { count: number; resetAt: number }>();
  const UPLOAD_RATE_LIMIT = 30;
  const UPLOAD_RATE_WINDOW = 60_000;

  const uploadRateLimit = async (request: FastifyRequest, reply: FastifyReply) => {
    const key = String(request.userId || request.ip || "unknown");
    const now = Date.now();
    const entry = uploadAttempts.get(key);

    if (entry && now < entry.resetAt) {
      if (entry.count >= UPLOAD_RATE_LIMIT) {
        const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
        reply.header("Retry-After", String(retryAfter));
        reply.code(429).send({ error: "Upload rate limit exceeded, try again later." });
        return;
      }
      entry.count++;
    } else {
      uploadAttempts.set(key, { count: 1, resetAt: now + UPLOAD_RATE_WINDOW });
    }

    // Proactive cleanup: always sweep expired entries when map grows large
    if (uploadAttempts.size > 5000) {
      for (const [k, v] of uploadAttempts) {
        if (now >= v.resetAt) uploadAttempts.delete(k);
      }
      // Hard cap: evict oldest entries if still over limit
      if (uploadAttempts.size > 5000) {
        const entries = [...uploadAttempts.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt);
        const excess = uploadAttempts.size - 5000;
        for (let i = 0; i < excess; i++) {
          uploadAttempts.delete(entries[i][0]);
        }
      }
    }
  };

  await fastify.register(multipart, {
    limits: {
      fileSize: 100 * 1024 * 1024, // 100MB
      files: 10,
    },
  });

    // POST /api/uploads — upload up to 10 files
  fastify.post("/", { preHandler: [uploadRateLimit, fastifyRequireAuth] }, async (request, reply) => {
    const userId = request.userId!;
    const parts = request.files();
    const savedFiles: Array<{
      filename: string;
      originalName: string;
      mimeType: string;
      size: number;
      storagePath: string;
    }> = [];

    for await (const part of parts) {
      // SEC-6: Validate uploaded file MIME type against allowlist to prevent
      // upload of executables, scripts, and other dangerous file types.
      const ALLOWED_MIME_PATTERNS = [
        /^image\//,
        /^audio\//,
        /^application\/pdf$/,
        /^text\/plain$/,
        /^text\/csv$/,
        /^text\/markdown$/,
        /^application\/vnd\.openxmlformats-officedocument\./,
        /^application\/msword$/,
        /^application\/vnd\.ms-excel$/,
        /^application\/json$/,
      ];
      if (!ALLOWED_MIME_PATTERNS.some((pattern) => pattern.test(part.mimetype))) {
        throw new AppError(400, `File type not allowed: ${part.mimetype}`, "INVALID_FILE_TYPE");
      }

      const date = new Date().toISOString().split("T")[0];
      const dir = path.join(process.cwd(), "uploads", String(userId), date);
      fs.mkdirSync(dir, { recursive: true });

      const unique = crypto.randomBytes(8).toString("hex");
      const rawExt = path.extname(part.filename);
      // Sanitize extension: only allow alphanumeric chars and dots, max 10 chars
      const ext = /^\.[a-zA-Z0-9]{1,10}$/.test(rawExt) ? rawExt : "";
      const diskFilename = `${unique}${ext}`;
      const storagePath = path.join(dir, diskFilename);

      await pipeline(part.file, fs.createWriteStream(storagePath));

      const stat = fs.statSync(storagePath);
      savedFiles.push({
        filename: diskFilename,
        originalName: part.filename,
        mimeType: part.mimetype,
        size: stat.size,
        storagePath,
      });
    }

    if (savedFiles.length === 0) {
      throw new AppError(400, "No files uploaded", "NO_FILES");
    }

    const records = await Promise.all(
      savedFiles.map(async (f) => {
        const [row] = await db
          .insert(uploads)
          .values({
            id: randomUUID(),
            userId,
            filename: f.filename,
            originalName: f.originalName,
            mimeType: f.mimeType,
            sizeBytes: f.size,
            storagePath: f.storagePath,
          })
          .returning({
            id: uploads.id,
            filename: uploads.filename,
            originalName: uploads.originalName,
            mimeType: uploads.mimeType,
            sizeBytes: uploads.sizeBytes,
          });
        return row;
      })
    );

    return reply.code(201).send({ uploads: records });
  });

    // GET /api/uploads/:id/status
  fastify.get("/:id/status", { preHandler: fastifyRequireAuth }, async (request, _reply) => {
    const { id } = request.params as { id: string };

    const [record] = await db
      .select({
        id: uploads.id,
        processed: uploads.processed,
        extractedText: uploads.extractedText,
        metadata: uploads.metadata,
        mimeType: uploads.mimeType,
        originalName: uploads.originalName,
      })
      .from(uploads)
      .where(and(eq(uploads.id, id), eq(uploads.userId, request.userId!)))
      .limit(1);

    if (!record) throw new AppError(404, "Upload not found", "UPLOAD_NOT_FOUND");

    return {
      id: record.id,
      processed: record.processed,
      extracted_text_length: record.extractedText?.length || 0,
      metadata: record.metadata,
      mimeType: record.mimeType,
      originalName: record.originalName,
    };
  });

    // POST /api/uploads/:id/process — trigger processing
  fastify.post("/:id/process", { preHandler: fastifyRequireAuth }, async (request, _reply) => {
    const { id } = request.params as { id: string };

    const [record] = await db
      .select()
      .from(uploads)
      .where(and(eq(uploads.id, id), eq(uploads.userId, request.userId!)))
      .limit(1);

    if (!record) throw new AppError(404, "Upload not found", "UPLOAD_NOT_FOUND");

    if (record.processed) {
      return { success: true, already_processed: true, extracted_text_length: record.extractedText?.length || 0 };
    }

    try {
      const result = await processFile(record);

      await db
        .update(uploads)
        .set({
          processed: true,
          extractedText: result.text || null,
          metadata: (result.metadata || undefined) as Record<string, unknown> | undefined,
        })
        .where(eq(uploads.id, record.id));

      return { success: true, extracted_text_length: result.text?.length || 0, type: result.type };
    } catch (err: unknown) {
      logger.error({ err, uploadId: record.id }, "File processing failed");
      throw new AppError(500, `Processing failed: ${(err as Error).message}`, "PROCESSING_FAILED");
    }
  });

    // GET /api/uploads/:id/raw — serve file with auth
  fastify.get("/:id/raw", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const [record] = await db
      .select()
      .from(uploads)
      .where(and(eq(uploads.id, id), eq(uploads.userId, request.userId!)))
      .limit(1);

    if (!record) throw new AppError(404, "Upload not found", "UPLOAD_NOT_FOUND");

    // Validate that the resolved path stays within the uploads directory to prevent path traversal
    const uploadsDir = fs.realpathSync(path.resolve(process.cwd(), "uploads"));
    let realPath: string;
    try {
      realPath = fs.realpathSync(record.storagePath);
    } catch {
      throw new AppError(404, "File not found on disk", "FILE_MISSING");
    }
    const relativePath = path.relative(uploadsDir, realPath);
    if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
      throw new AppError(403, "Access denied", "PATH_TRAVERSAL");
    }

    if (!fs.existsSync(record.storagePath)) {
      throw new AppError(404, "File not found on disk", "FILE_MISSING");
    }

    return reply
      .header("Content-Type", record.mimeType)
      .header("Content-Disposition", `inline; filename="${record.originalName.replace(/[^a-zA-Z0-9_.-]/g, "_")}"`)
      .send(fs.createReadStream(record.storagePath));
  });

    // GET /api/uploads — list user's uploads
  fastify.get("/", { preHandler: fastifyRequireAuth }, async (request, _reply) => {
    const rows = await db
      .select({
        id: uploads.id,
        originalName: uploads.originalName,
        mimeType: uploads.mimeType,
        sizeBytes: uploads.sizeBytes,
        processed: uploads.processed,
        createdAt: uploads.createdAt,
      })
      .from(uploads)
      .where(eq(uploads.userId, request.userId!))
      .orderBy(desc(uploads.createdAt))
      .limit(50);

    return { uploads: rows };
  });
};

export default uploadsPlugin;
