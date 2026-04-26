/**
 * Phase 7.12 — Anti-Echo-Chamber Detection
 *
 * Detects when council members are too aligned (echoing each other) and either
 * surfaces a diversity warning or automatically injects a devil's advocate view.
 *
 * Detection: Computes cosine similarity between council member responses using
 * a lightweight token-frequency model. If the average pairwise similarity
 * exceeds the configured threshold, the run is flagged.
 *
 * Dissent injection: When enabled, routes a special "Contrarian Analyst" prompt
 * through the configured LLM to produce a well-reasoned opposing view.
 *
 * Free. No external service needed — similarity is computed in-process.
 *
 * Ref:
 *   Constitutional AI — https://arxiv.org/abs/2212.08073
 *   Debate (Irving et al.) — https://arxiv.org/abs/1805.00899
 *   Delphi method — https://en.wikipedia.org/wiki/Delphi_method
 */

import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import { db } from "../lib/drizzle.js";
import { userSettings } from "../db/schema/users.js";
import { eq } from "drizzle-orm";
import { askProvider } from "../lib/providers.js";
import { env } from "../config/env.js";
import logger from "../lib/logger.js";

const log = logger.child({ route: "echo-chamber" });

// ─── Similarity ───────────────────────────────────────────────────────────────

/** Tokenise to lowercase words, strip punctuation */
function tokenise(text: string): Map<string, number> {
  const freq = new Map<string, number>();
  const tokens = text.toLowerCase().replace(/[^\w\s]/g, " ").split(/\s+/).filter(Boolean);
  for (const t of tokens) freq.set(t, (freq.get(t) ?? 0) + 1);
  return freq;
}

/** Cosine similarity between two token-frequency maps */
function cosineSim(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0, normA = 0, normB = 0;
  for (const [k, v] of a) {
    dot   += v * (b.get(k) ?? 0);
    normA += v * v;
  }
  for (const [, v] of b) normB += v * v;
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/** Average pairwise cosine similarity across N texts */
function avgPairwiseSim(texts: string[]): number {
  if (texts.length < 2) return 0;
  const vecs = texts.map(tokenise);
  let total = 0, count = 0;
  for (let i = 0; i < vecs.length; i++) {
    for (let j = i + 1; j < vecs.length; j++) {
      total += cosineSim(vecs[i], vecs[j]);
      count++;
    }
  }
  return count === 0 ? 0 : total / count;
}

// ─── Config defaults ──────────────────────────────────────────────────────────

const DEFAULT_CONFIG = {
  /** Similarity above this triggers a warning (0–1) */
  diversityThreshold:  0.75,
  /** Automatically inject a dissenting view when threshold is exceeded */
  autoInjectDissent:   false,
  /** Minimum council size to apply the check */
  minCouncilSize:      3,
};

// ─── Schema ───────────────────────────────────────────────────────────────────

const detectSchema = z.object({
  /** Array of council member response texts to analyse */
  responses:  z.array(z.string().min(1).max(8000)).min(2).max(20),
  /** Override threshold for this single call */
  threshold:  z.number().min(0).max(1).optional(),
});

const injectDissentSchema = z.object({
  /** The original user query */
  query:      z.string().min(1).max(2000),
  /** The council responses to dissent against */
  responses:  z.array(z.string().min(1).max(4000)).min(1).max(10),
  /** How strong the dissent should be */
  strength:   z.enum(["gentle", "moderate", "strong"]).default("moderate"),
});

const configUpdateSchema = z.object({
  diversityThreshold: z.number().min(0).max(1).optional(),
  autoInjectDissent:  z.boolean().optional(),
  minCouncilSize:     z.number().int().min(2).max(20).optional(),
});

// ─── LLM helper ──────────────────────────────────────────────────────────────

const llmProvider = () => ({
  name: "openai" as const,
  type: "api" as const,
  apiKey: env.OPENAI_API_KEY ?? env.ANTHROPIC_API_KEY ?? "",
  model: env.OPENAI_API_KEY ? "gpt-4o-mini" : "claude-3-haiku-20240307",
  systemPrompt: `You are a Contrarian Analyst. Your role is to identify weaknesses, blind spots, and alternative perspectives that the council has missed. Be rigorous, specific, and constructive — not contrarian for its own sake.`,
});

// ─── Config helpers ───────────────────────────────────────────────────────────

async function getUserConfig(userId: string): Promise<typeof DEFAULT_CONFIG> {
  try {
    const rows = await db.select({ settings: userSettings.settings }).from(userSettings).where(eq(userSettings.userId, userId)).limit(1);
    const raw = rows[0]?.settings as Record<string, unknown> | undefined;
    const cfg = raw?.echoChamber as Partial<typeof DEFAULT_CONFIG> | undefined;
    return { ...DEFAULT_CONFIG, ...cfg };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

async function saveUserConfig(userId: string, config: typeof DEFAULT_CONFIG): Promise<void> {
  const current = await db.select({ settings: userSettings.settings }).from(userSettings).where(eq(userSettings.userId, userId)).limit(1);
  const existing = (current[0]?.settings as Record<string, unknown>) ?? {};
  await db.insert(userSettings).values({ userId, settings: { ...existing, echoChamber: config } })
    .onConflictDoUpdate({ target: userSettings.userId, set: { settings: { ...existing, echoChamber: config } } });
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

const echoChamberPlugin: FastifyPluginAsync = async (fastify) => {

  /**
   * POST /echo-chamber/detect
   * Analyse a set of council responses for echo-chamber patterns.
   * Returns a diversity score (0–1), pairwise similarities, and a flag if
   * the threshold is exceeded.
   */
  fastify.post("/detect", { preHandler: fastifyRequireAuth }, async (req, reply) => {
    const parsed = detectSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    const { responses, threshold: overrideThreshold } = parsed.data;

    const config = await getUserConfig(req.userId!);
    const threshold = overrideThreshold ?? config.diversityThreshold;

    const avgSim    = avgPairwiseSim(responses);
    const diversity = 1 - avgSim;          // 0 = identical, 1 = completely different
    const isEchoChamber = avgSim > threshold;

    // Pairwise matrix for debugging
    const vecs = responses.map(tokenise);
    const pairs: Array<{ i: number; j: number; similarity: number }> = [];
    for (let i = 0; i < vecs.length; i++) {
      for (let j = i + 1; j < vecs.length; j++) {
        pairs.push({ i, j, similarity: Math.round(cosineSim(vecs[i], vecs[j]) * 1000) / 1000 });
      }
    }

    return reply.send({
      isEchoChamber,
      diversityScore:     Math.round(diversity * 1000) / 1000,
      avgSimilarity:      Math.round(avgSim * 1000) / 1000,
      threshold,
      responseCount:      responses.length,
      pairwiseSimilarity: pairs,
      recommendation: isEchoChamber
        ? "Council responses are highly similar. Consider injecting a dissenting view via POST /echo-chamber/inject-dissent."
        : "Council diversity is within acceptable range.",
    });
  });

  /**
   * POST /echo-chamber/inject-dissent
   * Generate a well-reasoned dissenting view to counterbalance an aligned council.
   * Free — uses the user's configured LLM provider; no extra service needed.
   */
  fastify.post("/inject-dissent", { preHandler: fastifyRequireAuth }, async (req, reply) => {
    const parsed = injectDissentSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    const { query, responses, strength } = parsed.data;

    const strengthNote = {
      gentle:   "Acknowledge the council's merit, then add 2–3 specific, constructive counterpoints.",
      moderate: "Identify 3–5 key assumptions the council made that may be wrong. Give specific evidence for each.",
      strong:   "Build a complete alternative case that contradicts the council's main conclusion. Be thorough and cite reasoning.",
    }[strength];

    const councilSummary = responses.map((r, i) => `Member ${i + 1}: ${r.slice(0, 500)}`).join("\n\n");
    const prompt = `The user asked: "${query}"\n\nThe council responses (which are too similar) are:\n\n${councilSummary}\n\n${strengthNote}`;

    try {
      const dissent = await askProvider(llmProvider(), prompt);
      return reply.send({
        dissentingView: dissent,
        strength,
        injectedBy: "Anti-Echo-Chamber: Contrarian Analyst",
        note: "This is a generated counterpoint — evaluate it critically alongside the council's consensus.",
      });
    } catch (err) {
      log.error({ err }, "Dissent injection failed");
      return reply.status(502).send({ error: "Dissent generation failed" });
    }
  });

  /**
   * GET /echo-chamber/config
   * Get the current user's echo-chamber detection configuration.
   */
  fastify.get("/config", { preHandler: fastifyRequireAuth }, async (req, reply) => {
    const config = await getUserConfig(req.userId!);
    return reply.send({ config, defaults: DEFAULT_CONFIG });
  });

  /**
   * PATCH /echo-chamber/config
   * Update echo-chamber detection settings.
   */
  fastify.patch("/config", { preHandler: fastifyRequireAuth }, async (req, reply) => {
    const parsed = configUpdateSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    const current = await getUserConfig(req.userId!);
    const updated = { ...current, ...parsed.data };
    await saveUserConfig(req.userId!, updated);
    return reply.send({ config: updated });
  });
};

export default echoChamberPlugin;
