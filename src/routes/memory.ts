import type { FastifyPluginAsync } from "fastify";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import { db } from "../lib/drizzle.js";
import { memories, memoryBackends } from "../db/schema/memory.js";
import { eq, count, sql } from "drizzle-orm";
import { AppError } from "../middleware/errorHandler.js";
import { compact } from "../services/memoryCompaction.service.js";
import { getBackend, setBackend, removeBackend, encryptConfig } from "../services/memoryRouter.service.js";
import { summarizeSession } from "../services/sessionSummary.service.js";
import logger from "../lib/logger.js";

const memoryPlugin: FastifyPluginAsync = async (fastify) => {
    // POST /compact — manual memory compaction
  fastify.post("/compact", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const result = await compact(request.userId!);
    return result;
  });

    // GET /stats — memory statistics
  fastify.get("/stats", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const [{ value: chunkCount }] = await db
      .select({ value: count() })
      .from(memories)
      .where(eq(memories.userId, request.userId!));

    // Rough storage estimate (avg 512 chars per chunk)
    const estimatedBytes = chunkCount * 512 * 4; // chars * ~4 bytes per char with embedding

    return {
      chunkCount,
      estimatedStorageMB: Math.round(estimatedBytes / (1024 * 1024) * 100) / 100,
    };
  });

    // DELETE /all — clear all memory (with confirmation)
  fastify.delete("/all", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const { confirm } = request.body as { confirm?: string };
    if (confirm !== "DELETE_ALL_MEMORY") {
      throw new AppError(400, "Must confirm with DELETE_ALL_MEMORY", "CONFIRM_REQUIRED");
    }

    const deleted = await db
      .delete(memories)
      .where(eq(memories.userId, request.userId!))
      .returning();

    return { success: true, deleted: deleted.length };
  });

    // GET /backend — get user's memory backend config
  fastify.get("/backend", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const backend = await getBackend(request.userId!);

    if (!backend) {
      return { type: "local", active: true };
    }

    // Don't expose API keys in full
    const safe = {
      type: backend.type,
      url: backend.url || null,
      collectionName: backend.collectionName || null,
      hasApiKey: !!backend.apiKey,
      active: true,
    };

    return safe;
  });

    // POST /backend — set memory backend
  fastify.post("/backend", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const { type, config } = request.body as { type: string; config?: Record<string, unknown> };

    const validTypes = ["local", "qdrant", "getzep", "google_drive"];
    if (!validTypes.includes(type)) {
      throw new AppError(400, `Type must be one of: ${validTypes.join(", ")}`, "INVALID_BACKEND_TYPE");
    }

    if (type === "local") {
      await removeBackend(request.userId!);
      return { type: "local", active: true };
    }

    await setBackend(request.userId!, type, config || {});
    return { type, active: true };
  });

    // DELETE /backend — reset to local
  fastify.delete("/backend", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    await removeBackend(request.userId!);
    return { type: "local", active: true };
  });

    // POST /summarize/:conversationId — manually trigger session summary
  fastify.post("/summarize/:conversationId", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const { conversationId } = request.params as { conversationId: string };
    const summary = await summarizeSession(String(conversationId), request.userId!);
    return { summary };
  });
};

export default memoryPlugin;
