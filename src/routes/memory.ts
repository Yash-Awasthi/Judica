import { Router, Response } from "express";
import { requireAuth } from "../middleware/auth.js";
import prisma from "../lib/db.js";
import type { AuthRequest } from "../types/index.js";
import { AppError } from "../middleware/errorHandler.js";
import { compact } from "../services/memoryCompaction.service.js";
import { getBackend, setBackend, removeBackend, encryptConfig } from "../services/memoryRouter.service.js";
import { summarizeSession } from "../services/sessionSummary.service.js";
import logger from "../lib/logger.js";

const router = Router();

/**
 * @openapi
 * /api/memory/compact:
 *   post:
 *     tags:
 *       - Memory
 *     summary: Trigger manual memory compaction
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Compaction result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       401:
 *         description: Unauthorized
 */
// POST /compact — manual memory compaction
router.post("/compact", requireAuth, async (req: AuthRequest, res: Response) => {
  const result = await compact(req.userId!);
  res.json(result);
});

/**
 * @openapi
 * /api/memory/stats:
 *   get:
 *     tags:
 *       - Memory
 *     summary: Get memory statistics
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Memory statistics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 chunkCount:
 *                   type: integer
 *                 estimatedStorageMB:
 *                   type: number
 *       401:
 *         description: Unauthorized
 */
// GET /stats — memory statistics
router.get("/stats", requireAuth, async (req: AuthRequest, res: Response) => {
  const chunkCount = await prisma.memory.count({ where: { userId: req.userId! } });

  // Rough storage estimate (avg 512 chars per chunk)
  const estimatedBytes = chunkCount * 512 * 4; // chars * ~4 bytes per char with embedding

  res.json({
    chunkCount,
    estimatedStorageMB: Math.round(estimatedBytes / (1024 * 1024) * 100) / 100,
  });
});

/**
 * @openapi
 * /api/memory/all:
 *   delete:
 *     tags:
 *       - Memory
 *     summary: Clear all memory for the user
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - confirm
 *             properties:
 *               confirm:
 *                 type: string
 *                 description: Must be "DELETE_ALL_MEMORY"
 *     responses:
 *       200:
 *         description: Memory cleared
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 deleted:
 *                   type: integer
 *       400:
 *         description: Confirmation required
 *       401:
 *         description: Unauthorized
 */
// DELETE /all — clear all memory (with confirmation)
router.delete("/all", requireAuth, async (req: AuthRequest, res: Response) => {
  const { confirm } = req.body;
  if (confirm !== "DELETE_ALL_MEMORY") {
    throw new AppError(400, "Must confirm with DELETE_ALL_MEMORY", "CONFIRM_REQUIRED");
  }

  const deleted = await prisma.memory.deleteMany({ where: { userId: req.userId! } });
  res.json({ success: true, deleted: deleted.count });
});

/**
 * @openapi
 * /api/memory/backend:
 *   get:
 *     tags:
 *       - Memory
 *     summary: Get the user's memory backend configuration
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Memory backend configuration
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 type:
 *                   type: string
 *                 url:
 *                   type: string
 *                   nullable: true
 *                 collectionName:
 *                   type: string
 *                   nullable: true
 *                 hasApiKey:
 *                   type: boolean
 *                 active:
 *                   type: boolean
 *       401:
 *         description: Unauthorized
 */
// GET /backend — get user's memory backend config
router.get("/backend", requireAuth, async (req: AuthRequest, res: Response) => {
  const backend = await getBackend(req.userId!);

  if (!backend) {
    res.json({ type: "local", active: true });
    return;
  }

  // Don't expose API keys in full
  const safe = {
    type: backend.type,
    url: backend.url || null,
    collectionName: backend.collectionName || null,
    hasApiKey: !!backend.apiKey,
    active: true,
  };

  res.json(safe);
});

/**
 * @openapi
 * /api/memory/backend:
 *   post:
 *     tags:
 *       - Memory
 *     summary: Set memory backend
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - type
 *             properties:
 *               type:
 *                 type: string
 *                 enum: [local, qdrant, getzep, google_drive]
 *               config:
 *                 type: object
 *     responses:
 *       200:
 *         description: Backend set
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 type:
 *                   type: string
 *                 active:
 *                   type: boolean
 *       400:
 *         description: Invalid backend type
 *       401:
 *         description: Unauthorized
 */
// POST /backend — set memory backend
router.post("/backend", requireAuth, async (req: AuthRequest, res: Response) => {
  const { type, config } = req.body;

  const validTypes = ["local", "qdrant", "getzep", "google_drive"];
  if (!validTypes.includes(type)) {
    throw new AppError(400, `Type must be one of: ${validTypes.join(", ")}`, "INVALID_BACKEND_TYPE");
  }

  if (type === "local") {
    await removeBackend(req.userId!);
    res.json({ type: "local", active: true });
    return;
  }

  await setBackend(req.userId!, type, config || {});
  res.json({ type, active: true });
});

/**
 * @openapi
 * /api/memory/backend:
 *   delete:
 *     tags:
 *       - Memory
 *     summary: Reset memory backend to local
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Backend reset to local
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 type:
 *                   type: string
 *                 active:
 *                   type: boolean
 *       401:
 *         description: Unauthorized
 */
// DELETE /backend — reset to local
router.delete("/backend", requireAuth, async (req: AuthRequest, res: Response) => {
  await removeBackend(req.userId!);
  res.json({ type: "local", active: true });
});

/**
 * @openapi
 * /api/memory/summarize/{conversationId}:
 *   post:
 *     tags:
 *       - Memory
 *     summary: Manually trigger session summary for a conversation
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: conversationId
 *         required: true
 *         schema:
 *           type: string
 *         description: Conversation ID
 *     responses:
 *       200:
 *         description: Session summary
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 summary:
 *                   type: object
 *       401:
 *         description: Unauthorized
 */
// POST /summarize/:conversationId — manually trigger session summary
router.post("/summarize/:conversationId", requireAuth, async (req: AuthRequest, res: Response) => {
  const summary = await summarizeSession(String(req.params.conversationId), req.userId!);
  res.json({ summary });
});

export default router;
