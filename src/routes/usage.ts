import { Router, Response } from "express";
import { requireAuth } from "../middleware/auth.js";
import prisma from "../lib/db.js";
import type { AuthRequest } from "../types/index.js";

const router = Router();

/**
 * @openapi
 * /api/usage:
 *   get:
 *     tags:
 *       - Analytics
 *     summary: Get usage breakdown by provider and model
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: start_date
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Start date filter
 *       - in: query
 *         name: end_date
 *         schema:
 *           type: string
 *           format: date-time
 *         description: End date filter
 *       - in: query
 *         name: group_by
 *         schema:
 *           type: string
 *         description: Grouping field
 *     responses:
 *       200:
 *         description: Usage breakdown
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 summary:
 *                   type: object
 *                   properties:
 *                     total_requests:
 *                       type: integer
 *                     total_prompt_tokens:
 *                       type: integer
 *                     total_completion_tokens:
 *                       type: integer
 *                     total_cost_usd:
 *                       type: number
 *                     avg_latency_ms:
 *                       type: integer
 *                 by_provider:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       provider:
 *                         type: string
 *                       model:
 *                         type: string
 *                       requests:
 *                         type: integer
 *                       total_tokens:
 *                         type: integer
 *                       total_cost_usd:
 *                         type: number
 *                       avg_latency_ms:
 *                         type: integer
 *                 daily:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       date:
 *                         type: string
 *                         format: date
 *                       total_tokens:
 *                         type: integer
 *                       total_cost:
 *                         type: number
 *                       count:
 *                         type: integer
 *       401:
 *         description: Unauthorized
 */
router.get("/", requireAuth, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const { start_date, end_date, group_by } = req.query;

  const where: Record<string, unknown> = { userId };

  if (start_date || end_date) {
    where.createdAt = {};
    if (start_date) (where.createdAt as Record<string, unknown>).gte = new Date(start_date as string);
    if (end_date) (where.createdAt as Record<string, unknown>).lte = new Date(end_date as string);
  }

  // Summary stats
  const summary = await prisma.usageLog.aggregate({
    where,
    _sum: {
      promptTokens: true,
      completionTokens: true,
      costUsd: true,
    },
    _count: true,
    _avg: {
      latencyMs: true,
    },
  });

  // Group by provider + model
  const byProvider = await prisma.usageLog.groupBy({
    by: ["provider", "model"],
    where,
    _sum: {
      promptTokens: true,
      completionTokens: true,
      costUsd: true,
    },
    _count: true,
    _avg: {
      latencyMs: true,
    },
    orderBy: { _sum: { costUsd: "desc" } },
  });

  // Daily usage (last 30 days)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const dailyRaw = await prisma.$queryRawUnsafe<
    { date: Date; total_tokens: bigint; total_cost: number; count: bigint }[]
  >(
    `SELECT DATE("createdAt") as date,
            SUM("promptTokens" + "completionTokens")::bigint as total_tokens,
            SUM("costUsd") as total_cost,
            COUNT(*)::bigint as count
     FROM "UsageLog"
     WHERE "userId" = $1 AND "createdAt" >= $2
     GROUP BY DATE("createdAt")
     ORDER BY date DESC`,
    userId,
    thirtyDaysAgo
  );

  const daily = dailyRaw.map((d) => ({
    date: d.date,
    total_tokens: Number(d.total_tokens),
    total_cost: d.total_cost,
    count: Number(d.count),
  }));

  res.json({
    summary: {
      total_requests: summary._count,
      total_prompt_tokens: summary._sum.promptTokens || 0,
      total_completion_tokens: summary._sum.completionTokens || 0,
      total_cost_usd: summary._sum.costUsd || 0,
      avg_latency_ms: Math.round(summary._avg.latencyMs || 0),
    },
    by_provider: byProvider.map((p) => ({
      provider: p.provider,
      model: p.model,
      requests: p._count,
      total_tokens: (p._sum.promptTokens || 0) + (p._sum.completionTokens || 0),
      total_cost_usd: p._sum.costUsd || 0,
      avg_latency_ms: Math.round(p._avg.latencyMs || 0),
    })),
    daily,
  });
});

export default router;
