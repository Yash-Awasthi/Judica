import { Router, Response } from "express";
import prisma from "../lib/db.js";
import type { AuthRequest } from "../types/index.js";

const router = Router();

// ─── List traces ────────────────────────────────────────────────────────────
router.get("/", async (req: AuthRequest, res: Response) => {
  const userId = req.userId!;
  const {
    type,
    date_from,
    date_to,
    conversation_id,
    page = "1",
    limit = "20",
  } = req.query;

  const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 20));

  const where: Record<string, unknown> = { userId };

  if (type) where.type = type as string;
  if (conversation_id) where.conversationId = conversation_id as string;

  if (date_from || date_to) {
    where.createdAt = {};
    if (date_from) (where.createdAt as Record<string, unknown>).gte = new Date(date_from as string);
    if (date_to) (where.createdAt as Record<string, unknown>).lte = new Date(date_to as string);
  }

  const [traces, total] = await Promise.all([
    prisma.trace.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (pageNum - 1) * limitNum,
      take: limitNum,
      select: {
        id: true,
        conversationId: true,
        workflowRunId: true,
        type: true,
        totalLatencyMs: true,
        totalTokens: true,
        totalCostUsd: true,
        createdAt: true,
      },
    }),
    prisma.trace.count({ where }),
  ]);

  res.json({
    traces,
    total,
    page: pageNum,
    limit: limitNum,
    pages: Math.ceil(total / limitNum),
  });
});

// ─── Trace detail ───────────────────────────────────────────────────────────
router.get("/:id", async (req: AuthRequest, res: Response) => {
  const userId = req.userId!;
  const trace = await prisma.trace.findFirst({
    where: { id: req.params.id, userId },
  });

  if (!trace) {
    res.status(404).json({ error: "Trace not found" });
    return;
  }

  res.json(trace);
});

export default router;
