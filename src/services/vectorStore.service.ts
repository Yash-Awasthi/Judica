import prisma from "../lib/db.js";
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

  const result = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `INSERT INTO "Memory" ("id", "userId", "kbId", "content", "chunkIndex", "sourceName", "sourceUrl", "embedding", "createdAt")
     VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7::vector, NOW())
     RETURNING "id"`,
    userId,
    kbId,
    content,
    chunkIndex,
    sourceName || null,
    sourceUrl || null,
    vectorStr
  );

  return result[0].id;
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

  const kbFilter = kbId ? `AND "kbId" = '${kbId}'` : "";

  const results = await prisma.$queryRawUnsafe<MemoryChunk[]>(
    `SELECT "id", "content", "sourceName" as "sourceName", "sourceUrl" as "sourceUrl",
            1 - ("embedding" <=> $1::vector) AS score
     FROM "Memory"
     WHERE "userId" = $2 ${kbFilter}
     ORDER BY score DESC
     LIMIT $3`,
    vectorStr,
    userId,
    limit
  );

  return results;
}

// BM25 keyword search using PostgreSQL full-text search
export async function keywordSearch(
  userId: number,
  query: string,
  kbId?: string | null,
  limit: number = 10
): Promise<MemoryChunk[]> {
  const kbFilter = kbId ? `AND "kbId" = '${kbId}'` : "";

  const results = await prisma.$queryRawUnsafe<MemoryChunk[]>(
    `SELECT "id", "content", "sourceName" as "sourceName", "sourceUrl" as "sourceUrl",
            ts_rank("tsv", plainto_tsquery('english', $1)) AS score
     FROM "Memory"
     WHERE "userId" = $2 ${kbFilter}
       AND "tsv" @@ plainto_tsquery('english', $1)
     ORDER BY score DESC
     LIMIT $3`,
    query,
    userId,
    limit
  );

  return results;
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
  const result = await prisma.$executeRawUnsafe(
    `DELETE FROM "Memory" WHERE "kbId" = $1`,
    kbId
  );
  return result;
}

// Delete chunks for a specific document
export async function deleteDocChunks(kbId: string, sourceName: string): Promise<number> {
  const result = await prisma.$executeRawUnsafe(
    `DELETE FROM "Memory" WHERE "kbId" = $1 AND "sourceName" = $2`,
    kbId,
    sourceName
  );
  return result;
}
