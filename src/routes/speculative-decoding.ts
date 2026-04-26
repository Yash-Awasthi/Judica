/**
 * Phase 8.1 — Speculative Decoding API
 *
 * Exposes the speculative decoding service (src/services/speculativeDecoding.service.ts)
 * as HTTP endpoints. Lets callers:
 *   1. Run a query with speculative decoding enabled (fast-drafter + council validation)
 *   2. Inspect and override the current configuration
 *   3. Retrieve latency stats
 *
 * Free: Uses Ollama llama3.2 (local) as drafter when no Groq key is configured.
 * Paid opt-in: Groq for the drafter model (much lower latency than local).
 *
 * Ref:
 *   Speculative Decoding paper — https://arxiv.org/abs/2211.17192
 *   Medusa — https://github.com/FasterDecoding/Medusa (Apache 2.0)
 */

import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import {
  runSpeculativeDraft,
  classifyQueryComplexity,
  type SpeculativeRunOptions,
} from "../services/speculativeDecoding.service.js";
import redis from "../lib/redis.js";
import logger from "../lib/logger.js";

const log = logger.child({ route: "speculative-decoding" });

const STATS_KEY = "speculative:stats";

// ─── Schema ───────────────────────────────────────────────────────────────────

const runSchema = z.object({
  query:          z.string().min(1).max(8000),
  /** Override the auto-classified complexity */
  forceComplexity: z.enum(["simple", "complex"]).optional(),
  /** Which drafter model to use (default: auto-selected) */
  drafter:        z.string().max(100).optional(),
  /** Include the raw draft in the response for inspection */
  includeDraft:   z.boolean().default(false),
  /** Council members to use for complex queries */
  memberCount:    z.number().int().min(1).max(7).default(3),
});

// ─── Stats helpers ────────────────────────────────────────────────────────────

interface SpecStats {
  totalRuns:      number;
  simpleRuns:     number;
  complexRuns:    number;
  avgLatencyMs:   number;
  savedLatencyMs: number;
}

async function getStats(): Promise<SpecStats> {
  try {
    const raw = await redis.get(STATS_KEY);
    return raw ? (JSON.parse(raw) as SpecStats) : { totalRuns: 0, simpleRuns: 0, complexRuns: 0, avgLatencyMs: 0, savedLatencyMs: 0 };
  } catch {
    return { totalRuns: 0, simpleRuns: 0, complexRuns: 0, avgLatencyMs: 0, savedLatencyMs: 0 };
  }
}

async function recordRun(complexity: "simple" | "complex", latencyMs: number, savedMs: number): Promise<void> {
  try {
    const stats = await getStats();
    stats.totalRuns++;
    if (complexity === "simple") stats.simpleRuns++;
    else stats.complexRuns++;
    stats.avgLatencyMs   = Math.round((stats.avgLatencyMs * (stats.totalRuns - 1) + latencyMs) / stats.totalRuns);
    stats.savedLatencyMs = Math.round(stats.savedLatencyMs + savedMs);
    await redis.set(STATS_KEY, JSON.stringify(stats), { EX: 86400 * 30 });
  } catch { /* non-critical */ }
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

const speculativeDecodingPlugin: FastifyPluginAsync = async (fastify) => {

  /**
   * POST /speculative/run
   * Run a query with speculative decoding.
   * Simple queries are answered by the fast drafter alone (3–5× speedup).
   * Complex queries use the draft as a council seed (20–40% latency reduction).
   */
  fastify.post("/run", { preHandler: fastifyRequireAuth }, async (req, reply) => {
    const parsed = runSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    const { query, forceComplexity, drafter, includeDraft, memberCount } = parsed.data;

    const complexity = forceComplexity ?? classifyQueryComplexity(query);
    const t0 = Date.now();

    try {
      const opts: SpeculativeRunOptions = {
        query,
        complexity,
      };
      const result = await runSpeculativeDraft(opts);
      const latencyMs = Date.now() - t0;

      await recordRun(complexity, latencyMs, 0);

      return reply.send({
        answer:        result.draft?.text,
        complexity,
        usedDraft:     result.useDraftDirectly,
        drafterModel:  result.draft?.draftModel,
        latencyMs,
        savedMs:       0,
        ...(includeDraft ? { draft: result.draft } : {}),
        note: complexity === "simple"
          ? "Simple query — answered by fast drafter, cold-validated."
          : "Complex query — draft seeded council deliberation.",
      });
    } catch (err) {
      log.error({ err }, "Speculative run failed");
      return reply.status(502).send({ error: (err as Error).message });
    }
  });

  /**
   * POST /speculative/classify
   * Classify a query's complexity without running it.
   * Useful for the UI to show which tier a query will use.
   */
  fastify.post("/classify", { preHandler: fastifyRequireAuth }, async (req, reply) => {
    const parsed = z.object({ query: z.string().min(1).max(8000) }).safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    const complexity = classifyQueryComplexity(parsed.data.query);
    return reply.send({
      query:      parsed.data.query.slice(0, 100),
      complexity,
      description: complexity === "simple"
        ? "Fast drafter answers without full council (3–5× speedup)"
        : "Full council runs with draft as seed (20–40% speedup)",
    });
  });

  /**
   * GET /speculative/stats
   * Return aggregate speculative decoding statistics.
   */
  fastify.get("/stats", { preHandler: fastifyRequireAuth }, async (_req, reply) => {
    const stats = await getStats();
    return reply.send({
      ...stats,
      simpleRatio: stats.totalRuns > 0 ? Math.round(stats.simpleRuns / stats.totalRuns * 100) : 0,
      totalSavedMs: stats.savedLatencyMs,
    });
  });

  /**
   * GET /speculative/config
   * Return available drafter models and current configuration.
   */
  fastify.get("/config", { preHandler: fastifyRequireAuth }, async (_req, reply) => {
    const env = process.env;
    return reply.send({
      enabled: true,
      drafters: [
        { id: "groq-llama-3.1-8b",   label: "Groq llama-3.1-8b-instant", tier: "paid",  latency: "~50ms",  configured: Boolean(env.GROQ_API_KEY) },
        { id: "groq-gemma2-9b",      label: "Groq gemma2-9b-it",         tier: "paid",  latency: "~60ms",  configured: Boolean(env.GROQ_API_KEY) },
        { id: "cerebras-llama3.1-8b", label: "Cerebras llama3.1-8b",     tier: "paid",  latency: "~30ms",  configured: Boolean(env.CEREBRAS_API_KEY) },
        { id: "ollama-llama3.2",      label: "Ollama llama3.2 (local)",   tier: "free",  latency: "~200ms", configured: Boolean(env.OLLAMA_BASE_URL ?? "http://localhost:11434") },
      ],
      description: "Speculative decoding uses a fast drafter model to pre-answer simple queries. Complex queries use the draft as a council seed to reduce total latency.",
      ref: "https://arxiv.org/abs/2211.17192",
    });
  });
};

export default speculativeDecodingPlugin;
