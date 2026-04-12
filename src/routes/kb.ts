import { FastifyPluginAsync } from "fastify";
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

/**
 * @openapi
 * /api/kb:
 *   get:
 *     tags:
 *       - Knowledge Bases
 *     summary: List knowledge bases
 *     description: Returns all knowledge bases owned by the authenticated user.
 *     responses:
 *       200:
 *         description: A list of knowledge bases
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 knowledge_bases:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       name:
 *                         type: string
 *                       description:
 *                         type: string
 *                         nullable: true
 *                       document_count:
 *                         type: integer
 *                       chunk_count:
 *                         type: integer
 *                       createdAt:
 *                         type: string
 *                         format: date-time
 *                       updatedAt:
 *                         type: string
 *                         format: date-time
 *       401:
 *         description: Unauthorized
 */
const kbPlugin: FastifyPluginAsync = async (fastify) => {
  // GET /api/kb — list knowledge bases
  fastify.get("/", { preHandler: fastifyRequireAuth }, async (request) => {
    const kbs = await db
      .select()
      .from(knowledgeBases)
      .where(eq(knowledgeBases.userId, request.userId!))
      .orderBy(desc(knowledgeBases.createdAt));

    const result = await Promise.all(
      kbs.map(async (kb) => {
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

  /**
   * @openapi
   * /api/kb:
   *   post:
   *     tags:
   *       - Knowledge Bases
   *     summary: Create a knowledge base
   *     description: Creates a new knowledge base for the authenticated user.
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - name
   *             properties:
   *               name:
   *                 type: string
   *                 description: Name of the knowledge base
   *               description:
   *                 type: string
   *                 description: Optional description of the knowledge base
   *     responses:
   *       201:
   *         description: Knowledge base created successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 id:
   *                   type: string
   *                 name:
   *                   type: string
   *                 description:
   *                   type: string
   *                   nullable: true
   *                 userId:
   *                   type: string
   *                 createdAt:
   *                   type: string
   *                   format: date-time
   *                 updatedAt:
   *                   type: string
   *                   format: date-time
   *       400:
   *         description: Name is required
   *       401:
   *         description: Unauthorized
   */
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

  /**
   * @openapi
   * /api/kb/{id}:
   *   get:
   *     tags:
   *       - Knowledge Bases
   *     summary: Get knowledge base detail
   *     description: Returns a single knowledge base with its documents.
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Knowledge base ID
   *     responses:
   *       200:
   *         description: Knowledge base details
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 id:
   *                   type: string
   *                 name:
   *                   type: string
   *                 description:
   *                   type: string
   *                   nullable: true
   *                 chunk_count:
   *                   type: integer
   *                 documents:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       id:
   *                         type: string
   *                       filename:
   *                         type: string
   *                       chunkCount:
   *                         type: integer
   *                       indexed:
   *                         type: boolean
   *                       indexedAt:
   *                         type: string
   *                         format: date-time
   *                         nullable: true
   *                       createdAt:
   *                         type: string
   *                         format: date-time
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: Knowledge base not found
   */
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

  /**
   * @openapi
   * /api/kb/{id}:
   *   delete:
   *     tags:
   *       - Knowledge Bases
   *     summary: Delete a knowledge base
   *     description: Deletes a knowledge base and all associated vector chunks.
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Knowledge base ID
   *     responses:
   *       200:
   *         description: Knowledge base deleted successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   example: true
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: Knowledge base not found
   */
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

  /**
   * @openapi
   * /api/kb/{id}/documents:
   *   post:
   *     tags:
   *       - Knowledge Bases
   *     summary: Add a document to a knowledge base
   *     description: Adds a previously uploaded and processed document to a knowledge base. Indexing runs in the background.
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Knowledge base ID
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - upload_id
   *             properties:
   *               upload_id:
   *                 type: string
   *                 description: ID of a previously processed upload
   *     responses:
   *       201:
   *         description: Document added and indexing started
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 document:
   *                   type: object
   *                   properties:
   *                     id:
   *                       type: string
   *                     kbId:
   *                       type: string
   *                     uploadId:
   *                       type: string
   *                     filename:
   *                       type: string
   *                     createdAt:
   *                       type: string
   *                       format: date-time
   *                 message:
   *                   type: string
   *                   example: Indexing started in background
   *       400:
   *         description: upload_id is required or upload not yet processed
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: Knowledge base or upload not found
   */
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

  /**
   * @openapi
   * /api/kb/{id}/documents:
   *   get:
   *     tags:
   *       - Knowledge Bases
   *     summary: List documents in a knowledge base
   *     description: Returns all documents belonging to the specified knowledge base.
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Knowledge base ID
   *     responses:
   *       200:
   *         description: A list of documents
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 documents:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       id:
   *                         type: string
   *                       kbId:
   *                         type: string
   *                       uploadId:
   *                         type: string
   *                       filename:
   *                         type: string
   *                       chunkCount:
   *                         type: integer
   *                       indexed:
   *                         type: boolean
   *                       indexedAt:
   *                         type: string
   *                         format: date-time
   *                         nullable: true
   *                       createdAt:
   *                         type: string
   *                         format: date-time
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: Knowledge base not found
   */
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

  /**
   * @openapi
   * /api/kb/{kbId}/documents/{docId}:
   *   delete:
   *     tags:
   *       - Knowledge Bases
   *     summary: Remove a document from a knowledge base
   *     description: Deletes a document and its associated vector chunks from the knowledge base.
   *     parameters:
   *       - in: path
   *         name: kbId
   *         required: true
   *         schema:
   *           type: string
   *         description: Knowledge base ID
   *       - in: path
   *         name: docId
   *         required: true
   *         schema:
   *           type: string
   *         description: Document ID
   *     responses:
   *       200:
   *         description: Document removed successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   example: true
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: Knowledge base or document not found
   */
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
