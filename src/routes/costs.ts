import type { FastifyPluginAsync } from "fastify";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import { db } from "../lib/drizzle.js";
import { users } from "../db/schema/users.js";
import { eq } from "drizzle-orm";
import {
  getUserCostBreakdown,
  getOrganizationCostSummary,
  checkUserCostLimits,
  getCostEfficiencyMetrics,
  DEFAULT_COST_CONFIG
} from "../lib/cost.js";
import { AppError } from "../middleware/errorHandler.js";

function parseDays(days: unknown): number {
  const parsed = parseInt(days as string);
  if (isNaN(parsed) || parsed < 1) return 30;
  if (parsed > 365) return 365;
  return parsed;
}

const costsPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.get("/breakdown", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const { days = 30 } = request.query as { days?: string };
    const daysNum = parseDays(days);
    const breakdown = await getUserCostBreakdown(request.userId!, daysNum);

    return reply.send({
      breakdown,
      period: `${daysNum} days`,
      currency: "USD"
    });
  });

  fastify.get("/limits", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const { dailyLimit, monthlyLimit } = request.query as {
      dailyLimit?: string;
      monthlyLimit?: string;
    };

    const limits = await checkUserCostLimits(
      request.userId!,
      dailyLimit ? parseFloat(dailyLimit) : undefined,
      monthlyLimit ? parseFloat(monthlyLimit) : undefined
    );

    return reply.send(limits);
  });

  fastify.get("/efficiency", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const { days = 30 } = request.query as { days?: string };
    const metrics = await getCostEfficiencyMetrics(request.userId!, parseDays(days));

    return reply.send(metrics);
  });

  fastify.get("/pricing", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    return reply.send({
      pricing: DEFAULT_COST_CONFIG,
      currency: "USD",
      lastUpdated: new Date().toISOString()
    });
  });

  /**
   * Per-provider cost ledger — detailed breakdown by provider.
   * GET /api/costs/per-provider?days=30
   */
  fastify.get("/per-provider", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const { days = "30" } = request.query as { days?: string };
    const daysNum = parseDays(days);
    const breakdown = await getUserCostBreakdown(request.userId!, daysNum);

    const providerLedger = Object.entries(breakdown.byProvider || {}).map(
      ([provider, data]) => {
        const d = data as { cost: number; tokens: number; requests: number; models?: Record<string, unknown> };
        return {
          provider,
          totalCost: d.cost ?? 0,
          totalTokens: d.tokens ?? 0,
          requestCount: d.requests ?? 0,
          models: d.models ?? {},
          avgCostPerRequest: d.requests ? (d.cost ?? 0) / d.requests : 0,
        };
      }
    ).sort((a, b) => b.totalCost - a.totalCost);

    return reply.send({
      providers: providerLedger,
      period: `${daysNum} days`,
      currency: "USD",
      grandTotal: providerLedger.reduce((sum, p) => sum + p.totalCost, 0),
    });
  });

  fastify.get("/organization", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const [user] = await db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, request.userId!))
      .limit(1);

    if (!user || user.role !== "admin") {
      throw new AppError(403, "Admin access required");
    }

    const { days = 30 } = request.query as { days?: string };
    const daysNum = parseDays(days);
    const summary = await getOrganizationCostSummary(daysNum);

    return reply.send({
      summary,
      period: `${daysNum} days`,
      currency: "USD"
    });
  });

  fastify.get("/dashboard", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const { days = 30 } = request.query as { days?: string };
    const daysNum = parseDays(days);

    const [breakdown, efficiency, limits] = await Promise.all([
      getUserCostBreakdown(request.userId!, daysNum),
      getCostEfficiencyMetrics(request.userId!, daysNum),
      checkUserCostLimits(request.userId!)
    ]);

    return reply.send({
      currentPeriod: {
        totalCost: breakdown.totalCost,
        totalTokens: breakdown.totalTokens,
        avgCostPerRequest: breakdown.totalCost / Object.values(breakdown.byTimeframe).reduce((sum: number, day: { requests: number }) => sum + day.requests, 0) || 0
      },
      efficiency,
      limits,
      trends: breakdown.byTimeframe,
      topProviders: Object.entries(breakdown.byProvider)
        .sort((a, b) => (b[1] as { cost: number }).cost - (a[1] as { cost: number }).cost)
        .slice(0, 5)
        .map(([provider, data]) => ({ provider, ...(data as Record<string, unknown>) })),
      currency: "USD"
    });
  });
};

export default costsPlugin;
