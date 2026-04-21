import type { FastifyPluginAsync } from "fastify";
import { db } from "../lib/drizzle.js";
import { knowledgeBases, kbDocuments, uploads } from "../db/schema/uploads.js";
import { memories } from "../db/schema/memory.js";
import { eq, and, desc, count } from "drizzle-orm";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import { AppError } from "../middleware/errorHandler.js";
import { ingestDocument } from "../services/ingestion.service.js";
import { deleteKBChunks, deleteDocChunks } from "../services/vectorStore.service.js";
import { randomUUID } from "crypto";
import logger from "../lib/logger.js";

const kbPlugin: FastifyPluginAsync = async (fastify) => {
  // GET /api/kb — list knowledge bases
  fastify.get("/", { preHandler: fastifyRequireAuth }, async (request) => {
    const kbs = await db
      .select()
      .from(knowledgeBases)
      .where(eq(knowledgeBases.userId, request.userId!))
      .orderBy(desc(knowledgeBases.createdAt));

    // P30-06: Cap parallel queries to prevent DB connection pool exhaustion
    const MAX_KB_ENRICHMENT = 100;
    const result = await Promise.all(
      kbs.slice(0, MAX_KB_ENRICHMENT).map(async (kb) => {
        const [docCount] = await db
          .select({ value: count() })
          .from(kbDocuments)
          .where(eq(kbDocuments.kbId, kb.id));
        const [chunkCount] = await db
          .select({ value: count() })
          .from(memories)
          .where(eq(memories.kbId, kb.id));

        return {
          id: kb.id,
          name: kb.name,
          description: kb.description,
          document_count: docCount.value,
          chunk_count: chunkCount.value,
          createdAt: kb.createdAt,
          updatedAt: kb.updatedAt,
        };
      })
    );

    return { knowledge_bases: result };
  });

    fastify.post("/", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const { name, description } = request.body as { name?: string; description?: string };
    if (!name || typeof name !== "string" || name.trim().length === 0) {
      throw new AppError(400, "Name is required", "KB_NAME_REQUIRED");
    }

    const now = new Date();
    const [kb] = await db
      .insert(knowledgeBases)
      .values({
        id: randomUUID(),
        userId: request.userId!,
        name: name.trim(),
        description: description?.trim() || null,
        updatedAt: now,
      })
      .returning();

    reply.code(201);
    return kb;
  });

    fastify.get("/:id", { preHandler: fastifyRequireAuth }, async (request) => {
    const { id } = request.params as { id: string };

    const [kb] = await db
      .select()
      .from(knowledgeBases)
      .where(and(eq(knowledgeBases.id, id), eq(knowledgeBases.userId, request.userId!)))
      .limit(1);

    if (!kb) throw new AppError(404, "Knowledge base not found", "KB_NOT_FOUND");

    const docs = await db
      .select({
        id: kbDocuments.id,
        filename: kbDocuments.filename,
        chunkCount: kbDocuments.chunkCount,
        indexed: kbDocuments.indexed,
        indexedAt: kbDocuments.indexedAt,
        createdAt: kbDocuments.createdAt,
      })
      .from(kbDocuments)
      .where(eq(kbDocuments.kbId, kb.id))
      .orderBy(desc(kbDocuments.createdAt));

    const [chunkCount] = await db
      .select({ value: count() })
      .from(memories)
      .where(eq(memories.kbId, kb.id));

    return {
      ...kb,
      documents: docs,
      chunk_count: chunkCount.value,
    };
  });

    fastify.delete("/:id", { preHandler: fastifyRequireAuth }, async (request) => {
    const { id } = request.params as { id: string };

    const [kb] = await db
      .select()
      .from(knowledgeBases)
      .where(and(eq(knowledgeBases.id, id), eq(knowledgeBases.userId, request.userId!)))
      .limit(1);

    if (!kb) throw new AppError(404, "Knowledge base not found", "KB_NOT_FOUND");

    await deleteKBChunks(kb.id);
    await db.delete(knowledgeBases).where(eq(knowledgeBases.id, kb.id));

    return { success: true };
  });

    fastify.post("/:id/documents", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { upload_id } = request.body as { upload_id?: string };
    if (!upload_id) throw new AppError(400, "upload_id is required", "UPLOAD_ID_REQUIRED");

    const [kb] = await db
      .select()
      .from(knowledgeBases)
      .where(and(eq(knowledgeBases.id, id), eq(knowledgeBases.userId, request.userId!)))
      .limit(1);

    if (!kb) throw new AppError(404, "Knowledge base not found", "KB_NOT_FOUND");

    const [upload] = await db
      .select()
      .from(uploads)
      .where(and(eq(uploads.id, upload_id), eq(uploads.userId, request.userId!)))
      .limit(1);

    if (!upload) throw new AppError(404, "Upload not found", "UPLOAD_NOT_FOUND");

    if (!upload.processed || !upload.extractedText) {
      throw new AppError(400, "Upload must be processed first. Call POST /api/uploads/:id/process", "UPLOAD_NOT_PROCESSED");
    }

    const [doc] = await db
      .insert(kbDocuments)
      .values({
        id: randomUUID(),
        kbId: kb.id,
        uploadId: upload.id,
        filename: upload.originalName,
      })
      .returning();

    // Ingest async — don't block the response
    ingestDocument(request.userId!, kb.id, doc.id, upload.originalName, upload.extractedText).catch((err) => {
      logger.error({ err, docId: doc.id }, "Background ingestion failed");
    });

    reply.code(201);
    return { document: doc, message: "Indexing started in background" };
  });

    fastify.get("/:id/documents", { preHandler: fastifyRequireAuth }, async (request) => {
    const { id } = request.params as { id: string };

    const [kb] = await db
      .select()
      .from(knowledgeBases)
      .where(and(eq(knowledgeBases.id, id), eq(knowledgeBases.userId, request.userId!)))
      .limit(1);

    if (!kb) throw new AppError(404, "Knowledge base not found", "KB_NOT_FOUND");

    const docs = await db
      .select()
      .from(kbDocuments)
      .where(eq(kbDocuments.kbId, kb.id))
      .orderBy(desc(kbDocuments.createdAt));

    return { documents: docs };
  });

    fastify.delete("/:kbId/documents/:docId", { preHandler: fastifyRequireAuth }, async (request) => {
    const { kbId, docId } = request.params as { kbId: string; docId: string };

    const [kb] = await db
      .select()
      .from(knowledgeBases)
      .where(and(eq(knowledgeBases.id, kbId), eq(knowledgeBases.userId, request.userId!)))
      .limit(1);

    if (!kb) throw new AppError(404, "Knowledge base not found", "KB_NOT_FOUND");

    const [doc] = await db
      .select()
      .from(kbDocuments)
      .where(and(eq(kbDocuments.id, docId), eq(kbDocuments.kbId, kb.id)))
      .limit(1);

    if (!doc) throw new AppError(404, "Document not found", "DOC_NOT_FOUND");

    await deleteDocChunks(kb.id, doc.filename);
    await db.delete(kbDocuments).where(eq(kbDocuments.id, doc.id));

    return { success: true };
  });
};

export default kbPlugin;
