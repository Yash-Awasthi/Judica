import { Router, Response } from "express";
import { requireAuth } from "../middleware/auth.js";
import prisma from "../lib/db.js";
import { AuthRequest } from "../types/index.js";
import { AppError } from "../middleware/errorHandler.js";
import { ingestDocument } from "../services/ingestion.service.js";
import { deleteKBChunks, deleteDocChunks } from "../services/vectorStore.service.js";
import logger from "../lib/logger.js";

const router = Router();

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
router.get("/", requireAuth, async (req: AuthRequest, res: Response) => {
  const kbs = await prisma.knowledgeBase.findMany({
    where: { userId: req.userId! },
    include: { _count: { select: { documents: true, memories: true } } },
    orderBy: { createdAt: "desc" },
  });

  res.json({
    knowledge_bases: kbs.map((kb: any) => ({
      id: kb.id,
      name: kb.name,
      description: kb.description,
      document_count: kb._count.documents,
      chunk_count: kb._count.memories,
      createdAt: kb.createdAt,
      updatedAt: kb.updatedAt,
    })),
  });
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
router.post("/", requireAuth, async (req: AuthRequest, res: Response) => {
  const { name, description } = req.body;
  if (!name || typeof name !== "string" || name.trim().length === 0) {
    throw new AppError(400, "Name is required", "KB_NAME_REQUIRED");
  }

  const kb = await prisma.knowledgeBase.create({
    data: {
      userId: req.userId!,
      name: name.trim(),
      description: description?.trim() || null,
    },
  });

  res.status(201).json(kb);
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
router.get("/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  const kb = await prisma.knowledgeBase.findFirst({
    where: { id: req.params.id, userId: req.userId! },
    include: {
      documents: {
        orderBy: { createdAt: "desc" },
        select: { id: true, filename: true, chunkCount: true, indexed: true, indexedAt: true, createdAt: true },
      },
      _count: { select: { memories: true } },
    },
  });
  if (!kb) throw new AppError(404, "Knowledge base not found", "KB_NOT_FOUND");

  res.json({
    ...kb,
    chunk_count: kb._count.memories,
  });
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
router.delete("/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  const kb = await prisma.knowledgeBase.findFirst({
    where: { id: req.params.id, userId: req.userId! },
  });
  if (!kb) throw new AppError(404, "Knowledge base not found", "KB_NOT_FOUND");

  await deleteKBChunks(kb.id);
  await prisma.knowledgeBase.delete({ where: { id: kb.id } });

  res.json({ success: true });
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
router.post("/:id/documents", requireAuth, async (req: AuthRequest, res: Response) => {
  const { upload_id } = req.body;
  if (!upload_id) throw new AppError(400, "upload_id is required", "UPLOAD_ID_REQUIRED");

  const kb = await prisma.knowledgeBase.findFirst({
    where: { id: req.params.id, userId: req.userId! },
  });
  if (!kb) throw new AppError(404, "Knowledge base not found", "KB_NOT_FOUND");

  const upload = await prisma.upload.findFirst({
    where: { id: upload_id, userId: req.userId! },
  });
  if (!upload) throw new AppError(404, "Upload not found", "UPLOAD_NOT_FOUND");

  if (!upload.processed || !upload.extractedText) {
    throw new AppError(400, "Upload must be processed first. Call POST /api/uploads/:id/process", "UPLOAD_NOT_PROCESSED");
  }

  const doc = await prisma.kBDocument.create({
    data: {
      kbId: kb.id,
      uploadId: upload.id,
      filename: upload.originalName,
    },
  });

  // Ingest async — don't block the response
  ingestDocument(req.userId!, kb.id, doc.id, upload.originalName, upload.extractedText).catch((err) => {
    logger.error({ err, docId: doc.id }, "Background ingestion failed");
  });

  res.status(201).json({ document: doc, message: "Indexing started in background" });
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
router.get("/:id/documents", requireAuth, async (req: AuthRequest, res: Response) => {
  const kb = await prisma.knowledgeBase.findFirst({
    where: { id: req.params.id, userId: req.userId! },
  });
  if (!kb) throw new AppError(404, "Knowledge base not found", "KB_NOT_FOUND");

  const docs = await prisma.kBDocument.findMany({
    where: { kbId: kb.id },
    orderBy: { createdAt: "desc" },
  });

  res.json({ documents: docs });
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
router.delete("/:kbId/documents/:docId", requireAuth, async (req: AuthRequest, res: Response) => {
  const kb = await prisma.knowledgeBase.findFirst({
    where: { id: req.params.kbId, userId: req.userId! },
  });
  if (!kb) throw new AppError(404, "Knowledge base not found", "KB_NOT_FOUND");

  const doc = await prisma.kBDocument.findFirst({
    where: { id: req.params.docId, kbId: kb.id },
  });
  if (!doc) throw new AppError(404, "Document not found", "DOC_NOT_FOUND");

  await deleteDocChunks(kb.id, doc.filename);
  await prisma.kBDocument.delete({ where: { id: doc.id } });

  res.json({ success: true });
});

export default router;
