import type { FastifyPluginAsync } from "fastify";
import { db } from "../lib/drizzle.js";
import { usageLogs } from "../db/schema/users.js";
import { eq, and, gte, lte, sum, count, avg, sql, desc } from "drizzle-orm";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";

const usagePlugin: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/",
    { preHandler: fastifyRequireAuth },
    async (request, reply) => {
      const userId = request.userId!;
      const { start_date, end_date } = request.query as {
        start_date?: string;
        end_date?: string;
        group_by?: string;
      };

      // Build where conditions
      const conditions = [eq(usageLogs.userId, userId)];
      if (start_date) conditions.push(gte(usageLogs.createdAt, new Date(start_date)));
      if (end_date) conditions.push(lte(usageLogs.createdAt, new Date(end_date)));

      const whereClause = and(...conditions);

      // Summary stats
      const [summaryRow] = await db
        .select({
          totalRequests: count(),
          totalPromptTokens: sum(usageLogs.promptTokens),
          totalCompletionTokens: sum(usageLogs.completionTokens),
          totalCostUsd: sum(usageLogs.costUsd),
          avgLatencyMs: avg(usageLogs.latencyMs),
        })
        .from(usageLogs)
        .where(whereClause);

      // Group by provider + model
      const byProvider = await db
        .select({
          provider: usageLogs.provider,
          model: usageLogs.model,
          requests: count(),
          totalPromptTokens: sum(usageLogs.promptTokens),
          totalCompletionTokens: sum(usageLogs.completionTokens),
          totalCostUsd: sum(usageLogs.costUsd),
          avgLatencyMs: avg(usageLogs.latencyMs),
        })
        .from(usageLogs)
        .where(whereClause)
        .groupBy(usageLogs.provider, usageLogs.model)
        .orderBy(desc(sum(usageLogs.costUsd)));

      // Daily usage (last 30 days)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const dailyRaw = await db.execute<{
        date: Date;
        total_tokens: string;
        total_cost: number;
        count: string;
      }>(sql`
        SELECT DATE("createdAt") as date,
               SUM("promptTokens" + "completionTokens")::bigint as total_tokens,
               SUM("costUsd") as total_cost,
               COUNT(*)::bigint as count
        FROM "UsageLog"
        WHERE "userId" = ${userId} AND "createdAt" >= ${thirtyDaysAgo}
        GROUP BY DATE("createdAt")
        ORDER BY date DESC
      `);

      const daily = dailyRaw.rows.map((d) => ({
        date: d.date,
        total_tokens: Number(d.total_tokens),
        total_cost: d.total_cost,
        count: Number(d.count),
      }));

      return {
        summary: {
          total_requests: summaryRow.totalRequests,
          total_prompt_tokens: Number(summaryRow.totalPromptTokens) || 0,
          total_completion_tokens: Number(summaryRow.totalCompletionTokens) || 0,
          total_cost_usd: Number(summaryRow.totalCostUsd) || 0,
          avg_latency_ms: Math.round(Number(summaryRow.avgLatencyMs) || 0),
        },
        by_provider: byProvider.map((p) => ({
          provider: p.provider,
          model: p.model,
          requests: p.requests,
          total_tokens: (Number(p.totalPromptTokens) || 0) + (Number(p.totalCompletionTokens) || 0),
          total_cost_usd: Number(p.totalCostUsd) || 0,
          avg_latency_ms: Math.round(Number(p.avgLatencyMs) || 0),
        })),
        daily,
      };
    },
  );
};

export default usagePlugin;
