import { FastifyPluginAsync } from "fastify";
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

const costsPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.get("/breakdown", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const { days = 30 } = request.query as { days?: string };
    const breakdown = await getUserCostBreakdown(request.userId!, parseInt(days as string));

    return reply.send({
      breakdown,
      period: `${days} days`,
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
    const metrics = await getCostEfficiencyMetrics(request.userId!, parseInt(days as string));

    return reply.send(metrics);
  });

  fastify.get("/pricing", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    return reply.send({
      pricing: DEFAULT_COST_CONFIG,
      currency: "USD",
      lastUpdated: new Date().toISOString()
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
    const summary = await getOrganizationCostSummary(parseInt(days as string));

    return reply.send({
      summary,
      period: `${days} days`,
      currency: "USD"
    });
  });

  fastify.get("/dashboard", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const { days = 30 } = request.query as { days?: string };
    const daysNum = parseInt(days as string);

    const [breakdown, efficiency, limits] = await Promise.all([
      getUserCostBreakdown(request.userId!, daysNum),
      getCostEfficiencyMetrics(request.userId!, daysNum),
      checkUserCostLimits(request.userId!)
    ]);

    return reply.send({
      currentPeriod: {
        totalCost: breakdown.totalCost,
        totalTokens: breakdown.totalTokens,
        avgCostPerRequest: breakdown.totalCost / Object.values(breakdown.byTimeframe).reduce((sum: number, day: any) => sum + day.requests, 0) || 0
      },
      efficiency,
      limits,
      trends: breakdown.byTimeframe,
      topProviders: Object.entries(breakdown.byProvider)
        .sort(([, a]: any, [, b]: any) => b.cost - a.cost)
        .slice(0, 5)
        .map(([provider, data]: any) => ({ provider, ...data })),
      currency: "USD"
    });
  });
};

export default costsPlugin;
