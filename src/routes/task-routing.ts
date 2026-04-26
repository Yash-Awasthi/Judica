/**
 * Phase 8.3 — Intelligent Task Routing API
 *
 * Exposes the task router (src/services/taskRouter.service.ts) as HTTP endpoints.
 * Classifies queries into 4 complexity tiers and routes to the appropriate
 * council configuration, saving cost without sacrificing quality.
 *
 * Tier 1 (TRIVIAL):  Single fast model, no council, no synthesis
 * Tier 2 (SIMPLE):   Single best model + cold validator
 * Tier 3 (STANDARD): Full council (3 members), standard deliberation
 * Tier 4 (COMPLEX):  Full council (5–7 members), all phases, full evals
 *
 * Classification is transparent and overridable from the UI.
 * Free — no external service needed; classification runs in-process.
 *
 * Ref:
 *   RouteLLM — https://github.com/lm-sys/RouteLLM (MIT, LMSYS, 3k stars)
 *   Martian  — https://withmartian.com/ (intelligent model routing)
 */

import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import { classifyAndRoute, applyRouteDecision } from "../services/taskRouter.service.js";
import redis from "../lib/redis.js";
import logger from "../lib/logger.js";

const log = logger.child({ route: "task-routing" });

const STATS_KEY   = "task_routing:stats";
const CONFIG_KEY  = "task_routing:config";

// ─── Schema ───────────────────────────────────────────────────────────────────

const classifySchema = z.object({
  query: z.string().min(1).max(8000),
  /** Include the feature vector used for classification */
  explain: z.boolean().default(false),
});

const configUpdateSchema = z.object({
  enabled:          z.boolean().optional(),
  /** Override tier thresholds: confidence required to use a lower tier */
  trivialThreshold: z.number().min(0.5).max(1.0).optional(),
  simpleThreshold:  z.number().min(0.5).max(1.0).optional(),
  /** Disable the LLM meta-router (Stage 3) — saves ~50 tokens per ambiguous query */
  disableLlmRouter: z.boolean().optional(),
});

// ─── Stats ────────────────────────────────────────────────────────────────────

interface RoutingStats {
  totalClassified: number;
  tierCounts: { trivial: number; simple: number; standard: number; complex: number };
  avgConfidence: number;
  llmRouterCalls: number;
}

const EMPTY_STATS: RoutingStats = {
  totalClassified: 0,
  tierCounts: { trivial: 0, simple: 0, standard: 0, complex: 0 },
  avgConfidence: 0,
  llmRouterCalls: 0,
};

async function getStats(): Promise<RoutingStats> {
  try {
    const raw = await redis.get(STATS_KEY);
    return raw ? JSON.parse(raw) as RoutingStats : { ...EMPTY_STATS, tierCounts: { ...EMPTY_STATS.tierCounts } };
  } catch {
    return { ...EMPTY_STATS, tierCounts: { ...EMPTY_STATS.tierCounts } };
  }
}

async function recordDecision(tier: string, confidence: number, usedLlm: boolean): Promise<void> {
  try {
    const stats = await getStats();
    stats.totalClassified++;
    stats.tierCounts[tier as keyof typeof stats.tierCounts] = (stats.tierCounts[tier as keyof typeof stats.tierCounts] ?? 0) + 1;
    stats.avgConfidence = (stats.avgConfidence * (stats.totalClassified - 1) + confidence) / stats.totalClassified;
    if (usedLlm) stats.llmRouterCalls++;
    await redis.set(STATS_KEY, JSON.stringify(stats), { EX: 86400 * 30 });
  } catch { /* non-critical */ }
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

const taskRoutingPlugin: FastifyPluginAsync = async (fastify) => {

  /**
   * POST /task-routing/classify
   * Classify a query and return its complexity tier + recommended council config.
   * The result is transparent and can be overridden by the user.
   */
  fastify.post("/classify", { preHandler: fastifyRequireAuth }, async (req, reply) => {
    const parsed = classifySchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    const { query, explain } = parsed.data;

    try {
      const decision = await classifyAndRoute(query);
      const councilConfig = applyRouteDecision([], decision);

      await recordDecision(decision.tier, decision.confidence, decision.stage === 3);

      return reply.send({
        tier:          decision.tier,
        confidence:    Math.round(decision.confidence * 1000) / 1000,
        classifiedBy:  `Stage ${decision.stage} (${["", "heuristic", "feature-based", "LLM meta-router"][decision.stage]})`,
        councilConfig,
        overridable:   true,
        ...(explain ? { reasoning: decision.reason } : {}),
        tierDescriptions: {
          trivial:  "Single fast model, no council. For factual lookups, simple math, yes/no.",
          simple:   "Single best model + cold validator. For straightforward questions.",
          standard: "3-member council, standard deliberation. For analysis and reasoning.",
          complex:  "5–7 member council, all phases. For strategic decisions and deep research.",
        },
      });
    } catch (err) {
      log.error({ err }, "Classification failed");
      return reply.status(502).send({ error: "Classification failed" });
    }
  });

  /**
   * GET /task-routing/stats
   * Routing distribution metrics: how many queries landed in each tier.
   */
  fastify.get("/stats", { preHandler: fastifyRequireAuth }, async (_req, reply) => {
    const stats = await getStats();
    const total = stats.totalClassified;
    const pct = (n: number) => total > 0 ? Math.round(n / total * 100) : 0;

    return reply.send({
      ...stats,
      tierPercents: {
        trivial:  pct(stats.tierCounts.trivial),
        simple:   pct(stats.tierCounts.simple),
        standard: pct(stats.tierCounts.standard),
        complex:  pct(stats.tierCounts.complex),
      },
      llmRouterCallRate: total > 0 ? Math.round(stats.llmRouterCalls / total * 100) : 0,
    });
  });

  /**
   * GET /task-routing/config
   * Current routing configuration.
   */
  fastify.get("/config", { preHandler: fastifyRequireAuth }, async (_req, reply) => {
    const env = process.env;
    let config: Record<string, unknown> = {};
    try {
      const raw = await redis.get(CONFIG_KEY);
      if (raw) config = JSON.parse(raw) as Record<string, unknown>;
    } catch { /* use defaults */ }

    return reply.send({
      config: {
        enabled:          config.enabled          ?? (env.INTELLIGENT_ROUTING_ENABLED !== "false"),
        trivialThreshold: config.trivialThreshold ?? 0.90,
        simpleThreshold:  config.simpleThreshold  ?? 0.75,
        disableLlmRouter: config.disableLlmRouter ?? false,
      },
      groqConfigured: Boolean(env.GROQ_API_KEY),
      note: "When disableLlmRouter=true, Stage 3 (LLM meta-router) is skipped. Saves ~50 tokens per ambiguous query at the cost of slightly lower classification accuracy.",
    });
  });

  /**
   * PATCH /task-routing/config
   * Update routing configuration.
   */
  fastify.patch("/config", { preHandler: fastifyRequireAuth }, async (req, reply) => {
    const parsed = configUpdateSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    let current: Record<string, unknown> = {};
    try {
      const raw = await redis.get(CONFIG_KEY);
      if (raw) current = JSON.parse(raw) as Record<string, unknown>;
    } catch { /* start fresh */ }

    const updated = { ...current, ...parsed.data };
    await redis.set(CONFIG_KEY, JSON.stringify(updated));

    return reply.send({ config: updated, applied: true });
  });
};

export default taskRoutingPlugin;
