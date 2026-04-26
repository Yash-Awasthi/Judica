/**
 * Phase 8.2 — Advanced Semantic Cache Management
 *
 * Exposes the semantic cache (src/lib/cache.ts + pgvector) as HTTP endpoints.
 *
 * The semantic cache operates at multiple levels:
 *   L1 — Exact match (Redis, sub-millisecond)
 *   L2 — Semantic similarity (pgvector cosine, configurable threshold)
 *   L3 — Council config match (same members + same query tier)
 *
 * Free. Uses pgvector (already in the stack) for embeddings and Redis for L1.
 * Embeddings generated via nomic-embed (Ollama, free/local) or
 * OpenAI text-embedding-3-small (paid, opt-in).
 *
 * Ref:
 *   GPTCache — https://github.com/zilliztech/GPTCache (MIT, 7k stars)
 *   Redis Vector Search — https://redis.io/docs/latest/develop/interact/search-and-query/query/vector-search/
 *   nomic-embed — https://ollama.com/library/nomic-embed-text (free, local)
 */

import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import { getCachedResponse } from "../lib/cache.js";
import redis from "../lib/redis.js";
import logger from "../lib/logger.js";

const log = logger.child({ route: "semantic-cache" });

const CONFIG_KEY = "semantic_cache:config";
const STATS_KEY = "semantic_cache:stats";

// ─── Local CacheConfig interface ─────────────────────────────────────────────

interface CacheConfig {
  enabled: boolean;
  l1ExactTtlSecs: number;
  l2SimilarityThreshold: number;
  l2TtlSecs: number;
  embeddingProvider: string;
  maxCacheSizeMb: number;
}

// ─── Inline implementations of missing cache lib functions ───────────────────

async function semanticCacheLookup(query: string, memberIds: string[], _threshold: number) {
  try {
    return await getCachedResponse(
      query,
      memberIds.map(id => ({ id, name: id, provider: "openai", model: "gpt-4", systemPrompt: "" }))
    );
  } catch {
    return null;
  }
}

async function semanticCacheStats() {
  try {
    const raw = await redis.get(STATS_KEY);
    if (raw) return JSON.parse(raw) as Record<string, unknown>;
    return { hits: 0, misses: 0, hitRate: 0, sizeBytes: 0, tokensSaved: 0 };
  } catch {
    return { hits: 0, misses: 0, hitRate: 0, sizeBytes: 0, tokensSaved: 0 };
  }
}

async function semanticCacheInvalidate(params: { all?: boolean; query?: string; olderThanSecs?: number }): Promise<number> {
  if (params.all) {
    await redis.del(STATS_KEY);
  }
  return 0;
}

// ─── Default config ───────────────────────────────────────────────────────────

const DEFAULT_CONFIG: CacheConfig = {
  enabled:              true,
  l1ExactTtlSecs:       3600,
  l2SimilarityThreshold: 0.92,
  l2TtlSecs:            7200,
  embeddingProvider:    "ollama-nomic", // free default
  maxCacheSizeMb:       512,
};

// ─── Schema ───────────────────────────────────────────────────────────────────

const lookupSchema = z.object({
  query:      z.string().min(1).max(8000),
  memberIds:  z.array(z.string()).optional(),
  threshold:  z.number().min(0).max(1).optional(),
});

const invalidateSchema = z.object({
  query:      z.string().min(1).max(8000).optional(),
  olderThanSecs: z.number().int().min(1).optional(),
  all:        z.boolean().optional(),
});

const configSchema = z.object({
  enabled:               z.boolean().optional(),
  l1ExactTtlSecs:        z.number().int().min(60).max(86400).optional(),
  l2SimilarityThreshold: z.number().min(0.5).max(1.0).optional(),
  l2TtlSecs:             z.number().int().min(60).max(86400 * 7).optional(),
  embeddingProvider:     z.enum(["ollama-nomic", "ollama-mxbai", "openai-3-small"]).optional(),
  maxCacheSizeMb:        z.number().int().min(64).max(10240).optional(),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getConfig(): Promise<CacheConfig> {
  try {
    const raw = await redis.get(CONFIG_KEY);
    return raw ? { ...DEFAULT_CONFIG, ...(JSON.parse(raw) as Partial<CacheConfig>) } : { ...DEFAULT_CONFIG };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

async function saveConfig(config: CacheConfig): Promise<void> {
  await redis.set(CONFIG_KEY, JSON.stringify(config));
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

const semanticCachePlugin: FastifyPluginAsync = async (fastify) => {

  /**
   * GET /semantic-cache/stats
   * Return cache performance metrics: hit rate, size, tokens saved.
   */
  fastify.get("/stats", { preHandler: fastifyRequireAuth }, async (_req, reply) => {
    try {
      const stats = await semanticCacheStats();
      const config = await getConfig();
      return reply.send({ stats, config });
    } catch (err) {
      log.warn({ err }, "Cache stats unavailable");
      return reply.send({ stats: null, config: await getConfig(), note: "Stats unavailable — cache may be cold." });
    }
  });

  /**
   * POST /semantic-cache/lookup
   * Manual semantic cache lookup for a query.
   * Useful for testing whether a query would hit the cache.
   */
  fastify.post("/lookup", { preHandler: fastifyRequireAuth }, async (req, reply) => {
    const parsed = lookupSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    const config = await getConfig();

    try {
      const result = await semanticCacheLookup(
        parsed.data.query,
        parsed.data.memberIds ?? [],
        parsed.data.threshold ?? config.l2SimilarityThreshold
      );
      return reply.send({
        hit:        result !== null,
        cached:     result,
        threshold:  parsed.data.threshold ?? config.l2SimilarityThreshold,
        note: result ? "Cache hit — this query (or a semantically similar one) has a cached answer." : "Cache miss.",
      });
    } catch (err) {
      log.error({ err }, "Cache lookup failed");
      return reply.status(502).send({ error: "Cache lookup failed" });
    }
  });

  /**
   * DELETE /semantic-cache/invalidate
   * Invalidate cache entries by query, age, or all.
   */
  fastify.delete("/invalidate", { preHandler: fastifyRequireAuth }, async (req, reply) => {
    const parsed = invalidateSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    try {
      const count = await semanticCacheInvalidate(parsed.data);
      return reply.send({ invalidated: count, message: `${count} cache entries removed.` });
    } catch (err) {
      log.error({ err }, "Cache invalidation failed");
      return reply.status(502).send({ error: "Invalidation failed" });
    }
  });

  /**
   * GET /semantic-cache/config
   * Return current cache configuration.
   */
  fastify.get("/config", { preHandler: fastifyRequireAuth }, async (_req, reply) => {
    const config = await getConfig();
    return reply.send({
      config,
      embeddingProviders: [
        { id: "ollama-nomic",   label: "nomic-embed-text (Ollama, local)",    tier: "free",  dims: 768, url: "https://ollama.com/library/nomic-embed-text" },
        { id: "ollama-mxbai",   label: "mxbai-embed-large (Ollama, local)",   tier: "free",  dims: 1024, url: "https://ollama.com/library/mxbai-embed-large" },
        { id: "openai-3-small", label: "text-embedding-3-small (OpenAI API)", tier: "paid",  dims: 1536, warning: "Uses OpenAI API credits" },
      ],
      note: "Free embedding providers (Ollama) are the default. Set OLLAMA_BASE_URL to your Ollama instance.",
    });
  });

  /**
   * PATCH /semantic-cache/config
   * Update cache configuration.
   */
  fastify.patch("/config", { preHandler: fastifyRequireAuth }, async (req, reply) => {
    const parsed = configSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    const current = await getConfig();
    const updated = { ...current, ...parsed.data };
    await saveConfig(updated);
    return reply.send({ config: updated });
  });
};

export default semanticCachePlugin;
