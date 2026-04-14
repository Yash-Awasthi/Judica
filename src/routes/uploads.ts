import { FastifyPluginAsync } from "fastify";
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
  await fastify.register(multipart, {
    limits: {
      fileSize: 100 * 1024 * 1024, // 100MB
      files: 10,
    },
  });

  /**
   * @openapi
   * /api/uploads:
   *   post:
   *     summary: Upload files
   *     description: Upload up to 10 files at once. Requires authentication.
   *     tags:
   *       - Uploads
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         multipart/form-data:
   *           schema:
   *             type: object
   *             required:
   *               - files
   *             properties:
   *               files:
   *                 type: array
   *                 items:
   *                   type: string
   *                   format: binary
   *                 maxItems: 10
   *                 description: Files to upload (max 10)
   *     responses:
   *       201:
   *         description: Files uploaded successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 uploads:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       id:
   *                         type: string
   *                       filename:
   *                         type: string
   *                       originalName:
   *                         type: string
   *                       mimeType:
   *                         type: string
   *                       sizeBytes:
   *                         type: integer
   *       400:
   *         description: No files uploaded
   *       401:
   *         description: Unauthorized
   */
  // POST /api/uploads — upload up to 10 files
  fastify.post("/", { preHandler: fastifyRequireAuth }, async (request, reply) => {
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
      const ext = path.extname(part.filename);
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

  /**
   * @openapi
   * /api/uploads/{id}/status:
   *   get:
   *     summary: Get upload processing status
   *     description: Retrieve the processing status and metadata for a specific upload.
   *     tags:
   *       - Uploads
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: The upload ID
   *     responses:
   *       200:
   *         description: Upload status retrieved successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 id:
   *                   type: string
   *                 processed:
   *                   type: boolean
   *                 extracted_text_length:
   *                   type: integer
   *                 metadata:
   *                   type: object
   *                   nullable: true
   *                 mimeType:
   *                   type: string
   *                 originalName:
   *                   type: string
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: Upload not found
   */
  // GET /api/uploads/:id/status
  fastify.get("/:id/status", { preHandler: fastifyRequireAuth }, async (request, reply) => {
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

  /**
   * @openapi
   * /api/uploads/{id}/process:
   *   post:
   *     summary: Trigger file processing
   *     description: Trigger text extraction and processing for a specific upload. Returns immediately if already processed.
   *     tags:
   *       - Uploads
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: The upload ID
   *     responses:
   *       200:
   *         description: Processing result
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 already_processed:
   *                   type: boolean
   *                   description: Present and true if the file was already processed
   *                 extracted_text_length:
   *                   type: integer
   *                 type:
   *                   type: string
   *                   description: The detected file processing type
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: Upload not found
   *       500:
   *         description: Processing failed
   */
  // POST /api/uploads/:id/process — trigger processing
  fastify.post("/:id/process", { preHandler: fastifyRequireAuth }, async (request, reply) => {
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
          metadata: (result.metadata || undefined) as any,
        })
        .where(eq(uploads.id, record.id));

      return { success: true, extracted_text_length: result.text?.length || 0, type: result.type };
    } catch (err: any) {
      logger.error({ err, uploadId: record.id }, "File processing failed");
      throw new AppError(500, `Processing failed: ${err.message}`, "PROCESSING_FAILED");
    }
  });

  /**
   * @openapi
   * /api/uploads/{id}/raw:
   *   get:
   *     summary: Download raw file
   *     description: Serve the original uploaded file with its original MIME type. Requires authentication.
   *     tags:
   *       - Uploads
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: The upload ID
   *     responses:
   *       200:
   *         description: The raw file content
   *         content:
   *           application/octet-stream:
   *             schema:
   *               type: string
   *               format: binary
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: Upload not found or file missing from disk
   */
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
    const uploadsDir = path.resolve(process.cwd(), "uploads");
    const resolvedPath = path.resolve(record.storagePath);
    if (!resolvedPath.startsWith(uploadsDir + path.sep) && resolvedPath !== uploadsDir) {
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

  /**
   * @openapi
   * /api/uploads:
   *   get:
   *     summary: List user uploads
   *     description: Retrieve the authenticated user's most recent uploads (up to 50), ordered by creation date descending.
   *     tags:
   *       - Uploads
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: List of uploads
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 uploads:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       id:
   *                         type: string
   *                       originalName:
   *                         type: string
   *                       mimeType:
   *                         type: string
   *                       sizeBytes:
   *                         type: integer
   *                       processed:
   *                         type: boolean
   *                       createdAt:
   *                         type: string
   *                         format: date-time
   *       401:
   *         description: Unauthorized
   */
  // GET /api/uploads — list user's uploads
  fastify.get("/", { preHandler: fastifyRequireAuth }, async (request, reply) => {
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
