import { db } from "../lib/drizzle.js";
import { sql } from "drizzle-orm";
import { embed } from "./embeddings.service.js";
import { routeAndCollect } from "../router/index.js";
import logger from "../lib/logger.js";

/**
 * Safely convert a numeric array to a PostgreSQL vector literal.
 * Validates every component is a finite number to prevent SQL injection.
 */
function safeVectorLiteral(vec: number[]): string {
  for (let i = 0; i < vec.length; i++) {
    if (typeof vec[i] !== "number" || !Number.isFinite(vec[i])) {
      throw new Error(`Invalid vector component at index ${i}: must be a finite number`);
    }
  }
  return `[${vec.join(",")}]`;
}

export { safeVectorLiteral };

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
  sourceUrl?: string,
  parentChunkId?: string,
): Promise<string> {
  const embedding = await embed(content);
  const vectorStr = safeVectorLiteral(embedding);

  const result = await db.execute(sql`
    INSERT INTO "Memory" ("id", "userId", "kbId", "content", "chunkIndex", "sourceName", "sourceUrl", "parentChunkId", "embedding", "createdAt")
    VALUES (gen_random_uuid()::text, ${userId}, ${kbId}, ${content}, ${chunkIndex}, ${sourceName || null}, ${sourceUrl || null}, ${parentChunkId || null}, ${vectorStr}::vector, NOW())
    RETURNING "id"
  `);

  return (result.rows[0] as { id: string }).id;
}

// Vector similarity search using cosine distance
export async function searchSimilar(
  userId: number,
  query: string,
  kbId?: string | null,
  limit: number = 5
): Promise<MemoryChunk[]> {
  const queryEmbedding = await embed(query);
  const vectorStr = safeVectorLiteral(queryEmbedding);

  const kbCondition = kbId ? sql`AND "kbId" = ${kbId}` : sql``;

  const results = await db.execute(sql`
    SELECT "id", "content", "sourceName", "sourceUrl",
           1 - ("embedding" <=> ${vectorStr}::vector) AS score
    FROM "Memory"
    WHERE "userId" = ${userId} ${kbCondition}
    ORDER BY score DESC
    LIMIT ${limit}
  `);

  // Refresh lastAccessedAt for accessed memories (fire-and-forget)
  const ids = (results.rows as Array<{ id: string }>).map((r) => r.id);
  if (ids.length > 0) {
    db.execute(sql`
      UPDATE "Memory"
      SET "lastAccessedAt" = NOW(), "accessCount" = COALESCE("accessCount", 0) + 1
      WHERE "id" = ANY(${ids}::text[])
    `).catch(() => {});
  }

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

/**
 * Enrich search results with parent chunk context.
 * When a child chunk matches, fetches the parent chunk and prepends it
 * for broader context comprehension.
 */
export async function enrichWithParentContext(chunks: MemoryChunk[]): Promise<MemoryChunk[]> {
  if (chunks.length === 0) return chunks;

  // Get parentChunkIds for all results
  const ids = chunks.map((c) => c.id);
  const parentInfo = await db.execute(sql`
    SELECT "id", "parentChunkId" FROM "Memory"
    WHERE "id" = ANY(${ids}::text[])
    AND "parentChunkId" IS NOT NULL
  `);

  const parentIdMap = new Map<string, string>();
  for (const row of parentInfo.rows as Array<{ [key: string]: unknown }>) {
    if (row.parentChunkId) {
      parentIdMap.set(row.id as string, row.parentChunkId as string);
    }
  }

  if (parentIdMap.size === 0) return chunks;

  // Fetch parent chunk contents
  const parentIds = [...new Set(parentIdMap.values())];
  const parents = await db.execute(sql`
    SELECT "id", "content" FROM "Memory"
    WHERE "id" = ANY(${parentIds}::text[])
  `);

  const parentContentMap = new Map<string, string>();
  for (const row of parents.rows as Array<{ [key: string]: unknown }>) {
    parentContentMap.set(row.id as string, row.content as string);
  }

  // Enrich chunks: prepend parent context to child chunks
  return chunks.map((chunk) => {
    const parentId = parentIdMap.get(chunk.id);
    if (!parentId) return chunk;

    const parentContent = parentContentMap.get(parentId);
    if (!parentContent) return chunk;

    return {
      ...chunk,
      content: `[PARENT CONTEXT]\n${parentContent}\n[/PARENT CONTEXT]\n\n[MATCHED SECTION]\n${chunk.content}\n[/MATCHED SECTION]`,
    };
  });
}

// ─── HyDE: Hypothetical Document Embeddings ────────────────────────────────────
// Generates a hypothetical answer to the query, then uses that document's
// embedding for retrieval. This bridges the gap between short queries
// and longer documents, improving recall on abstract queries.

async function generateHypotheticalDocument(query: string): Promise<string> {
  try {
    const result = await routeAndCollect({
      model: "auto",
      messages: [
        {
          role: "user",
          content: `Write a short, factual paragraph (3-5 sentences) that directly answers this question. Do not include disclaimers or hedging — just provide a confident, informative answer as if it were from a knowledge base document.\n\nQuestion: ${query}`,
        },
      ],
      temperature: 0,
    });
    return result.text;
  } catch (err) {
    logger.warn({ err, query }, "HyDE generation failed, falling back to raw query");
    return query;
  }
}

/**
 * HyDE-enhanced vector search. Generates a hypothetical document from the query,
 * embeds it, and uses that embedding for retrieval. Falls back to standard search
 * if HyDE generation fails.
 */
export async function hydeSearch(
  userId: number,
  query: string,
  kbId?: string | null,
  limit: number = 5,
): Promise<MemoryChunk[]> {
  const hypotheticalDoc = await generateHypotheticalDocument(query);
  const hydeEmbedding = await embed(hypotheticalDoc);
  const vectorStr = safeVectorLiteral(hydeEmbedding);

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

/**
 * Enhanced hybrid search: combines standard vector, HyDE vector, and keyword
 * results using Reciprocal Rank Fusion for maximum recall.
 * Set useHyde=true for abstract queries where the user's question is
 * semantically distant from the document language.
 */
export async function enhancedHybridSearch(
  userId: number,
  query: string,
  kbId?: string | null,
  limit: number = 5,
  useHyde: boolean = false,
): Promise<MemoryChunk[]> {
  const k = 60;

  const searches: Promise<MemoryChunk[]>[] = [
    searchSimilar(userId, query, kbId, limit * 2),
    keywordSearch(userId, query, kbId, limit * 2),
  ];

  if (useHyde) {
    searches.push(hydeSearch(userId, query, kbId, limit * 2));
  }

  const allResults = await Promise.all(searches);
  const scoreMap = new Map<string, { chunk: MemoryChunk; rrfScore: number }>();

  for (const resultSet of allResults) {
    resultSet.forEach((chunk, rank) => {
      const existing = scoreMap.get(chunk.id);
      const rrfContrib = 1 / (rank + 1 + k);
      if (existing) {
        existing.rrfScore += rrfContrib;
      } else {
        scoreMap.set(chunk.id, { chunk, rrfScore: rrfContrib });
      }
    });
  }

  return Array.from(scoreMap.values())
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .slice(0, limit)
    .map(({ chunk, rrfScore }) => ({ ...chunk, score: rrfScore }));
}
