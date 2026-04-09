import { db } from "../lib/drizzle.js";
import { sql } from "drizzle-orm";
import { embed } from "./embeddings.service.js";
import logger from "../lib/logger.js";

export interface MemoryChunk {
  id: string;
  content: string;
  sourceName: string | null;
  sourceUrl: string | null;
  score: number;
}

// Store a chunk with its embedding
export async function storeChunk(
  userId: number,
  kbId: string | null,
  content: string,
  chunkIndex: number,
  sourceName?: string,
  sourceUrl?: string
): Promise<string> {
  const embedding = await embed(content);
  const vectorStr = `[${embedding.join(",")}]`;

  const result = await db.execute(sql`
    INSERT INTO "Memory" ("id", "userId", "kbId", "content", "chunkIndex", "sourceName", "sourceUrl", "embedding", "createdAt")
    VALUES (gen_random_uuid()::text, ${userId}, ${kbId}, ${content}, ${chunkIndex}, ${sourceName || null}, ${sourceUrl || null}, ${vectorStr}::vector, NOW())
    RETURNING "id"
  `);

  return (result.rows[0] as any).id;
}

// Vector similarity search using cosine distance
export async function searchSimilar(
  userId: number,
  query: string,
  kbId?: string | null,
  limit: number = 5
): Promise<MemoryChunk[]> {
  const queryEmbedding = await embed(query);
  const vectorStr = `[${queryEmbedding.join(",")}]`;

  const kbCondition = kbId ? sql`AND "kbId" = ${kbId}` : sql``;

  const results = await db.execute(sql`
    SELECT "id", "content", "sourceName", "sourceUrl",
           1 - ("embedding" <=> ${vectorStr}::vector) AS score
    FROM "Memory"
    WHERE "userId" = ${userId} ${kbCondition}
    ORDER BY score DESC
    LIMIT ${limit}
  `);

  return results.rows as unknown as MemoryChunk[];
}

// BM25 keyword search using PostgreSQL full-text search
export async function keywordSearch(
  userId: number,
  query: string,
  kbId?: string | null,
  limit: number = 10
): Promise<MemoryChunk[]> {
  const kbCondition = kbId ? sql`AND "kbId" = ${kbId}` : sql``;

  const results = await db.execute(sql`
    SELECT "id", "content", "sourceName", "sourceUrl",
           ts_rank("tsv", plainto_tsquery('english', ${query})) AS score
    FROM "Memory"
    WHERE "userId" = ${userId} ${kbCondition}
      AND "tsv" @@ plainto_tsquery('english', ${query})
    ORDER BY score DESC
    LIMIT ${limit}
  `);

  return results.rows as unknown as MemoryChunk[];
}

// Hybrid search: vector + keyword with Reciprocal Rank Fusion
export async function hybridSearch(
  userId: number,
  query: string,
  kbId?: string | null,
  limit: number = 5
): Promise<MemoryChunk[]> {
  const k = 60; // RRF constant

  const [vectorResults, kwResults] = await Promise.all([
    searchSimilar(userId, query, kbId, limit * 2),
    keywordSearch(userId, query, kbId, limit * 2),
  ]);

  // Build RRF scores
  const scoreMap = new Map<string, { chunk: MemoryChunk; rrfScore: number }>();

  vectorResults.forEach((chunk, rank) => {
    const existing = scoreMap.get(chunk.id);
    const rrfContrib = 1 / (rank + 1 + k);
    if (existing) {
      existing.rrfScore += rrfContrib;
    } else {
      scoreMap.set(chunk.id, { chunk, rrfScore: rrfContrib });
    }
  });

  kwResults.forEach((chunk, rank) => {
    const existing = scoreMap.get(chunk.id);
    const rrfContrib = 1 / (rank + 1 + k);
    if (existing) {
      existing.rrfScore += rrfContrib;
    } else {
      scoreMap.set(chunk.id, { chunk, rrfScore: rrfContrib });
    }
  });

  // Sort by RRF score and return top N
  const merged = Array.from(scoreMap.values())
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .slice(0, limit)
    .map(({ chunk, rrfScore }) => ({ ...chunk, score: rrfScore }));

  return merged;
}

// Delete all chunks for a knowledge base
export async function deleteKBChunks(kbId: string): Promise<number> {
  const result = await db.execute(sql`
    DELETE FROM "Memory" WHERE "kbId" = ${kbId}
  `);
  return result.rowCount ?? 0;
}

// Delete chunks for a specific document
export async function deleteDocChunks(kbId: string, sourceName: string): Promise<number> {
  const result = await db.execute(sql`
    DELETE FROM "Memory" WHERE "kbId" = ${kbId} AND "sourceName" = ${sourceName}
  `);
  return result.rowCount ?? 0;
}
