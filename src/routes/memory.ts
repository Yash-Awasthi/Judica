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

// POST /compact — manual memory compaction
router.post("/compact", requireAuth, async (req: AuthRequest, res: Response) => {
  const result = await compact(req.userId!);
  res.json(result);
});

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

// DELETE /all — clear all memory (with confirmation)
router.delete("/all", requireAuth, async (req: AuthRequest, res: Response) => {
  const { confirm } = req.body;
  if (confirm !== "DELETE_ALL_MEMORY") {
    throw new AppError(400, "Must confirm with DELETE_ALL_MEMORY", "CONFIRM_REQUIRED");
  }

  const deleted = await prisma.memory.deleteMany({ where: { userId: req.userId! } });
  res.json({ success: true, deleted: deleted.count });
});

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

// DELETE /backend — reset to local
router.delete("/backend", requireAuth, async (req: AuthRequest, res: Response) => {
  await removeBackend(req.userId!);
  res.json({ type: "local", active: true });
});

// POST /summarize/:conversationId — manually trigger session summary
router.post("/summarize/:conversationId", requireAuth, async (req: AuthRequest, res: Response) => {
  const summary = await summarizeSession(String(req.params.conversationId), req.userId!);
  res.json({ summary });
});

export default router;
