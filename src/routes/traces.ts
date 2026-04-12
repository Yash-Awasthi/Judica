import { Router, Response } from "express";
import prisma from "../lib/db.js";
import type { AuthRequest } from "../types/index.js";

const router = Router();

/**
 * @openapi
 * /api/traces:
 *   get:
 *     tags:
 *       - Analytics
 *     summary: List traces with filtering and pagination
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *         description: Filter by trace type
 *       - in: query
 *         name: date_from
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Start date filter
 *       - in: query
 *         name: date_to
 *         schema:
 *           type: string
 *           format: date-time
 *         description: End date filter
 *       - in: query
 *         name: conversation_id
 *         schema:
 *           type: string
 *         description: Filter by conversation ID
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           maximum: 100
 *         description: Items per page
 *     responses:
 *       200:
 *         description: Paginated list of traces
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 traces:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       conversationId:
 *                         type: string
 *                       workflowRunId:
 *                         type: string
 *                       type:
 *                         type: string
 *                       totalLatencyMs:
 *                         type: number
 *                       totalTokens:
 *                         type: integer
 *                       totalCostUsd:
 *                         type: number
 *                       createdAt:
 *                         type: string
 *                         format: date-time
 *                 total:
 *                   type: integer
 *                 page:
 *                   type: integer
 *                 limit:
 *                   type: integer
 *                 pages:
 *                   type: integer
 *       401:
 *         description: Unauthorized
 */
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

/**
 * @openapi
 * /api/traces/{id}:
 *   get:
 *     tags:
 *       - Analytics
 *     summary: Get trace detail by ID
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Trace ID
 *     responses:
 *       200:
 *         description: Trace detail
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Trace not found
 */
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
