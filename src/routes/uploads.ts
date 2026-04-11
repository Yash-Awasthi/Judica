import { Router, Response } from "express";
import { requireAuth } from "../middleware/auth.js";
import { upload } from "../middleware/upload.js";
import prisma from "../lib/db.js";
import { AuthRequest } from "../types/index.js";
import { AppError } from "../middleware/errorHandler.js";
import { processFile } from "../processors/router.processor.js";
import fs from "fs";
import path from "path";
import logger from "../lib/logger.js";

const router = Router();

// POST /api/uploads — upload up to 10 files
router.post("/", requireAuth, upload.array("files", 10), async (req: AuthRequest, res: Response) => {
  const files = req.files as Express.Multer.File[];
  if (!files || files.length === 0) {
    throw new AppError(400, "No files uploaded", "NO_FILES");
  }

  const userId = req.userId!;
  const records = await Promise.all(
    files.map((f) =>
      prisma.upload.create({
        data: {
          userId,
          filename: f.filename,
          originalName: f.originalname,
          mimeType: f.mimetype,
          sizeBytes: f.size,
          storagePath: f.path,
        },
        select: { id: true, filename: true, originalName: true, mimeType: true, sizeBytes: true },
      })
    )
  );

  res.status(201).json({ uploads: records });
});

// GET /api/uploads/:id/status
router.get("/:id/status", requireAuth, async (req: AuthRequest, res: Response) => {
  const upload = await prisma.upload.findFirst({
    where: { id: req.params.id, userId: req.userId! },
    select: { id: true, processed: true, extractedText: true, metadata: true, mimeType: true, originalName: true },
  });
  if (!upload) throw new AppError(404, "Upload not found", "UPLOAD_NOT_FOUND");

  res.json({
    id: upload.id,
    processed: upload.processed,
    extracted_text_length: upload.extractedText?.length || 0,
    metadata: upload.metadata,
    mimeType: upload.mimeType,
    originalName: upload.originalName,
  });
});

// POST /api/uploads/:id/process — trigger processing
router.post("/:id/process", requireAuth, async (req: AuthRequest, res: Response) => {
  const record = await prisma.upload.findFirst({
    where: { id: req.params.id, userId: req.userId! },
  });
  if (!record) throw new AppError(404, "Upload not found", "UPLOAD_NOT_FOUND");

  if (record.processed) {
    return res.json({ success: true, already_processed: true, extracted_text_length: record.extractedText?.length || 0 });
  }

  try {
    const result = await processFile(record);

    await prisma.upload.update({
      where: { id: record.id },
      data: {
        processed: true,
        extractedText: result.text || null,
        metadata: result.metadata || undefined,
      },
    });

    res.json({ success: true, extracted_text_length: result.text?.length || 0, type: result.type });
  } catch (err: any) {
    logger.error({ err, uploadId: record.id }, "File processing failed");
    throw new AppError(500, `Processing failed: ${err.message}`, "PROCESSING_FAILED");
  }
});

// GET /api/uploads/:id/raw — serve file with auth
router.get("/:id/raw", requireAuth, async (req: AuthRequest, res: Response) => {
  const record = await prisma.upload.findFirst({
    where: { id: req.params.id, userId: req.userId! },
  });
  if (!record) throw new AppError(404, "Upload not found", "UPLOAD_NOT_FOUND");

  if (!fs.existsSync(record.storagePath)) {
    throw new AppError(404, "File not found on disk", "FILE_MISSING");
  }

  res.setHeader("Content-Type", record.mimeType);
  res.setHeader("Content-Disposition", `inline; filename="${record.originalName}"`);
  fs.createReadStream(record.storagePath).pipe(res);
});

// GET /api/uploads — list user's uploads
router.get("/", requireAuth, async (req: AuthRequest, res: Response) => {
  const uploads = await prisma.upload.findMany({
    where: { userId: req.userId! },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, originalName: true, mimeType: true, sizeBytes: true, processed: true, createdAt: true },
  });
  res.json({ uploads });
});

export default router;
