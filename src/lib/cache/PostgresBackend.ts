import { db } from "../drizzle.js";
import { semanticCache } from "../../db/schema/conversations.js";
import { eq, sql } from "drizzle-orm";
import logger from "../logger.js";
import type { CacheBackend, CacheEntry, SemanticSearchResult } from "./CacheBackend.js";

export class PostgresBackend implements CacheBackend {

  async get(key: string): Promise<CacheEntry | null> {
    const [hit] = await db
      .select()
      .from(semanticCache)
      .where(eq(semanticCache.keyHash, key))
      .limit(1);

    if (!hit || hit.expiresAt < new Date()) {
      return null;
    }

    return {
      verdict: hit.verdict,
      opinions: hit.opinions as any[],
      metadata: {
        prompt: hit.prompt,
        createdAt: hit.createdAt
      }
    };
  }

  async set(key: string, value: CacheEntry, ttlMs?: number): Promise<void> {
    const expiresAt = new Date(Date.now() + (ttlMs || 24 * 60 * 60 * 1000));

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
          createdAt: new Date(),
        },
      });
  }

  async delete(key: string): Promise<void> {
    await db
      .delete(semanticCache)
      .where(eq(semanticCache.keyHash, key))
      .catch(() => {});
  }

  async searchSemantic(embedding: number[], threshold = 0.15): Promise<SemanticSearchResult | null> {
    try {
      const embeddingStr = `[${embedding.join(',')}]`;
      const result = await db.execute(sql`
        SELECT id, "keyHash", verdict, opinions, embedding <-> ${embeddingStr}::vector as distance
        FROM "SemanticCache"
        WHERE "expiresAt" > NOW() AND embedding IS NOT NULL
        ORDER BY embedding <-> ${embeddingStr}::vector
        LIMIT 1
      `);

      const rows = result.rows as any[];
      if (rows.length > 0 && rows[0].distance < threshold) {
        return {
          keyHash: rows[0].keyHash,
          verdict: rows[0].verdict,
          opinions: typeof rows[0].opinions === 'string'
            ? JSON.parse(rows[0].opinions)
            : rows[0].opinions,
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
    ttlMs?: number
  ): Promise<void> {
    const expiresAt = new Date(Date.now() + (ttlMs || 24 * 60 * 60 * 1000));

    if (embedding) {
      const embeddingStr = `[${embedding.join(',')}]`;
      await db.execute(sql`
        INSERT INTO "SemanticCache" ("keyHash", prompt, verdict, opinions, "expiresAt", embedding)
        VALUES (${key}, ${prompt.slice(0, 500)}, ${value.verdict}, ${JSON.stringify(value.opinions)}::jsonb, ${expiresAt.toISOString()}::timestamp, ${embeddingStr}::vector)
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
      logger.debug({ deleted: (result as any).rowCount }, "Cleaned up expired cache entries");
    } catch {
      // no-op
    }
  }
}

export const postgresBackend = new PostgresBackend();
