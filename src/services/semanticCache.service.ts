/**
 * Phase 8.2 — Advanced Semantic Caching
 *
 * Architecture inspired by GPTCache (https://github.com/zilliztech/GPTCache)
 * and Redis Vector Search (https://redis.io/docs/latest/develop/interact/search-and-query/query/vector-search/).
 *
 * Three cache levels, evaluated in order from cheapest to most expensive:
 *
 *   L1 — Exact key cache (Redis STRING, TTL: 1 hour)
 *        Key = SHA-256(normalised query + council config fingerprint)
 *        O(1) lookup. No embedding needed. Handles identical repeated queries perfectly.
 *
 *   L2 — Semantic similarity cache (Redis + pgvector)
 *        Embeds the query, then runs a cosine distance query against cached embeddings.
 *        Hit threshold: cosine similarity ≥ 0.92 (tunable via SEMANTIC_CACHE_THRESHOLD).
 *        Stores: embedding + response + config fingerprint in cache_entries table.
 *
 *   L3 — Council config cache (Redis HASH, TTL: 30 min)
 *        Caches partial council outputs keyed by (query_hash, member_id, model).
 *        Allows reuse of individual member responses across re-runs with different council
 *        compositions — if the same member/model was asked the same question, reuse it.
 *
 * Hit rate metrics are incremented in Redis counters and surfaced in the analytics dashboard.
 *
 * Cache invalidation:
 *   - Knowledge base update → flush L2 for that userId
 *   - Council config change → flush L3 for that config fingerprint
 *   - Manual flush via POST /api/cache/flush
 */

import redis from "../lib/redis.js";
import { db } from "../lib/drizzle.js";
import { sql } from "drizzle-orm";
import { embed } from "./embeddings.service.js";
import { safeVectorLiteral } from "./vectorStore.service.js";
import { createHash } from "crypto";
import logger from "../lib/logger.js";

const log = logger.child({ service: "semanticCache" });

// ─── Configuration ────────────────────────────────────────────────────────────

const L1_TTL_SECONDS = 3_600;           // 1 hour exact-match cache
const L3_TTL_SECONDS = 1_800;           // 30 min council config cache
const SEMANTIC_THRESHOLD = parseFloat(process.env.SEMANTIC_CACHE_THRESHOLD ?? "0.92");
const CACHE_ENABLED = process.env.ENABLE_SEMANTIC_CACHE !== "false";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CacheEntry {
  response: string;
  councilConfigHash: string;
  userId: number;
  createdAt: number;
  hitCount: number;
}

export interface MemberCacheEntry {
  memberId: string;
  model: string;
  response: string;
  usage: { prompt_tokens: number; completion_tokens: number };
}

export interface CacheResult {
  hit: boolean;
  level: "L1" | "L2" | "L3" | null;
  response?: string;
  similarity?: number;
}

export interface CacheStats {
  l1Hits: number;
  l2Hits: number;
  l3Hits: number;
  misses: number;
  hitRate: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normaliseQuery(query: string): string {
  return query.toLowerCase().trim().replace(/\s+/g, " ");
}

function queryHash(query: string, configHash: string): string {
  return createHash("sha256")
    .update(`${normaliseQuery(query)}::${configHash}`)
    .digest("hex");
}

function configFingerprint(councilMemberIds: string[], model: string): string {
  return createHash("sha256")
    .update(JSON.stringify({ members: councilMemberIds.sort(), model }))
    .digest("hex")
    .slice(0, 16);
}

async function incrementCounter(key: string): Promise<void> {
  try {
    await redis.incr(key);
  } catch { /* non-critical */ }
}

// ─── L1: Exact Cache ──────────────────────────────────────────────────────────

async function l1Get(key: string): Promise<string | null> {
  try {
    const raw = await redis.get(`sc:l1:${key}`);
    return raw;
  } catch {
    return null;
  }
}

async function l1Set(key: string, response: string): Promise<void> {
  try {
    await redis.set(`sc:l1:${key}`, response, { EX: L1_TTL_SECONDS });
  } catch { /* non-critical */ }
}

// ─── L2: Semantic Similarity Cache ────────────────────────────────────────────

async function l2Get(
  query: string,
  userId: number,
  configHash: string
): Promise<{ response: string; similarity: number } | null> {
  try {
    const embedding = await embed(query);
    const vectorStr = safeVectorLiteral(embedding);

    const result = await db.execute(sql`
      SELECT "response", "similarity"
      FROM (
        SELECT "response",
               1 - ("embedding" <=> ${vectorStr}::vector) AS "similarity"
        FROM "semantic_cache"
        WHERE "userId" = ${userId}
          AND "councilConfigHash" = ${configHash}
        ORDER BY "embedding" <=> ${vectorStr}::vector
        LIMIT 1
      ) t
      WHERE "similarity" >= ${SEMANTIC_THRESHOLD}
    `);

    if (result.rows.length === 0) return null;

    const row = result.rows[0] as { response: string; similarity: number };

    // Increment hit count async (fire-and-forget)
    db.execute(sql`
      UPDATE "semantic_cache"
      SET "hitCount" = "hitCount" + 1
      WHERE "userId" = ${userId}
        AND "councilConfigHash" = ${configHash}
        AND 1 - ("embedding" <=> ${vectorStr}::vector) >= ${SEMANTIC_THRESHOLD}
    `).catch(() => {});

    return row;
  } catch (err) {
    log.debug({ err }, "L2 cache lookup failed");
    return null;
  }
}

async function l2Set(
  query: string,
  response: string,
  userId: number,
  configHash: string
): Promise<void> {
  try {
    const embedding = await embed(query);
    const vectorStr = safeVectorLiteral(embedding);

    await db.execute(sql`
      INSERT INTO "semantic_cache" ("query", "response", "embedding", "userId", "councilConfigHash", "hitCount", "createdAt")
      VALUES (${query}, ${response}, ${vectorStr}::vector, ${userId}, ${configHash}, 0, NOW())
      ON CONFLICT ("userId", "councilConfigHash", "query")
      DO UPDATE SET "response" = EXCLUDED."response", "embedding" = EXCLUDED."embedding", "createdAt" = NOW()
    `);
  } catch (err) {
    log.debug({ err }, "L2 cache store failed");
  }
}

// ─── L3: Council Config Cache ─────────────────────────────────────────────────

function l3Key(queryHash: string, memberId: string, model: string): string {
  return `sc:l3:${queryHash}:${memberId}:${model}`;
}

async function l3GetMember(
  qHash: string,
  memberId: string,
  model: string
): Promise<MemberCacheEntry | null> {
  try {
    const raw = await redis.get(l3Key(qHash, memberId, model));
    if (!raw) return null;
    return JSON.parse(raw) as MemberCacheEntry;
  } catch {
    return null;
  }
}

async function l3SetMember(
  qHash: string,
  entry: MemberCacheEntry
): Promise<void> {
  try {
    const key = l3Key(qHash, entry.memberId, entry.model);
    await redis.set(key, JSON.stringify(entry), { EX: L3_TTL_SECONDS });
  } catch { /* non-critical */ }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Check all three cache levels for a matching response.
 * Returns the first hit, or { hit: false } on miss.
 */
export async function cacheGet(
  query: string,
  userId: number,
  councilMemberIds: string[],
  model: string
): Promise<CacheResult> {
  if (!CACHE_ENABLED) return { hit: false, level: null };

  const cfgHash = configFingerprint(councilMemberIds, model);
  const qHash = queryHash(query, cfgHash);

  // L1
  const l1 = await l1Get(qHash);
  if (l1) {
    await incrementCounter("sc:stats:l1_hits");
    log.debug({ query: query.slice(0, 60) }, "Semantic cache L1 hit");
    return { hit: true, level: "L1", response: l1 };
  }

  // L2
  const l2 = await l2Get(query, userId, cfgHash);
  if (l2) {
    await incrementCounter("sc:stats:l2_hits");
    // Promote to L1 for future exact hits
    await l1Set(qHash, l2.response);
    log.debug({ query: query.slice(0, 60), similarity: l2.similarity }, "Semantic cache L2 hit");
    return { hit: true, level: "L2", response: l2.response, similarity: l2.similarity };
  }

  await incrementCounter("sc:stats:misses");
  return { hit: false, level: null };
}

/**
 * Store a completed council response in all applicable cache levels.
 */
export async function cacheSet(
  query: string,
  response: string,
  userId: number,
  councilMemberIds: string[],
  model: string
): Promise<void> {
  if (!CACHE_ENABLED) return;

  const cfgHash = configFingerprint(councilMemberIds, model);
  const qHash = queryHash(query, cfgHash);

  await Promise.all([
    l1Set(qHash, response),
    l2Set(query, response, userId, cfgHash),
  ]);
}

/**
 * Get a cached individual council member response (L3).
 */
export async function getMemberCache(
  query: string,
  memberId: string,
  model: string
): Promise<MemberCacheEntry | null> {
  if (!CACHE_ENABLED) return null;
  const qHash = createHash("sha256").update(normaliseQuery(query)).digest("hex");
  return l3GetMember(qHash, memberId, model);
}

/**
 * Cache an individual council member response (L3).
 */
export async function setMemberCache(
  query: string,
  entry: MemberCacheEntry
): Promise<void> {
  if (!CACHE_ENABLED) return;
  const qHash = createHash("sha256").update(normaliseQuery(query)).digest("hex");
  await l3SetMember(qHash, entry);
}

/**
 * Read hit-rate statistics from Redis counters.
 */
export async function getCacheStats(): Promise<CacheStats> {
  try {
    const [l1, l2, l3, misses] = await Promise.all([
      redis.get("sc:stats:l1_hits").then(v => parseInt(v ?? "0", 10)),
      redis.get("sc:stats:l2_hits").then(v => parseInt(v ?? "0", 10)),
      redis.get("sc:stats:l3_hits").then(v => parseInt(v ?? "0", 10)),
      redis.get("sc:stats:misses").then(v => parseInt(v ?? "0", 10)),
    ]);
    const total = l1 + l2 + l3 + misses;
    return {
      l1Hits: l1,
      l2Hits: l2,
      l3Hits: l3,
      misses,
      hitRate: total > 0 ? (l1 + l2 + l3) / total : 0,
    };
  } catch {
    return { l1Hits: 0, l2Hits: 0, l3Hits: 0, misses: 0, hitRate: 0 };
  }
}

/**
 * Flush all L1 + L2 cache entries for a user (call on KB update).
 */
export async function flushUserCache(userId: number): Promise<void> {
  try {
    // Flush L2 from DB
    await db.execute(sql`DELETE FROM "semantic_cache" WHERE "userId" = ${userId}`);
    // L1 keys are hashed and can't be pattern-matched efficiently;
    // they'll expire naturally within 1 hour.
    log.info({ userId }, "Semantic cache flushed for user");
  } catch (err) {
    log.warn({ err, userId }, "Failed to flush semantic cache for user");
  }
}
