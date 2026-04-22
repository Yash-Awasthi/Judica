/**
 * P4-27: Consensus explainability API.
 *
 * Exposes the scoring breakdown for a deliberation — agreement scores,
 * peer ranking, adversarial/grounding penalties, and final weighted score
 * for each council member's opinion.
 *
 * GET /api/deliberations/:id/scoring → { members: [...], consensus: {...} }
 */

import type { FastifyPluginAsync } from "fastify";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import { db } from "../lib/drizzle.js";
import { traces } from "../db/schema/traces.js";
import { eq, and } from "drizzle-orm";
import { AppError } from "../middleware/errorHandler.js";

const deliberationsPlugin: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /:id/scoring — Consensus explainability breakdown.
   *
   * Returns the per-member scoring detail stored in the deliberation trace.
   * Scoring fields: agreement, peerRanking, validationPenalty,
   *   adversarialPenalty, groundingPenalty, final.
   */
  fastify.get("/:id/scoring", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = request.userId!;

    // Deliberation results are stored as traces of type "deliberation"
    const [trace] = await db
      .select()
      .from(traces)
      .where(and(eq(traces.id, id), eq(traces.userId, userId)))
      .limit(1);

    if (!trace) {
      throw new AppError(404, "Deliberation not found");
    }

    // P37-07: Replace unsafe `as any` with proper type assertion
    const payload = (trace as unknown as { payload: Record<string, unknown> | null }).payload;
    const scoredOpinions = (payload?.scoredOpinions ?? payload?.scored ?? []) as Array<{
      name: string;
      scores?: {
        confidence?: number;
        agreement?: number;
        peerRanking?: number;
        validationPenalty?: number;
        adversarialPenalty?: number;
        groundingPenalty?: number;
        final?: number;
      };
    }>;

    const members = scoredOpinions.map((op) => ({
      name: op.name,
      confidence: op.scores?.confidence ?? null,
      agreement: op.scores?.agreement ?? null,
      peerRanking: op.scores?.peerRanking ?? null,
      validationPenalty: op.scores?.validationPenalty ?? 0,
      adversarialPenalty: op.scores?.adversarialPenalty ?? 0,
      groundingPenalty: op.scores?.groundingPenalty ?? 0,
      finalScore: op.scores?.final ?? null,
    }));

    const consensusReached = (payload?.consensusReached ?? null) as boolean | null;
    const consensusScore = (payload?.consensusScore ?? null) as number | null;

    return reply.send({
      deliberationId: id,
      members,
      consensus: {
        reached: consensusReached,
        score: consensusScore,
      },
      scoringWeights: {
        agreement: 0.6,
        peerRanking: 0.4,
        description: "finalScore = (0.6 * agreement + 0.4 * peerRanking) + penalties; outlier penalty if agreement < 0.5",
      },
    });
  });
  /**
   * P4-30: GET /:id/replay — Full deliberation replay.
   *
   * Returns the ordered sequence of events: opinions gathered,
   * peer reviews, scoring, consensus check, synthesis/verdict.
   * Enables debugging, auditing, and UI replay of a past deliberation.
   */
  fastify.get("/:id/replay", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = request.userId!;

    const [trace] = await db
      .select()
      .from(traces)
      .where(and(eq(traces.id, id), eq(traces.userId, userId)))
      .limit(1);

    if (!trace) {
      throw new AppError(404, "Deliberation not found");
    }

    // P37-07: Replace unsafe `as any` with proper type assertion
    const payload = (trace as unknown as { payload: Record<string, unknown> | null }).payload;

    // Reconstruct the deliberation timeline from the stored trace
    const timeline: Array<{
      phase: string;
      timestamp?: string;
      data: unknown;
    }> = [];

    if (payload?.opinions) {
      // P37-08: Cap opinions to prevent oversized responses
      const opinions = (payload.opinions as Array<{ name: string; opinion: string }>).slice(0, 200);
      timeline.push({
        phase: "gather_opinions",
        data: opinions.map((o) => ({
          name: o.name,
          opinion: typeof o.opinion === "string" ? o.opinion.substring(0, 500) : o.opinion,
        })),
      });
    }

    if (payload?.peerReviews) {
      timeline.push({
        phase: "peer_review",
        data: payload.peerReviews,
      });
    }

    if (payload?.scoredOpinions || payload?.scored) {
      timeline.push({
        phase: "scoring",
        data: ((payload.scoredOpinions ?? payload.scored) as Array<{ name: string; scores?: unknown }>).map((s) => ({
          name: s.name,
          scores: s.scores,
        })),
      });
    }

    if (payload?.consensusReached !== undefined) {
      timeline.push({
        phase: "consensus_check",
        data: {
          reached: payload.consensusReached,
          score: payload.consensusScore ?? null,
          round: payload.round ?? 1,
        },
      });
    }

    if (payload?.verdict || payload?.synthesis) {
      timeline.push({
        phase: "synthesis",
        data: {
          verdict: payload.verdict ?? payload.synthesis,
        },
      });
    }

    return reply.send({
      deliberationId: id,
      type: trace.type,
      createdAt: trace.createdAt,
      timeline,
      metadata: {
        totalPhases: timeline.length,
        memberCount: ((payload?.opinions as unknown[]) ?? []).length,
      },
    });
  });
};

export default deliberationsPlugin;
