// P2-20: This file should live inside lib/cache/ directory.
// It's the cache CLIENT that uses backends from lib/cache/.
// Keeping it here for now to avoid import breakage, but new code should import from lib/cache/.
import crypto from "crypto";
import logger from "./logger.js";
import { env } from "../config/env.js";
import { redisBackend, postgresBackend } from "./cache/backends.js";
// P9-20: Import CacheEntry type — opinions type defined once in CacheBackend.ts
import type { CacheEntry } from "./cache/CacheBackend.js";

// P9-20: Use CacheEntry['opinions'] type from CacheBackend.ts — single source of truth
type CachedOpinion = CacheEntry['opinions'][number];

interface EmbeddingResponse {
  data?: Array<{ embedding: number[] }>;
}

interface CacheMemberConfig {
  model: string;
  temperature?: number;
  systemPrompt?: string;
  tools?: string[];
}

interface CacheMessage {
  role: string;
  content: string | unknown[];
}

// P38-10: NaN-safe threshold with range validation
const _parsedThreshold = Number((env as any).SEMANTIC_CACHE_THRESHOLD);
const SEMANTIC_THRESHOLD = Number.isFinite(_parsedThreshold) && _parsedThreshold >= 0 && _parsedThreshold <= 1 ? _parsedThreshold : 0.15;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// P9-12: Bounded lock map with TTL eviction — prevents unbounded growth under burst traffic
const MAX_LOCKS = 1000;
const LOCK_TTL_MS = 60_000; // 60 seconds max lock lifetime
const embeddingLocks = new Map<string, { promise: Promise<number[] | null>; createdAt: number }>();

// P9-12: Periodic cleanup of stale locks
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of embeddingLocks) {
    if (now - entry.createdAt > LOCK_TTL_MS) {
      embeddingLocks.delete(key);
    }
  }
}, 30_000).unref();

// P9-13: Log once at startup if embedding key is missing
let embeddingKeyWarned = false;

export async function getEmbeddingWithLock(text: string): Promise<number[] | null> {
  const key = crypto.createHash("sha256").update(text).digest("hex");

  const existing = embeddingLocks.get(key);
  if (existing) {
    return await existing.promise;
  }

  // P9-12: Evict oldest entry if at capacity
  if (embeddingLocks.size >= MAX_LOCKS) {
    const firstKey = embeddingLocks.keys().next().value;
    if (firstKey) embeddingLocks.delete(firstKey);
  }

  const promise = getEmbedding(text);
  embeddingLocks.set(key, { promise, createdAt: Date.now() });

  try {
    return await promise;
  } finally {
    embeddingLocks.delete(key);
  }
}

/**
 * P3-21: Cache key now includes userId to prevent cross-tenant data leakage.
 * Anonymous user cache entries are scoped to "anon" and won't be served to
 * authenticated users (and vice versa).
 */
export function generateCacheKey(prompt: string, members: CacheMemberConfig[], master?: CacheMemberConfig, history: CacheMessage[] = [], userId?: number | string): string {
  const memberConfigs = members.map(m => ({
    model: m.model,
    temp: m.temperature,
    system: m.systemPrompt,
    tools: m.tools ? [...m.tools].sort() : []
  })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

  // P9-15: Stable, minimal history serialization — only role + string content
  const stableHistory = history.map(h => ({
    role: h.role,
    content: typeof h.content === "string" ? h.content : JSON.stringify(h.content),
  }));

  const data = JSON.stringify({
    // P9-14: Use .trim() only, NOT .toLowerCase() — case-sensitive prompts are semantically different
    prompt: prompt.trim(),
    history: stableHistory,
    members: memberConfigs,
    master: master ? { model: master.model, system: master.systemPrompt } : null,
    // P3-21: Scope cache by tenant to prevent cross-tenant reads
    tenant: userId ?? "anon"
  });
  return crypto.createHash("sha256").update(data).digest("hex");
}

async function getEmbedding(text: string): Promise<number[] | null> {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) {
    // P9-13: Warn once when embedding key is missing — semantic cache silently disabled
    if (!embeddingKeyWarned) {
      logger.warn("OPENAI_API_KEY not set — semantic vector cache is disabled. Set the key to enable similarity-based caching.");
      embeddingKeyWarned = true;
    }
    return null;
  }

  try {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        input: text,
        model: "text-embedding-3-small",
      }),
    });
    const data: EmbeddingResponse = await res.json() as EmbeddingResponse;
    if (data.data?.[0]?.embedding) {
      return data.data[0].embedding;
    }
  } catch (err) {
    logger.warn({ error: (err as Error).message }, "Failed to fetch embeddings");
  }
  return null;
}

// P9-16: Deterministic cleanup counter replaces probabilistic Math.random()
let cleanupCounter = 0;
const CLEANUP_INTERVAL = 100; // cleanup every 100th read

export async function getCachedResponse(prompt: string, members: CacheMemberConfig[], master?: CacheMemberConfig, history: CacheMessage[] = [], userId?: number | string) {
  const keyHash = generateCacheKey(prompt, members, master, history, userId);

  const redisHit = await redisBackend.get(keyHash);
  if (redisHit) {
    logger.info({ keyHash, match: "exact", source: "redis" }, "Cache hit");
    return redisHit;
  }

  // P9-16: Deterministic cleanup — every Nth request instead of probabilistic
  cleanupCounter++;
  if (cleanupCounter >= CLEANUP_INTERVAL) {
    cleanupCounter = 0;
    postgresBackend.cleanup?.().catch(() => {});
  }

  const embedding = env.ENABLE_VECTOR_CACHE ? await getEmbeddingWithLock(prompt) : null;

  if (embedding) {
    const vectorHit = await postgresBackend.searchSemantic?.(embedding, SEMANTIC_THRESHOLD);
    if (vectorHit) {
      logger.info({ keyHash, match: "vector", distance: vectorHit.distance, source: "postgres" }, "Cache hit (vector)");
      const responseData: CacheEntry = {
        verdict: vectorHit.verdict,
        opinions: vectorHit.opinions
      };
      redisBackend.set(keyHash, responseData, CACHE_TTL_MS).catch(() => {});
      return responseData;
    }
  }

  const hit = await postgresBackend.get(keyHash);

  if (!hit) {
    return null;
  }

  logger.info({ keyHash, match: "exact", source: "postgres" }, "Cache hit");

  redisBackend.set(keyHash, hit, CACHE_TTL_MS).catch(() => {});

  return hit;
}

export async function setCachedResponse(
  prompt: string,
  members: CacheMemberConfig[],
  master: CacheMemberConfig | undefined,
  history: CacheMessage[],
  verdict: string,
  opinions: CachedOpinion[],
  userId?: number | string
) {
  const keyHash = generateCacheKey(prompt, members, master, history, userId);
  const embedding = env.ENABLE_VECTOR_CACHE ? await getEmbeddingWithLock(prompt) : null;

  const cacheEntry: CacheEntry = {
    verdict,
    opinions,
    metadata: { prompt: prompt.slice(0, 500) }
  };

  try {
    // P9-18: Write Redis first — subsequent reads check Redis first,
    // so a Redis failure after Postgres write causes missed cache hits.
    await redisBackend.set(keyHash, cacheEntry, CACHE_TTL_MS);

    // P9-19: Call setSemantic directly — method is always defined on PostgresBackend
    await postgresBackend.setSemantic(keyHash, prompt, cacheEntry, embedding, CACHE_TTL_MS);
  } catch (e) {
    logger.warn({ error: (e as Error).message }, "Failed to write to semantic cache");
  }
}
