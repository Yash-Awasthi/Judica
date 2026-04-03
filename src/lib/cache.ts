import crypto from "crypto";
import logger from "./logger.js";
import { env } from "../config/env.js";
import { redisBackend, postgresBackend } from "./cache/backends.js";
import type { CacheEntry } from "./cache/CacheBackend.js";

/**
 * CACHE ARCHITECTURE NOTE:
 * Primary lookup is an exact SHA-256 key match (prompt + members + history).
 * Vector similarity search is attempted when an OpenAI embedding key is available,
 * but falls back to exact match otherwise. This is NOT full semantic deduplication.
 * To enable true semantic caching, enable the pgvector extension and uncomment
 * the `embedding` column in `prisma/schema.prisma`.
 */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// Cache locking for embedding generation to prevent stampede
const embeddingLocks = new Map<string, Promise<number[] | null>>();

export async function getEmbeddingWithLock(text: string): Promise<number[] | null> {
  const key = crypto.createHash("md5").update(text).digest("hex");
  
  // Check if already in progress
  const existing = embeddingLocks.get(key);
  if (existing) {
    return await existing;
  }
  
  // Create new request and lock
  const promise = getEmbedding(text);
  embeddingLocks.set(key, promise);
  
  try {
    return await promise;
  } finally {
    embeddingLocks.delete(key);
  }
}

export function generateCacheKey(prompt: string, members: any[], master?: any, history: any[] = []): string {
  const memberConfigs = members.map(m => ({
    model: m.model,
    temp: m.temperature,
    system: m.systemPrompt,
    tools: m.tools ? [...m.tools].sort() : []
  })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

  const data = JSON.stringify({
    prompt: prompt.trim().toLowerCase(),
    history: history.map(h => ({ role: h.role, content: h.content })),
    members: memberConfigs,
    master: master ? { model: master.model, system: master.systemPrompt } : null
  });
  return crypto.createHash("sha256").update(data).digest("hex");
}

async function getEmbedding(text: string): Promise<number[] | null> {
  const apiKey = env.OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

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
    const data = await res.json() as any;
    if (data.data?.[0]?.embedding) {
      return data.data[0].embedding;
    }
  } catch (err) {
    logger.warn({ error: (err as Error).message }, "Failed to fetch embeddings");
  }
  return null;
}

export async function getCachedResponse(prompt: string, members: any[], master?: any, history: any[] = []) {
  const keyHash = generateCacheKey(prompt, members, master, history);
  
  // 1. Exact match via Redis (fastest)
  const redisHit = await redisBackend.get(keyHash);
  if (redisHit) {
    logger.info({ keyHash, match: "exact", source: "redis" }, "Cache hit");
    return redisHit;
  }

  // Clean up expired cache entries in background (5% probability)
  if (Math.random() < 0.05) {
    postgresBackend.cleanup?.().catch(() => {});
  }

  const embedding = env.ENABLE_VECTOR_CACHE ? await getEmbeddingWithLock(prompt) : null;

  if (embedding) {
    // 2. Vector similarity search via Postgres
    const vectorHit = await postgresBackend.searchSemantic?.(embedding, 0.15);
    if (vectorHit) {
      logger.info({ keyHash, match: "vector", distance: vectorHit.distance, source: "postgres" }, "Cache hit (vector)");
      const responseData: CacheEntry = {
        verdict: vectorHit.verdict,
        opinions: vectorHit.opinions
      };
      // Background populate Redis for future exact matches
      redisBackend.set(keyHash, responseData, CACHE_TTL_MS).catch(() => {});
      return responseData;
    }
  }

  // 3. Fallback to exact match via Postgres
  const hit = await postgresBackend.get(keyHash);

  if (!hit) {
    return null;
  }

  logger.info({ keyHash, match: "exact", source: "postgres" }, "Cache hit");
  
  // Populate Redis cache
  redisBackend.set(keyHash, hit, CACHE_TTL_MS).catch(() => {});
  
  return hit;
}

export async function setCachedResponse(
  prompt: string, 
  members: any[], 
  master: any | undefined, 
  history: any[],
  verdict: string, 
  opinions: any[]
) {
  const keyHash = generateCacheKey(prompt, members, master, history);
  const embedding = env.ENABLE_VECTOR_CACHE ? await getEmbeddingWithLock(prompt) : null;

  const cacheEntry: CacheEntry = {
    verdict,
    opinions,
    metadata: { prompt: prompt.slice(0, 500) }
  };

  try {
    // Store in Postgres (with embedding if available)
    await postgresBackend.setSemantic?.(keyHash, prompt, cacheEntry, embedding, CACHE_TTL_MS);
    
    // Sync to Redis for fast lookups
    await redisBackend.set(keyHash, cacheEntry, CACHE_TTL_MS);
  } catch (e) {
    logger.warn({ error: (e as Error).message }, "Failed to write to semantic cache");
  }
}
