/**
 * Storage Routes
 *
 * Endpoints:
 *   POST   /api/storage/upload       — multipart file upload (auth required)
 *   GET    /api/storage/url/:key     — get signed download URL (auth required)
 *   DELETE /api/storage/:key         — delete file (admin required)
 *   GET    /api/storage/list         — list files by prefix (admin required)
 */

import type { FastifyPluginAsync } from "fastify";
import multipart from "@fastify/multipart";
import { fastifyRequireAuth, fastifyRequireAdmin } from "../middleware/fastifyAuth.js";
import { objectStorage } from "../adapters/objectStorage.adapter.js";
import { AppError } from "../middleware/errorHandler.js";
import logger from "../lib/logger.js";
import crypto from "crypto";

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

const storagePlugin: FastifyPluginAsync = async (fastify) => {
  await fastify.register(multipart, {
    limits: {
      fileSize: MAX_FILE_SIZE_BYTES,
      files: 1,
    },
  });

  // ─── POST /upload — multipart file upload ─────────────────────────────────

  fastify.post(
    "/upload",
    { preHandler: fastifyRequireAuth },
    async (request, reply) => {
      const data = await request.file({ limits: { fileSize: MAX_FILE_SIZE_BYTES } });
      if (!data) {
        throw new AppError(400, "No file provided — send a multipart/form-data request");
      }

      // Read the file stream into a buffer
      const chunks: Buffer[] = [];
      for await (const chunk of data.file) {
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);

      if (data.file.truncated) {
        throw new AppError(413, `File exceeds maximum allowed size of ${MAX_FILE_SIZE_BYTES / 1024 / 1024} MB`);
      }

      const originalName = data.filename ?? "upload";
      const ext = originalName.includes(".") ? originalName.slice(originalName.lastIndexOf(".")) : "";
      const uniqueId = crypto.randomUUID();
      const key = `uploads/${request.userId}/${uniqueId}${ext}`;

      const mimeType = data.mimetype ?? "application/octet-stream";

      logger.info(
        { key, bytes: buffer.length, mimeType, userId: request.userId },
        "StoragePlugin: uploading file",
      );

      const url = await objectStorage.upload(key, buffer, mimeType);

      reply.code(201);
      return { key, url };
    },
  );

  // ─── GET /url/:key — get signed download URL ──────────────────────────────

  fastify.get(
    "/url/:key",
    { preHandler: fastifyRequireAuth },
    async (request, _reply) => {
      const { key } = request.params as { key: string };
      if (!key || key.trim() === "") {
        throw new AppError(400, "key is required");
      }

      const { expiry } = request.query as { expiry?: string };
      const expirySeconds = expiry ? Math.min(Math.max(60, parseInt(expiry, 10) || 3600), 86400) : 3600;

      const url = await objectStorage.getSignedUrl(key, expirySeconds);
      return { key, url, expiresIn: expirySeconds };
    },
  );

  // ─── DELETE /:key — delete file (admin) ───────────────────────────────────

  fastify.delete(
    "/:key",
    { preHandler: fastifyRequireAdmin },
    async (request, reply) => {
      const { key } = request.params as { key: string };
      if (!key || key.trim() === "") {
        throw new AppError(400, "key is required");
      }

      logger.info({ key, adminId: request.userId }, "StoragePlugin: deleting file");

      await objectStorage.delete(key);
      reply.code(204);
    },
  );

  // ─── GET /list — list files by prefix (admin) ─────────────────────────────

  fastify.get(
    "/list",
    { preHandler: fastifyRequireAdmin },
    async (request, _reply) => {
      const { prefix = "" } = request.query as { prefix?: string };
      const keys = await objectStorage.listKeys(prefix);
      return { keys, count: keys.length, prefix };
    },
  );
};

export default storagePlugin;
