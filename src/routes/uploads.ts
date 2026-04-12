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
router.get("/:id/status", requireAuth, async (req: AuthRequest, res: Response) => {
  const upload = await prisma.upload.findFirst({
    where: { id: req.params.id as string, userId: req.userId! },
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
router.post("/:id/process", requireAuth, async (req: AuthRequest, res: Response) => {
  const record = await prisma.upload.findFirst({
    where: { id: req.params.id as string, userId: req.userId! },
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
        metadata: (result.metadata || undefined) as any,
      },
    });

    res.json({ success: true, extracted_text_length: result.text?.length || 0, type: result.type });
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
router.get("/:id/raw", requireAuth, async (req: AuthRequest, res: Response) => {
  const record = await prisma.upload.findFirst({
    where: { id: req.params.id as string, userId: req.userId! },
  });
  if (!record) throw new AppError(404, "Upload not found", "UPLOAD_NOT_FOUND");

  if (!fs.existsSync(record.storagePath)) {
    throw new AppError(404, "File not found on disk", "FILE_MISSING");
  }

  res.setHeader("Content-Type", record.mimeType);
  res.setHeader("Content-Disposition", `inline; filename="${record.originalName}"`);
  fs.createReadStream(record.storagePath).pipe(res);
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
