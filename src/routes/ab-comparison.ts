/**
 * Quality & Honesty — Phase 7.15: A/B Model Comparison
 *
 * Inspired by:
 * - LMSYS Chatbot Arena — side-by-side blind model comparison with human preference.
 * - Locally Uncensored A/B comparison tools.
 *
 * Run any query against two different models/council configs simultaneously:
 * - Side-by-side text comparison
 * - Latency comparison
 * - Cost estimation
 * - Blind evaluation (which is better without knowing which is which)
 * - Historical A/B test results
 */

import type { FastifyInstance } from "fastify";
import { askProvider } from "../lib/providers.js";
import { env } from "../config/env.js";
import { z } from "zod";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ABResult {
  id: string;
  userId: number;
  prompt: string;
  modelA: string;
  modelB: string;
  responseA: string;
  responseB: string;
  latencyAMs: number;
  latencyBMs: number;
  userPreference?: "A" | "B" | "tie" | "both_bad";
  blindEvaluation?: { winner: "A" | "B" | "tie"; reasoning: string };
  createdAt: Date;
}

const abStore = new Map<string, ABResult>();
let abCounter = 1;

function abId(): string {
  return `ab_${Date.now()}_${abCounter++}`;
}

// ─── Provider cost estimates ($/1K tokens, approximate) ──────────────────────

const COST_MAP: Record<string, { input: number; output: number }> = {
  "gpt-4o":          { input: 0.005, output: 0.015 },
  "gpt-4o-mini":     { input: 0.00015, output: 0.0006 },
  "gpt-4-turbo":     { input: 0.01, output: 0.03 },
  "claude-3-5-sonnet-20241022": { input: 0.003, output: 0.015 },
  "claude-3-haiku-20240307":    { input: 0.00025, output: 0.00125 },
  "claude-3-opus-20240229":     { input: 0.015, output: 0.075 },
};

function estimateCost(model: string, promptTokens: number, completionTokens: number): number {
  const costs = COST_MAP[model];
  if (!costs) return 0;
  return (promptTokens / 1000) * costs.input + (completionTokens / 1000) * costs.output;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ─── Schema ───────────────────────────────────────────────────────────────────

const modelDef = z.object({
  model:        z.string().min(1).max(100),
  provider:     z.enum(["openai", "anthropic", "google", "custom"]).default("openai"),
  systemPrompt: z.string().max(2000).optional(),
  temperature:  z.number().min(0).max(2).optional(),
});

const abRunSchema = z.object({
  prompt:       z.string().min(1).max(4000),
  modelA:       modelDef,
  modelB:       modelDef,
  blind:        z.boolean().default(false),
  autoEvaluate: z.boolean().default(false),
});

const preferenceSchema = z.object({
  preference: z.enum(["A", "B", "tie", "both_bad"]),
  notes:      z.string().max(500).optional(),
});

// ─── Routes ──────────────────────────────────────────────────────────────────

export async function abComparisonPlugin(app: FastifyInstance) {

  /**
   * POST /ab/run
   * Run a prompt against two models simultaneously.
   */
  app.post("/ab/run", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = abRunSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { prompt, modelA, modelB, blind, autoEvaluate } = parsed.data;

    const makeProvider = (config: z.infer<typeof modelDef>) => ({
      name: config.provider as "openai" | "anthropic",
      type: "api" as const,
      apiKey: config.provider === "anthropic"
        ? (env.ANTHROPIC_API_KEY ?? "")
        : (env.OPENAI_API_KEY ?? ""),
      model: config.model,
      ...(config.systemPrompt ? { systemPrompt: config.systemPrompt } : {}),
    });

    // Run both models in parallel, measure latency
    const [resultA, resultB] = await Promise.allSettled([
      (async () => {
        const start = Date.now();
        const resp = await askProvider(makeProvider(modelA), [{ role: "user", content: prompt }]);
        return {
          text: typeof resp === "string" ? resp : (resp as any)?.content ?? "",
          latencyMs: Date.now() - start,
        };
      })(),
      (async () => {
        const start = Date.now();
        const resp = await askProvider(makeProvider(modelB), [{ role: "user", content: prompt }]);
        return {
          text: typeof resp === "string" ? resp : (resp as any)?.content ?? "",
          latencyMs: Date.now() - start,
        };
      })(),
    ]);

    const responseA = resultA.status === "fulfilled" ? resultA.value.text : `Error: ${(resultA.reason as Error)?.message}`;
    const responseB = resultB.status === "fulfilled" ? resultB.value.text : `Error: ${(resultB.reason as Error)?.message}`;
    const latencyAMs = resultA.status === "fulfilled" ? resultA.value.latencyMs : 0;
    const latencyBMs = resultB.status === "fulfilled" ? resultB.value.latencyMs : 0;

    const id = abId();
    const promptTokens = estimateTokens(prompt);
    const costA = estimateCost(modelA.model, promptTokens, estimateTokens(responseA));
    const costB = estimateCost(modelB.model, promptTokens, estimateTokens(responseB));

    // Auto blind evaluation
    let blindEvaluation: ABResult["blindEvaluation"] | undefined;
    if (autoEvaluate) {
      const evalPrompt = `Compare these two responses to the same prompt. Evaluate objectively without knowing which model produced each.

PROMPT: ${prompt.slice(0, 500)}

RESPONSE A:
${responseA.slice(0, 2000)}

RESPONSE B:
${responseB.slice(0, 2000)}

Which response is better? Consider: accuracy, completeness, clarity, helpfulness.

Return JSON: {"winner": "A|B|tie", "reasoning": "brief explanation"}`;

      const evalResp = await askProvider(
        { name: "openai", type: "api", apiKey: env.OPENAI_API_KEY ?? "", model: "gpt-4o-mini",
          systemPrompt: "You are a neutral evaluator. Compare responses objectively." },
        [{ role: "user", content: evalPrompt }],
      );
      const evalText = typeof evalResp === "string" ? evalResp : (evalResp as any)?.content ?? "";
      try {
        const match = evalText.match(/\{[\s\S]*\}/);
        if (match) blindEvaluation = JSON.parse(match[0]);
      } catch { /* ignore */ }
    }

    const result: ABResult = {
      id, userId, prompt,
      modelA: modelA.model, modelB: modelB.model,
      responseA, responseB, latencyAMs, latencyBMs,
      blindEvaluation,
      createdAt: new Date(),
    };
    abStore.set(id, result);

    const output: Record<string, unknown> = {
      success: true,
      id,
      prompt: prompt.slice(0, 100) + "...",
      latency: { A: latencyAMs, B: latencyBMs, winner: latencyAMs < latencyBMs ? "A" : "B" },
      cost: { A: costA.toFixed(6), B: costB.toFixed(6), cheaper: costA < costB ? "A" : "B" },
      blindEvaluation,
    };

    if (!blind) {
      output.models = { A: modelA.model, B: modelB.model };
      output.responses = { A: responseA, B: responseB };
    } else {
      // Blind mode: shuffle so user doesn't know which is which
      const swap = Math.random() > 0.5;
      output.responses = {
        [swap ? "A" : "A"]: swap ? responseB : responseA,
        [swap ? "B" : "B"]: swap ? responseA : responseB,
      };
      output._blindSwapped = swap; // internal — for preference recording
    }

    return reply.send(output);
  });

  /**
   * POST /ab/:id/preference
   * Record user preference for an A/B test.
   */
  app.post("/ab/:id/preference", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { id } = req.params as { id: string };
    const result = abStore.get(id);
    if (!result || result.userId !== userId) {
      return reply.status(404).send({ error: "A/B test not found" });
    }

    const parsed = preferenceSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    result.userPreference = parsed.data.preference;
    return reply.send({ success: true, preference: parsed.data.preference });
  });

  /**
   * GET /ab/:id
   * Get full A/B test result.
   */
  app.get("/ab/:id", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { id } = req.params as { id: string };
    const result = abStore.get(id);
    if (!result || result.userId !== userId) {
      return reply.status(404).send({ error: "A/B test not found" });
    }

    return reply.send({ success: true, result });
  });

  /**
   * GET /ab
   * List A/B test history.
   */
  app.get("/ab", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const results = [...abStore.values()]
      .filter(r => r.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 50)
      .map(({ responseA: _ra, responseB: _rb, ...rest }) => ({
        ...rest,
        promptPreview: rest.prompt.slice(0, 100),
      }));

    return reply.send({ success: true, results, count: results.length });
  });

  /**
   * GET /ab/stats
   * Aggregate stats: which models win most often.
   */
  app.get("/ab/stats", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const results = [...abStore.values()].filter(r => r.userId === userId && r.userPreference);

    const modelWins = new Map<string, { wins: number; tests: number; avgLatency: number }>();

    for (const result of results) {
      for (const key of ["A", "B"] as const) {
        const model = key === "A" ? result.modelA : result.modelB;
        const latency = key === "A" ? result.latencyAMs : result.latencyBMs;
        if (!modelWins.has(model)) modelWins.set(model, { wins: 0, tests: 0, avgLatency: 0 });
        const entry = modelWins.get(model)!;
        entry.tests++;
        entry.avgLatency = (entry.avgLatency * (entry.tests - 1) + latency) / entry.tests;
        if (result.userPreference === key) entry.wins++;
      }
    }

    const leaderboard = [...modelWins.entries()].map(([model, stats]) => ({
      model,
      winRate: stats.tests > 0 ? (stats.wins / stats.tests) : 0,
      ...stats,
    })).sort((a, b) => b.winRate - a.winRate);

    return reply.send({ success: true, leaderboard, totalTests: results.length });
  });
}
