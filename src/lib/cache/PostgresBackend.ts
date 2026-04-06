import { pool } from "../db.js";
import prisma from "../db.js";
import logger from "../logger.js";
import type { CacheBackend, CacheEntry, SemanticSearchResult } from "./CacheBackend.js";

export class PostgresBackend implements CacheBackend {

  async get(key: string): Promise<CacheEntry | null> {
    const hit = await prisma.semanticCache.findUnique({ where: { keyHash: key } });
    
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
    
    await prisma.semanticCache.upsert({
      where: { keyHash: key },
      update: { 
        verdict: value.verdict, 
        opinions: value.opinions, 
        expiresAt: expiresAt,
        createdAt: new Date()
      },
      create: { 
        keyHash: key, 
        prompt: (value.metadata?.prompt as string)?.slice(0, 500) || "", 
        verdict: value.verdict, 
        opinions: value.opinions, 
        expiresAt: expiresAt 
      }
    });
  }

  async delete(key: string): Promise<void> {
    await prisma.semanticCache.delete({ where: { keyHash: key } }).catch(() => {});
  }

  async searchSemantic(embedding: number[], threshold = 0.15): Promise<SemanticSearchResult | null> {
    try {
      const result = await pool.query(`
        SELECT id, "keyHash", verdict, opinions, embedding <-> $1 as distance
        FROM "SemanticCache"
        WHERE "expiresAt" > NOW() AND embedding IS NOT NULL
        ORDER BY embedding <-> $1
        LIMIT 1
      `, [`[${embedding.join(',')}]`]);

      if (result.rows.length > 0 && result.rows[0].distance < threshold) {
        return {
          keyHash: result.rows[0].keyHash,
          verdict: result.rows[0].verdict,
          opinions: typeof result.rows[0].opinions === 'string' 
            ? JSON.parse(result.rows[0].opinions) 
            : result.rows[0].opinions,
          distance: result.rows[0].distance
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
      await pool.query(`
        INSERT INTO "SemanticCache" ("keyHash", prompt, verdict, opinions, "expiresAt", embedding)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT ("keyHash") DO UPDATE SET 
          verdict = EXCLUDED.verdict, 
          opinions = EXCLUDED.opinions,
          "expiresAt" = EXCLUDED."expiresAt",
          embedding = EXCLUDED.embedding
      `, [
        key, 
        prompt.slice(0, 500), 
        value.verdict, 
        JSON.stringify(value.opinions), 
        expiresAt.toISOString(),
        `[${embedding.join(',')}]`
      ]);
    } else {
      await this.set(key, value, ttlMs);
    }
  }

  async cleanup(): Promise<void> {
    try {
      const result = await pool.query(
        `DELETE FROM "SemanticCache" WHERE "expiresAt" < NOW()`
      );
      logger.debug({ deleted: result.rowCount }, "Cleaned up expired cache entries");
    } catch {
    }
  }
}

export const postgresBackend = new PostgresBackend();
