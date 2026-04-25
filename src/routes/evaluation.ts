import type { FastifyPluginAsync } from "fastify";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import {
  evaluateCouncilSession,
  getUserEvaluationMetrics,
  benchmarkCouncilPerformance
} from "../lib/evaluation.js";
import type { AgentOutput } from "../lib/schemas.js";
import { AppError } from "../middleware/errorHandler.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseDays(days: unknown): number {
  const parsed = parseInt(days as string);
  if (isNaN(parsed) || parsed < 1) return 30;
  if (parsed > 365) return 365;
  return parsed;
}

// ─── Plugin ─────────────────────────────────────────────────────────────────

const evaluationPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.post("/session", { preHandler: fastifyRequireAuth }, async (request, _reply) => {
    const {
      sessionId,
      conversationId,
      agentOutputs,
      totalTokens,
      duration,
      userFeedback
    } = request.body as {
      sessionId?: string;
      conversationId?: string;
      agentOutputs?: AgentOutput[];
      totalTokens?: number;
      duration?: number;
      userFeedback?: number;
    };

    if (!sessionId || !conversationId || !agentOutputs || !totalTokens || !duration) {
      throw new AppError(400, "Missing required fields: sessionId, conversationId, agentOutputs, totalTokens, duration");
    }

    const result = await evaluateCouncilSession(
      sessionId,
      conversationId,
      request.userId!,
      agentOutputs,
      totalTokens,
      duration,
      userFeedback
    );

    return {
      success: true,
      evaluation: result
    };
  });

  fastify.get("/metrics", { preHandler: fastifyRequireAuth }, async (request, _reply) => {
    const { days = 30 } = request.query as { days?: string };
    const metrics = await getUserEvaluationMetrics(request.userId!, parseDays(days));

    return {
      metrics,
      period: `${days} days`
    };
  });

  fastify.get("/benchmark", { preHandler: fastifyRequireAuth }, async (request, _reply) => {
    const { councilSize = 3, queryComplexity = 'moderate' } = request.query as {
      councilSize?: string;
      queryComplexity?: string;
    };

    const size = Math.max(1, Math.min(10, parseInt(councilSize as string) || 3));
    const validComplexities = ["simple", "moderate", "complex"] as const;
    const complexity = validComplexities.includes(queryComplexity as any)
      ? queryComplexity as 'simple' | 'moderate' | 'complex'
      : 'moderate';

    const benchmark = await benchmarkCouncilPerformance(
      request.userId!,
      size,
      complexity
    );

    return {
      benchmark,
      councilSize,
      queryComplexity
    };
  });

  fastify.get("/dashboard", { preHandler: fastifyRequireAuth }, async (request, _reply) => {
    const { days = 30 } = request.query as { days?: string };
    const daysNum = parseDays(days);

    const [metrics, benchmark] = await Promise.all([
      getUserEvaluationMetrics(request.userId!, daysNum),
      benchmarkCouncilPerformance(request.userId!, 3, 'moderate')
    ]);

    return {
      currentPerformance: {
        overallScore: metrics.averageConsensus * 25 + metrics.averageQuality * 25 + metrics.averageDiversity * 25 + metrics.averageEfficiency * 25,
        consensus: metrics.averageConsensus,
        quality: metrics.averageQuality,
        diversity: metrics.averageDiversity,
        efficiency: metrics.averageEfficiency,
        trend: metrics.improvementTrend
      },
      benchmark,
      totalEvaluations: metrics.totalEvaluations,
      period: `${days} days`
    };
  });
};

export default evaluationPlugin;
