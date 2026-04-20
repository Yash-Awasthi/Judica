import type { FastifyPluginAsync } from "fastify";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import { db } from "../lib/drizzle.js";
import { conversations, chats } from "../db/schema/conversations.js";
import { traces } from "../db/schema/traces.js";
import { eq, count, sum, avg, sql } from "drizzle-orm";

const analyticsPlugin: FastifyPluginAsync = async (fastify) => {
    fastify.get("/overview", { preHandler: fastifyRequireAuth }, async (request, _reply) => {
    const userId = request.userId!;

    // Total conversations
    const [convCount] = await db
      .select({ value: count() })
      .from(conversations)
      .where(eq(conversations.userId, userId));
    const totalConversations = convCount.value;

    // Total messages (chats)
    const [chatCount] = await db
      .select({ value: count() })
      .from(chats)
      .where(eq(chats.userId, userId));
    const totalMessages = chatCount.value;

    // Aggregated trace data
    const [traceAgg] = await db
      .select({
        totalTokens: sum(traces.totalTokens),
        totalCostUsd: sum(traces.totalCostUsd),
        avgLatency: avg(traces.totalLatencyMs),
      })
      .from(traces)
      .where(eq(traces.userId, userId));

    const totalTokensUsed = Number(traceAgg.totalTokens ?? 0);
    const totalCostUsd = Number(traceAgg.totalCostUsd ?? 0);
    const avgLatencyMs = Math.round(Number(traceAgg.avgLatency ?? 0));

    // Daily usage from traces (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const dailyRaw = await db.execute(sql`
      SELECT DATE("createdAt") as date,
             SUM("totalTokens")::bigint as tokens,
             SUM("totalCostUsd") as cost
      FROM "Trace"
      WHERE "userId" = ${userId} AND "createdAt" >= ${thirtyDaysAgo}
      GROUP BY DATE("createdAt")
      ORDER BY date ASC
    `);

    const dailyUsage = (dailyRaw.rows as Array<{ date: string; tokens: string; cost: string }>).map((d) => ({
      date: new Date(d.date).toISOString().split("T")[0],
      tokens: Number(d.tokens),
      cost: Number(d.cost),
    }));

    // Model distribution from trace steps JSON
    let modelDistribution: { model: string; count: number }[] = [];
    try {
      const modelRaw = await db.execute(sql`
        SELECT step->>'model' as model, COUNT(*)::bigint as count
        FROM "Trace", jsonb_array_elements(steps) AS step
        WHERE "userId" = ${userId} AND step->>'model' IS NOT NULL AND step->>'model' != ''
        GROUP BY step->>'model'
        ORDER BY count DESC
        LIMIT 20
      `);
      modelDistribution = (modelRaw.rows as Array<{ model: string; count: string }>).map((m) => ({
        model: m.model,
        count: Number(m.count),
      }));
    } catch {
      // If steps JSON structure doesn't match, return empty
    }

    // Top tools from trace steps where type='tool_call'
    let topTools: { tool: string; count: number }[] = [];
    try {
      const toolRaw = await db.execute(sql`
        SELECT step->>'name' as tool, COUNT(*)::bigint as count
        FROM "Trace", jsonb_array_elements(steps) AS step
        WHERE "userId" = ${userId} AND step->>'type' = 'tool_call'
        GROUP BY step->>'name'
        ORDER BY count DESC
        LIMIT 20
      `);
      topTools = (toolRaw.rows as Array<{ tool: string; count: string }>).map((t) => ({
        tool: t.tool,
        count: Number(t.count),
      }));
    } catch {
      // If steps JSON structure doesn't match, return empty
    }

    return {
      totalConversations,
      totalMessages,
      totalTokensUsed,
      totalCostUsd,
      avgLatencyMs,
      modelDistribution,
      dailyUsage,
      topTools,
    };
  });
};

export default analyticsPlugin;
