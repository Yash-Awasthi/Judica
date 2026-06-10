/**
 * ULTRAPLINIAN route — POST /api/ultraplinian and /api/ultraplinian/stream
 *
 * Fires N models in parallel (tier: 10 | 24 | 36 | 45 | 51),
 * scores each response, and returns the winner + all results.
 *
 * SSE stream: emits one event per model as it completes, then a `done` event.
 */

import type { FastifyPluginAsync } from "fastify";
import { fastifyOptionalAuth } from "../middleware/fastifyAuth.js";
import { AppError } from "../middleware/errorHandler.js";
import logger from "../lib/logger.js";
import {
  runUltraPlinian,
  getSlotsForTier,
  ULTRAPLINIAN_TIERS,
  type UltraPlinianTier,
  type UltraPlinianResponse,
} from "../lib/ultraplinian.js";

const VALID_TIERS = new Set<number>(ULTRAPLINIAN_TIERS);

function parseTier(raw: unknown): UltraPlinianTier {
  const n = Number(raw);
  if (!VALID_TIERS.has(n)) {
    throw new AppError(
      400,
      `Invalid tier. Must be one of: ${ULTRAPLINIAN_TIERS.join(", ")}`,
      "INVALID_TIER"
    );
  }
  return n as UltraPlinianTier;
}

const ultraplinianPlugin: FastifyPluginAsync = async (fastify) => {
  // ── GET / — describe available tiers ──────────────────────────────────────
  fastify.get("/", async (_request, _reply) => {
    return {
      description: "ULTRAPLINIAN — ultra-parallel multi-model querying",
      tiers: ULTRAPLINIAN_TIERS,
      scoring: {
        quality: "40% — response length/substance proxy",
        latency: "40% — lower latency scores higher",
        token: "20% — token efficiency (300-600 optimal)",
      },
    };
  });

  // ── GET /slots/:tier — list models for a tier ──────────────────────────────
  fastify.get<{ Params: { tier: string } }>("/slots/:tier", async (request, _reply) => {
    const tier = parseTier(request.params.tier);
    try {
      const slots = getSlotsForTier(tier);
      return {
        tier,
        count: slots.length,
        slots: slots.map((s) => ({
          id: s.id,
          label: s.label,
          model: s.model,
          provider: s.provider,
        })),
      };
    } catch (e) {
      throw new AppError(422, e instanceof Error ? e.message : "Failed to build slot pool", "SLOT_BUILD_FAILED");
    }
  });

  // ── POST / — blocking, returns full result ────────────────────────────────
  fastify.post<{ Body: { question: string; tier?: number } }>(
    "/",
    { preHandler: fastifyOptionalAuth },
    async (request, reply) => {
      const { question, tier: rawTier = 10 } = request.body ?? {};

      if (!question || typeof question !== "string" || question.trim().length === 0) {
        throw new AppError(400, "question is required", "MISSING_QUESTION");
      }
      if (question.length > 4000) {
        throw new AppError(400, "question must be under 4000 characters", "QUESTION_TOO_LONG");
      }

      const tier = parseTier(rawTier);

      try {
        const result = await runUltraPlinian(question.trim(), tier);
        reply.code(200);
        return result;
      } catch (e) {
        if (e instanceof AppError) throw e;
        const msg = e instanceof Error ? e.message : "ULTRAPLINIAN failed";
        logger.error({ err: e, tier }, "ULTRAPLINIAN error");
        throw new AppError(500, msg, "ULTRAPLINIAN_ERROR");
      }
    }
  );

  // ── POST /stream — SSE streaming, emits responses as they arrive ──────────
  fastify.post<{ Body: { question: string; tier?: number } }>(
    "/stream",
    { preHandler: fastifyOptionalAuth },
    async (request, reply) => {
      const { question, tier: rawTier = 10 } = request.body ?? {};

      if (!question || typeof question !== "string" || question.trim().length === 0) {
        reply.code(400).send({ error: "question is required" });
        return;
      }
      if (question.length > 4000) {
        reply.code(400).send({ error: "question must be under 4000 characters" });
        return;
      }

      const tier = parseTier(rawTier);

      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
        "Access-Control-Allow-Origin": "*",
      });

      const emit = (type: string, data: Record<string, unknown>) => {
        if (!reply.raw.writableEnded) {
          reply.raw.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
        }
      };

      // Abort on client disconnect
      const controller = new AbortController();
      request.raw.on("close", () => controller.abort());
      request.raw.on("error", () => controller.abort());

      try {
        // Emit tier info so the frontend can set up the grid
        let slotCount: number = tier;
        try {
          const slots = getSlotsForTier(tier);
          slotCount = slots.length;
          emit("init", {
            tier,
            slots: slots.map((s) => ({ id: s.id, label: s.label, model: s.model, provider: s.provider })),
          });
        } catch (e) {
          emit("error", { message: e instanceof Error ? e.message : "Failed to build slot pool" });
          reply.raw.end();
          return;
        }

        const result = await runUltraPlinian(
          question.trim(),
          tier,
          controller.signal,
          (res: UltraPlinianResponse) => {
            emit("response", {
              id: res.id,
              label: res.label,
              model: res.model,
              text: res.text,
              latencyMs: res.latencyMs,
              tokens: res.tokens,
              compositeScore: res.compositeScore,
              latencyScore: res.latencyScore,
              qualityScore: res.qualityScore,
              tokenScore: res.tokenScore,
              status: res.status,
              error: res.error,
            });
          }
        );

        // Emit error responses too (they aren't emitted via onResponse)
        for (const r of result.responses) {
          if (r.status === "error") {
            emit("response", {
              id: r.id,
              label: r.label,
              model: r.model,
              text: "",
              latencyMs: r.latencyMs,
              tokens: 0,
              compositeScore: 0,
              latencyScore: 0,
              qualityScore: 0,
              tokenScore: 0,
              status: "error",
              error: r.error,
            });
          }
        }

        emit("done", {
          tier: result.tier,
          totalMs: result.totalMs,
          winnerId: result.winner?.id,
          winnerLabel: result.winner?.label,
          winnerScore: result.winner?.compositeScore,
          responseCount: result.responses.length,
          successCount: result.responses.filter((r) => r.status === "done").length,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "ULTRAPLINIAN stream failed";
        logger.error({ err: e, tier }, "ULTRAPLINIAN stream error");
        emit("error", { message: msg });
      } finally {
        if (!reply.raw.writableEnded) {
          reply.raw.end();
        }
      }
    }
  );
};

export default ultraplinianPlugin;
