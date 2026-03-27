import crypto from "crypto";
import prisma, { pool } from "./db.js";
import redis from "./redis.js";
import logger from "./logger.js";
import { env } from "../config/env.js";

/**
 * CACHE ARCHITECTURE NOTE:
 * Primary lookup is an exact SHA-256 key match (prompt + members + history).
 * Vector similarity search is attempted when an OpenAI embedding key is available,
 * but falls back to exact match otherwise. This is NOT full semantic deduplication.
 * To enable true semantic caching, enable the pgvector extension and uncomment
 * the `embedding` column in `prisma/schema.prisma`.
 */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

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
  } catch (err: any) {
    logger.warn({ error: err.message }, "Failed to fetch embeddings");
  }
  return null;
}

export async function getCachedResponse(prompt: string, members: any[], master?: any, history: any[] = []) {
  const keyHash = generateCacheKey(prompt, members, master, history);
  
  // 1. Exact match via Redis (fastest)
  const redisHit = await redis.get(`cache:${keyHash}`);
  if (redisHit) {
    logger.info({ keyHash, match: "exact", source: "redis" }, "Cache hit");
    return JSON.parse(redisHit);
  }

  // Clean up expired cache entries manually in background, probabilistically (5%) to reduce DB contention under load
  if (Math.random() < 0.05) {
    pool.query(`DELETE FROM "SemanticCache" WHERE "expiresAt" < NOW()`).catch(() => {});
  }

  const embedding = env.ENABLE_VECTOR_CACHE ? await getEmbedding(prompt) : null;

  if (embedding) {
    try {
      // 2. Vector similarity search (threshold < 0.15 for high similarity)
      const result = await pool.query(`
        SELECT id, verdict, opinions, embedding <-> $1 as distance
        FROM "SemanticCache"
        WHERE "expiresAt" > NOW() AND embedding IS NOT NULL
        ORDER BY embedding <-> $1
        LIMIT 1
      `, [`[${embedding.join(',')}]`]);

      if (result.rows.length > 0 && result.rows[0].distance < 0.15) {
        logger.info({ keyHash, match: "vector", distance: result.rows[0].distance, source: "postgres" }, "Cache hit (vector)");
        const responseData = {
          verdict: result.rows[0].verdict,
          opinions: typeof result.rows[0].opinions === 'string' ? JSON.parse(result.rows[0].opinions) : result.rows[0].opinions
        };
        // Background populate Redis to accelerate future exact matches
        redis.set(`cache:${keyHash}`, JSON.stringify(responseData), "PX", CACHE_TTL_MS).catch(() => {});
        return responseData;
      }
    } catch(err: any) {
      logger.warn({ err: err.message }, "Vector search failed");
    }
  }

  // Fallback to exact match
  const hit = await prisma.semanticCache.findUnique({ where: { keyHash } });

  if (!hit || hit.expiresAt < new Date()) {
    return null;
  }

  logger.info({ keyHash, match: "exact", source: "postgres" }, "Cache hit");
  const responseData = {
    verdict: hit.verdict,
    opinions: hit.opinions as any[]
  };
  
  const ttl = Math.max(1000, hit.expiresAt.getTime() - Date.now());
  redis.set(`cache:${keyHash}`, JSON.stringify(responseData), "PX", ttl).catch(() => {});
  
  return responseData;
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
  const expiresAt = new Date(Date.now() + CACHE_TTL_MS);
  const embedding = env.ENABLE_VECTOR_CACHE ? await getEmbedding(prompt) : null;

  try {
    if (embedding) {
      await pool.query(`
        INSERT INTO "SemanticCache" ("keyHash", prompt, verdict, opinions, "expiresAt", embedding)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT ("keyHash") DO UPDATE SET 
          verdict = EXCLUDED.verdict, 
          opinions = EXCLUDED.opinions,
          "expiresAt" = EXCLUDED."expiresAt",
          embedding = EXCLUDED.embedding
      `, [
        keyHash, 
        prompt.slice(0, 500), 
        verdict, 
        JSON.stringify(opinions), 
        expiresAt.toISOString(),
        `[${embedding.join(',')}]`
      ]);
    } else {
      await prisma.semanticCache.upsert({
        where: { keyHash },
        update: { verdict, opinions, expiresAt: expiresAt, createdAt: new Date() },
        create: { keyHash, prompt: prompt.slice(0, 500), verdict, opinions, expiresAt: expiresAt }
      });
    }
    
    // Sync cache to Redis
    await redis.set(`cache:${keyHash}`, JSON.stringify({ verdict, opinions }), "PX", CACHE_TTL_MS);
  } catch (e: any) {
    logger.warn({ error: e.message }, "Failed to write to semantic cache");
  }
}
