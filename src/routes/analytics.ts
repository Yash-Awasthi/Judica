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

    let dailyUsage: { date: string; tokens: number; cost: number }[] = [];
    try {
      const dailyRaw = await db.execute(sql`
        SELECT DATE("createdAt") as date,
               SUM("totalTokens")::bigint as tokens,
               SUM("totalCostUsd") as cost
        FROM "Trace"
        WHERE "userId" = ${userId} AND "createdAt" >= ${thirtyDaysAgo}
        GROUP BY DATE("createdAt")
        ORDER BY date ASC
        LIMIT 90
      `);

      dailyUsage = (dailyRaw.rows as Array<{ date: string; tokens: string; cost: string }>).map((d) => ({
        date: new Date(d.date).toISOString().split("T")[0],
        tokens: Number(d.tokens),
        cost: Number(d.cost),
      }));
    } catch {
      // If table structure doesn't match, return empty
    }

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

  // ── GET /api/analytics/daily?days=N ─────────────────────────────────────────
  fastify.get("/daily", { preHandler: fastifyRequireAuth }, async (request, _reply) => {
    const userId = request.userId!;
    const { days = "30" } = request.query as { days?: string };
    const nDays = Math.min(90, Math.max(1, parseInt(days, 10) || 30));

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - nDays);

    const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

    try {
      const raw = await db.execute(sql`
        SELECT DATE("createdAt") as date,
               COUNT(*) as conversations,
               SUM("totalTokens")::bigint as tokens,
               SUM("totalCostUsd") as cost
        FROM "Trace"
        WHERE "userId" = ${userId} AND "createdAt" >= ${cutoff}
        GROUP BY DATE("createdAt")
        ORDER BY date ASC
        LIMIT ${nDays + 5}
      `);

      const rows = (raw.rows as Array<{ date: string; conversations: string; tokens: string; cost: string }>).map((r) => {
        const d = new Date(r.date);
        return {
          date:          r.date,
          day:           DAY_NAMES[d.getDay()],
          count:         Number(r.conversations),
          requests:      Number(r.conversations),
          tokens:        Number(r.tokens),
          cost:          Number(Number(r.cost).toFixed(4)),
        };
      });

      return { data: rows, days: nDays };
    } catch {
      return { data: [], days: nDays };
    }
  });

  // ── GET /api/analytics/providers ─────────────────────────────────────────────
  fastify.get("/providers", { preHandler: fastifyRequireAuth }, async (request, _reply) => {
    const userId = request.userId!;

    const PIE_COLORS = ["#10b981", "#3b82f6", "#f59e0b", "#a855f7", "#ef4444", "#06b6d4"];

    try {
      // Try to extract provider from step model field (e.g. "gpt-4o" → OpenAI)
      const raw = await db.execute(sql`
        SELECT step->>'model' as model, COUNT(*)::int as count
        FROM "Trace", jsonb_array_elements(steps) AS step
        WHERE "userId" = ${userId} AND step->>'model' IS NOT NULL AND step->>'model' != ''
        GROUP BY step->>'model'
        ORDER BY count DESC
        LIMIT 50
      `);

      const rows = raw.rows as Array<{ model: string; count: number }>;

      // Aggregate by provider
      const providerMap = new Map<string, number>();
      for (const r of rows) {
        const m = String(r.model ?? "").toLowerCase();
        let provider = "Other";
        if (m.includes("gpt") || m.includes("openai") || m.includes("o1") || m.includes("o3")) provider = "OpenAI";
        else if (m.includes("claude") || m.includes("anthropic")) provider = "Anthropic";
        else if (m.includes("gemini") || m.includes("google")) provider = "Google";
        else if (m.includes("mistral")) provider = "Mistral";
        else if (m.includes("llama") || m.includes("meta")) provider = "Meta";
        else if (m.includes("groq")) provider = "Groq";
        providerMap.set(provider, (providerMap.get(provider) ?? 0) + Number(r.count));
      }

      const total = Array.from(providerMap.values()).reduce((a, b) => a + b, 0) || 1;
      const providers = Array.from(providerMap.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([name, count], i) => ({
          name,
          value: Math.round((count / total) * 100),
          color: PIE_COLORS[i % PIE_COLORS.length],
        }));

      return { providers };
    } catch {
      return { providers: [] };
    }
  });

  // ── GET /api/analytics/models?limit=N ────────────────────────────────────────
  fastify.get("/models", { preHandler: fastifyRequireAuth }, async (request, _reply) => {
    const userId = request.userId!;
    const { limit = "5" } = request.query as { limit?: string };
    const nLimit = Math.min(20, Math.max(1, parseInt(limit, 10) || 5));

    try {
      const raw = await db.execute(sql`
        SELECT
          step->>'model' as model,
          COUNT(*)::int as requests,
          SUM((step->>'tokens')::int) as tokens,
          SUM((step->>'costUsd')::float) as cost_usd
        FROM "Trace", jsonb_array_elements(steps) AS step
        WHERE "userId" = ${userId}
          AND step->>'model' IS NOT NULL
          AND step->>'model' != ''
        GROUP BY step->>'model'
        ORDER BY requests DESC
        LIMIT ${nLimit}
      `);

      const models = (raw.rows as Array<{ model: string; requests: number; tokens: number | null; cost_usd: number | null }>)
        .map((m) => {
          const tokens = Number(m.tokens ?? 0);
          const costUsd = Number(m.cost_usd ?? 0);
          const modelStr = String(m.model ?? "");
          let provider = "Unknown";
          const ml = modelStr.toLowerCase();
          if (ml.includes("gpt") || ml.includes("o1") || ml.includes("o3")) provider = "OpenAI";
          else if (ml.includes("claude")) provider = "Anthropic";
          else if (ml.includes("gemini")) provider = "Google";
          else if (ml.includes("mistral")) provider = "Mistral";
          else if (ml.includes("llama")) provider = "Meta";

          const tokensFormatted = tokens >= 1_000_000
            ? `${(tokens / 1_000_000).toFixed(1)}M`
            : tokens >= 1_000 ? `${Math.round(tokens / 1000)}K`
            : String(tokens);

          return {
            name: modelStr,
            provider,
            requests: Number(m.requests),
            tokens: tokensFormatted,
            tokensRaw: tokens,
            cost: `$${costUsd.toFixed(2)}`,
            costUsd,
          };
        });

      return { models };
    } catch {
      return { models: [] };
    }
  });
};

export default analyticsPlugin;
