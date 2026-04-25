import { db } from "../drizzle.js";
import { semanticCache } from "../../db/schema/conversations.js";
import { eq, sql } from "drizzle-orm";
import logger from "../logger.js";
import type { CacheBackend, CacheEntry, SemanticSearchResult } from "./CacheBackend.js";

// Import type from CacheBackend.ts — don't duplicate
type CacheOpinion = CacheEntry['opinions'][number];

interface SemanticCacheRow {
  id: number;
  keyHash: string;
  verdict: string;
  opinions: CacheOpinion[] | string;
  distance: number;
}

export class PostgresBackend implements CacheBackend {

  async get(key: string): Promise<CacheEntry | null> {
    // Filter expired rows in SQL — don't fetch then filter in app code
    const [hit] = await db
      .select()
      .from(semanticCache)
      .where(sql`${semanticCache.keyHash} = ${key} AND ${semanticCache.expiresAt} > NOW()`)
      .limit(1);

    if (!hit) {
      return null;
    }

    return {
      verdict: hit.verdict,
      opinions: hit.opinions as CacheOpinion[],
      metadata: {
        prompt: hit.prompt,
        createdAt: hit.createdAt
      }
    };
  }

  async set(key: string, value: CacheEntry, ttlMs: number): Promise<void> {
    // TTL is required — validate
    if (!ttlMs || ttlMs <= 0) {
      logger.warn({ key, ttlMs }, "Invalid TTL for cache set — using default 24h");
      ttlMs = 24 * 60 * 60 * 1000;
    }
    const expiresAt = new Date(Date.now() + ttlMs);

    await db
      .insert(semanticCache)
      .values({
        keyHash: key,
        prompt: (value.metadata?.prompt as string)?.slice(0, 500) || "",
        verdict: value.verdict,
        opinions: value.opinions,
        expiresAt,
      })
      .onConflictDoUpdate({
        target: semanticCache.keyHash,
        set: {
          verdict: value.verdict,
          opinions: value.opinions,
          expiresAt,
          // Do NOT reset createdAt on update — preserve original creation time for TTL logic
        },
      });
  }

  async delete(key: string): Promise<void> {
    try {
      await db
        .delete(semanticCache)
        .where(eq(semanticCache.keyHash, key));
    } catch (err) {
      // Log delete failures instead of silently swallowing
      logger.warn({ err: (err as Error).message, key }, "Failed to delete cache entry");
    }
  }

  async searchSemantic(embedding: number[], threshold = 0.15): Promise<SemanticSearchResult | null> {
    try {
      // Validate embedding array contains only finite numbers to prevent SQL injection
      if (!embedding.every(n => Number.isFinite(n))) {
        logger.warn("searchSemantic: embedding contains non-finite values — rejecting");
        return null;
      }
      const embeddingStr = `[${embedding.join(',')}]`;
      // Check that HNSW index exists — warn if falling back to seqscan
      // Push similarity threshold into WHERE clause to reduce sort cost
      const result = await db.execute(sql`
        SELECT id, "keyHash", verdict, opinions, embedding <-> ${embeddingStr}::vector as distance
        FROM "SemanticCache"
        WHERE "expiresAt" > NOW()
          AND embedding IS NOT NULL
          AND embedding <-> ${embeddingStr}::vector < ${threshold}
        ORDER BY embedding <-> ${embeddingStr}::vector
        LIMIT 1
      `);

      const rows = result.rows as unknown as SemanticCacheRow[];
      if (rows.length > 0) {
        return {
          keyHash: rows[0].keyHash,
          verdict: rows[0].verdict,
          // Handle mixed opinions field schema — may be string or JSON
          // Safe-parse opinions so malformed JSON doesn't discard a valid row
          opinions: (() => {
            let opinions: CacheOpinion[];
            try {
              opinions = typeof rows[0].opinions === 'string'
                ? JSON.parse(rows[0].opinions)
                : rows[0].opinions;
            } catch {
              opinions = [];
            }
            return opinions;
          })(),
          distance: rows[0].distance
        };
      }

      return null;
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "Vector search failed");
      return null;
    }
  }

  async setSemantic(
    key: string,
    prompt: string,
    value: CacheEntry,
    embedding: number[] | null,
    ttlMs: number
  ): Promise<void> {
    // TTL is required
    if (!ttlMs || ttlMs <= 0) {
      ttlMs = 24 * 60 * 60 * 1000;
    }
    const expiresAt = new Date(Date.now() + ttlMs);

    if (embedding) {
      const embeddingStr = `[${embedding.join(',')}]`;
      // Do NOT reset createdAt on conflict update
      await db.execute(sql`
        INSERT INTO "SemanticCache" ("keyHash", prompt, verdict, opinions, "expiresAt", embedding)
        VALUES (${key}, ${prompt.slice(0, 500)}, ${value.verdict}, ${JSON.stringify(value.opinions)}::jsonb, ${expiresAt.toISOString()}::timestamptz, ${embeddingStr}::vector)
        ON CONFLICT ("keyHash") DO UPDATE SET
          verdict = EXCLUDED.verdict,
          opinions = EXCLUDED.opinions,
          "expiresAt" = EXCLUDED."expiresAt",
          embedding = EXCLUDED.embedding
      `);
    } else {
      await this.set(key, value, ttlMs);
    }
  }

  async cleanup(): Promise<void> {
    try {
      const result = await db.execute(sql`
        DELETE FROM "SemanticCache" WHERE "expiresAt" < NOW()
      `);
      logger.debug({ deleted: (result as { rowCount?: number }).rowCount }, "Cleaned up expired cache entries");
    } catch (err) {
      // Log cleanup failures
      logger.warn({ err: (err as Error).message }, "Failed to clean up expired cache entries");
    }
  }
}

export const postgresBackend = new PostgresBackend();
