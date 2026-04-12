import { Router, Response } from "express";
import prisma from "../lib/db.js";
import type { AuthRequest } from "../types/index.js";

const router = Router();

/**
 * @openapi
 * /api/analytics/overview:
 *   get:
 *     tags:
 *       - Analytics
 *     summary: Get analytics overview for the authenticated user
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Analytics overview including conversations, messages, tokens, costs, daily usage, model distribution, and top tools
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 totalConversations:
 *                   type: integer
 *                 totalMessages:
 *                   type: integer
 *                 totalTokensUsed:
 *                   type: integer
 *                 totalCostUsd:
 *                   type: number
 *                 avgLatencyMs:
 *                   type: integer
 *                 modelDistribution:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       model:
 *                         type: string
 *                       count:
 *                         type: integer
 *                 dailyUsage:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       date:
 *                         type: string
 *                       tokens:
 *                         type: integer
 *                       cost:
 *                         type: number
 *                 topTools:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       tool:
 *                         type: string
 *                       count:
 *                         type: integer
 *       401:
 *         description: Unauthorized
 */
router.get("/overview", async (req: AuthRequest, res: Response) => {
  const userId = req.userId!;

  // Total conversations
  const totalConversations = await prisma.conversation.count({ where: { userId } });

  // Total messages (chats)
  const totalMessages = await prisma.chat.count({ where: { userId } });

  // Aggregated trace data
  const traceAgg = await prisma.trace.aggregate({
    where: { userId },
    _sum: { totalTokens: true, totalCostUsd: true },
    _avg: { totalLatencyMs: true },
  });

  const totalTokensUsed = traceAgg._sum.totalTokens ?? 0;
  const totalCostUsd = traceAgg._sum.totalCostUsd ?? 0;
  const avgLatencyMs = Math.round(traceAgg._avg.totalLatencyMs ?? 0);

  // Daily usage from traces (last 30 days)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const dailyRaw = await prisma.$queryRawUnsafe<
    { date: Date; tokens: bigint; cost: number }[]
  >(
    `SELECT DATE("createdAt") as date,
            SUM("totalTokens")::bigint as tokens,
            SUM("totalCostUsd") as cost
     FROM "Trace"
     WHERE "userId" = $1 AND "createdAt" >= $2
     GROUP BY DATE("createdAt")
     ORDER BY date ASC`,
    userId,
    thirtyDaysAgo
  );

  const dailyUsage = dailyRaw.map((d) => ({
    date: d.date.toISOString().split("T")[0],
    tokens: Number(d.tokens),
    cost: d.cost,
  }));

  // Model distribution from trace steps JSON
  let modelDistribution: { model: string; count: number }[] = [];
  try {
    const modelRaw = await prisma.$queryRawUnsafe<
      { model: string; count: bigint }[]
    >(
      `SELECT step->>'model' as model, COUNT(*)::bigint as count
       FROM "Trace", jsonb_array_elements(steps) AS step
       WHERE "userId" = $1 AND step->>'model' IS NOT NULL AND step->>'model' != ''
       GROUP BY step->>'model'
       ORDER BY count DESC
       LIMIT 20`,
      userId
    );
    modelDistribution = modelRaw.map((m) => ({
      model: m.model,
      count: Number(m.count),
    }));
  } catch {
    // If steps JSON structure doesn't match, return empty
  }

  // Top tools from trace steps where type='tool_call'
  let topTools: { tool: string; count: number }[] = [];
  try {
    const toolRaw = await prisma.$queryRawUnsafe<
      { tool: string; count: bigint }[]
    >(
      `SELECT step->>'name' as tool, COUNT(*)::bigint as count
       FROM "Trace", jsonb_array_elements(steps) AS step
       WHERE "userId" = $1 AND step->>'type' = 'tool_call'
       GROUP BY step->>'name'
       ORDER BY count DESC
       LIMIT 20`,
      userId
    );
    topTools = toolRaw.map((t) => ({
      tool: t.tool,
      count: Number(t.count),
    }));
  } catch {
    // If steps JSON structure doesn't match, return empty
  }

  res.json({
    totalConversations,
    totalMessages,
    totalTokensUsed,
    totalCostUsd,
    avgLatencyMs,
    modelDistribution,
    dailyUsage,
    topTools,
  });
});

export default router;
