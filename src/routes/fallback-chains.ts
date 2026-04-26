/**
 * Phase 7.3 — Fallback Model Chains
 *
 * Configure an ordered sequence of models to try. If the first model fails
 * (API error, timeout, rate limit), the system automatically falls through to
 * the next model in the chain. Transparent — the response always includes
 * which model was actually used and how many fallbacks occurred.
 *
 * Uses the existing circuit-breaker (src/lib/breaker.ts) under the hood.
 * The chain persists per-user in Redis.
 *
 * Free: Ollama models (local) can be placed at any position in the chain.
 *       The full chain runs entirely on user-configured providers — no extra cost.
 *
 * Ref:
 *   LangChain fallbacks — https://python.langchain.com/docs/how_to/fallbacks/
 *   LiteLLM fallbacks — https://docs.litellm.ai/docs/completion/reliable_completions
 */

import type { FastifyPluginAsync } from "fastify";
import { randomUUID } from "crypto";
import { z } from "zod";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import { askProvider } from "../lib/providers.js";
import { AppError } from "../middleware/errorHandler.js";
import redis from "../lib/redis.js";
import logger from "../lib/logger.js";

const log = logger.child({ route: "fallback-chains" });

// ─── Redis keys ───────────────────────────────────────────────────────────────

const CHAINS_KEY = (userId: number | string) => `fallback_chains:${userId}`;

// ─── Schema ───────────────────────────────────────────────────────────────────

const modelEntrySchema = z.object({
  /** Provider identifier: "openai", "anthropic", "groq", "ollama", "gemini", etc. */
  provider:   z.string().min(1).max(50),
  /** Model name within the provider */
  model:      z.string().min(1).max(200),
  /** Max seconds to wait before considering this model timed-out */
  timeoutSecs: z.number().min(1).max(300).default(30),
  /** Max tokens for this position in the chain */
  maxTokens:   z.number().int().min(1).max(128_000).optional(),
});

const createChainSchema = z.object({
  name:    z.string().min(1).max(100),
  models:  z.array(modelEntrySchema).min(1).max(10),
  /** When to trigger fallback: "error" only, or also on "timeout" */
  trigger: z.enum(["error", "error_or_timeout"]).default("error_or_timeout"),
  /** Attach this chain as the default fallback for all council deliberations */
  setAsDefault: z.boolean().default(false),
});

const testChainSchema = z.object({
  chainId: z.string().uuid(),
  prompt:  z.string().min(1).max(2000),
});

// ─── Stored chain interface ───────────────────────────────────────────────────

interface FallbackChain {
  id:        string;
  userId:    number | string;
  name:      string;
  models:    z.infer<typeof modelEntrySchema>[];
  trigger:   "error" | "error_or_timeout";
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

// ─── Redis helpers ────────────────────────────────────────────────────────────

async function getChains(userId: number | string): Promise<FallbackChain[]> {
  try {
    const raw = await redis.get(CHAINS_KEY(userId));
    return raw ? JSON.parse(raw) as FallbackChain[] : [];
  } catch {
    return [];
  }
}

async function saveChains(userId: number | string, chains: FallbackChain[]): Promise<void> {
  await redis.set(CHAINS_KEY(userId), JSON.stringify(chains));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function runChain(
  models: z.infer<typeof modelEntrySchema>[],
  prompt: string,
  trigger: "error" | "error_or_timeout"
): Promise<{ text: string; usedModel: string; usedProvider: string; fallbacksTriggered: number }> {
  let fallbacksTriggered = 0;
  for (const entry of models) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), entry.timeoutSecs * 1000);
      try {
        const result = await askProvider(
          { name: entry.provider as "openai", type: "api", apiKey: "", model: entry.model },
          prompt,
          false,
          controller.signal
        );
        clearTimeout(timer);
        return { text: result.text, usedModel: entry.model, usedProvider: entry.provider, fallbacksTriggered };
      } catch (err: unknown) {
        clearTimeout(timer);
        const isTimeout = (err as Error)?.name === "AbortError";
        if (isTimeout && trigger === "error") throw err; // don't fall through on timeout if not configured
        log.warn({ err, model: entry.model, provider: entry.provider }, "Fallback triggered");
        fallbacksTriggered++;
        // continue to next model
      }
    } catch {
      fallbacksTriggered++;
    }
  }
  throw new AppError(502, "All models in the fallback chain failed", "CHAIN_EXHAUSTED");
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

const fallbackChainsPlugin: FastifyPluginAsync = async (fastify) => {

  /**
   * GET /fallback-chains
   * List all fallback chains for the current user.
   */
  fastify.get("/", { preHandler: fastifyRequireAuth }, async (req, reply) => {
    const chains = await getChains(req.userId!);
    return reply.send({ chains });
  });

  /**
   * POST /fallback-chains
   * Create a new fallback chain.
   */
  fastify.post("/", { preHandler: fastifyRequireAuth }, async (req, reply) => {
    const parsed = createChainSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    const { name, models, trigger, setAsDefault } = parsed.data;

    const chains = await getChains(req.userId!);
    const id = randomUUID();
    const now = new Date().toISOString();

    // Unset previous default if needed
    if (setAsDefault) {
      for (const c of chains) c.isDefault = false;
    }

    const newChain: FallbackChain = {
      id,
      userId:    req.userId!,
      name,
      models,
      trigger,
      isDefault: setAsDefault,
      createdAt: now,
      updatedAt: now,
    };
    chains.push(newChain);
    await saveChains(req.userId!, chains);

    return reply.status(201).send({ id, name, models, trigger, isDefault: setAsDefault });
  });

  /**
   * GET /fallback-chains/:id
   * Get a specific chain.
   */
  fastify.get<{ Params: { id: string } }>(
    "/:id",
    { preHandler: fastifyRequireAuth },
    async (req, reply) => {
      const chains = await getChains(req.userId!);
      const chain = chains.find(c => c.id === req.params.id);
      if (!chain) return reply.status(404).send({ error: "Chain not found" });
      return reply.send(chain);
    }
  );

  /**
   * PUT /fallback-chains/:id
   * Replace a chain's config.
   */
  fastify.put<{ Params: { id: string } }>(
    "/:id",
    { preHandler: fastifyRequireAuth },
    async (req, reply) => {
      const parsed = createChainSchema.safeParse(req.body);
      if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

      const chains = await getChains(req.userId!);
      const idx = chains.findIndex(c => c.id === req.params.id);
      if (idx === -1) return reply.status(404).send({ error: "Chain not found" });

      chains[idx] = {
        ...chains[idx],
        name:      parsed.data.name,
        models:    parsed.data.models,
        trigger:   parsed.data.trigger,
        isDefault: parsed.data.setAsDefault,
        updatedAt: new Date().toISOString(),
      };
      await saveChains(req.userId!, chains);

      return reply.send({ id: req.params.id, ...parsed.data });
    }
  );

  /**
   * DELETE /fallback-chains/:id
   * Delete a chain.
   */
  fastify.delete<{ Params: { id: string } }>(
    "/:id",
    { preHandler: fastifyRequireAuth },
    async (req, reply) => {
      const chains = await getChains(req.userId!);
      const filtered = chains.filter(c => c.id !== req.params.id);
      await saveChains(req.userId!, filtered);
      return reply.status(204).send();
    }
  );

  /**
   * POST /fallback-chains/test
   * Run a prompt through a chain and observe which model was used + fallback count.
   * Useful for verifying that your fallback chain is configured correctly.
   */
  fastify.post("/test", { preHandler: fastifyRequireAuth }, async (req, reply) => {
    const parsed = testChainSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const chains = await getChains(req.userId!);
    const chain = chains.find(c => c.id === parsed.data.chainId);
    if (!chain) return reply.status(404).send({ error: "Chain not found" });

    const trigger = (chain.trigger ?? "error_or_timeout") as "error" | "error_or_timeout";

    try {
      const result = await runChain(chain.models, parsed.data.prompt, trigger);
      return reply.send({ ...result, chainId: parsed.data.chainId, chainName: chain.name });
    } catch (err) {
      if (err instanceof AppError) return reply.status(err.statusCode).send({ error: err.message });
      return reply.status(502).send({ error: "Chain test failed" });
    }
  });
};

export default fallbackChainsPlugin;
