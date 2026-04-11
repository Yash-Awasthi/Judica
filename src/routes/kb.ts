import { Router, Response } from "express";
import { requireAuth } from "../middleware/auth.js";
import prisma from "../lib/db.js";
import { AuthRequest } from "../types/index.js";
import { AppError } from "../middleware/errorHandler.js";
import { ingestDocument } from "../services/ingestion.service.js";
import { deleteKBChunks, deleteDocChunks } from "../services/vectorStore.service.js";
import logger from "../lib/logger.js";

const router = Router();

// GET /api/kb — list user's knowledge bases
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

// POST /api/kb — create a knowledge base
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

// GET /api/kb/:id — get KB detail
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

// DELETE /api/kb/:id — delete KB + all chunks
router.delete("/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  const kb = await prisma.knowledgeBase.findFirst({
    where: { id: req.params.id, userId: req.userId! },
  });
  if (!kb) throw new AppError(404, "Knowledge base not found", "KB_NOT_FOUND");

  await deleteKBChunks(kb.id);
  await prisma.knowledgeBase.delete({ where: { id: kb.id } });

  res.json({ success: true });
});

// POST /api/kb/:id/documents — add document to KB
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

// GET /api/kb/:kbId/documents — list docs
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

// DELETE /api/kb/:kbId/documents/:docId — remove doc + chunks
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
