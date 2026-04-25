import { db } from "../lib/drizzle.js";
import { sql } from "drizzle-orm";
import { embed } from "./embeddings.service.js";
import { routeAndCollect } from "../router/index.js";
import logger from "../lib/logger.js";
import { rerank, isRerankAvailable } from "./reranker.service.js";
import type { ExtractedEntity } from "./ner.service.js";

/**
 * Safely convert a numeric array to a PostgreSQL vector literal.
 * Validates every component is a finite number to prevent SQL injection.
 */
function safeVectorLiteral(vec: number[]): string {
  // Cap vector dimensions to prevent unbounded array processing
  if (vec.length > 4096) {
    throw new Error(`Vector dimension ${vec.length} exceeds maximum 4096`);
  }
  for (let i = 0; i < vec.length; i++) {
    if (typeof vec[i] !== "number" || !Number.isFinite(vec[i])) {
      throw new Error(`Invalid vector component at index ${i}: must be a finite number`);
    }
  }
  return `[${vec.join(",")}]`;
}

export { safeVectorLiteral };

const MAX_SEARCH_LIMIT = 100;
function clampLimit(limit: number): number {
  return Math.max(1, Math.min(limit, MAX_SEARCH_LIMIT));
}

export interface MemoryChunk {
  id: string;
  content: string;
  sourceName: string | null;
  sourceUrl: string | null;
  score: number;
}

export interface DateRange {
  from?: string;
  to?: string;
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
  accessControlList?: string[],
  entities?: ExtractedEntity[],
): Promise<string> {
  const embedding = await embed(content);
  const vectorStr = safeVectorLiteral(embedding);
  const aclJson = accessControlList && accessControlList.length > 0
    ? JSON.stringify(accessControlList)
    : "[]";
  const entitiesJson = entities && entities.length > 0
    ? JSON.stringify(entities)
    : "[]";

  const result = await db.execute(sql`
    INSERT INTO "Memory" ("id", "userId", "kbId", "content", "chunkIndex", "sourceName", "sourceUrl", "parentChunkId", "embedding", "accessControlList", "entities", "createdAt")
    VALUES (gen_random_uuid()::text, ${userId}, ${kbId}, ${content}, ${chunkIndex}, ${sourceName || null}, ${sourceUrl || null}, ${parentChunkId || null}, ${vectorStr}::vector, ${aclJson}::jsonb, ${entitiesJson}::jsonb, NOW())
    RETURNING "id"
  `);

  return (result.rows[0] as { id: string }).id;
}

// Vector similarity search using cosine distance
export async function searchSimilar(
  userId: number,
  query: string,
  kbId?: string | null,
  limit: number = 5,
  aclTokens?: string[],
  dateRange?: DateRange,
): Promise<MemoryChunk[]> {
  limit = clampLimit(limit);
  const queryEmbedding = await embed(query);
  const vectorStr = safeVectorLiteral(queryEmbedding);

  const kbCondition = kbId ? sql`AND "kbId" = ${kbId}` : sql``;
  // ACL enforcement at query level: only return docs whose ACL overlaps with user tokens.
  // If aclTokens is provided, filter by it; otherwise fall back to userId-only (backward compat).
  const aclCondition = aclTokens && aclTokens.length > 0
    ? sql`AND ("accessControlList" IS NULL OR "accessControlList" = '[]'::jsonb OR "accessControlList" ?| ${aclTokens}::text[])`
    : sql``;
  const hiddenFilter = sql`AND ("hidden" IS NULL OR "hidden" = false)`;
  const dateFromCondition = dateRange?.from ? sql`AND "createdAt" >= ${dateRange.from}::timestamptz` : sql``;
  const dateToCondition = dateRange?.to ? sql`AND "createdAt" <= ${dateRange.to}::timestamptz` : sql``;

  // Entity-based boost: documents whose stored entities mention any word from the
  // query receive a small score bonus (0.05 per matching entity text).
  // We cast entities to text and do a case-insensitive ILIKE check.
  const queryWords = query.split(/\s+/).filter((w) => w.length > 2);
  const entityBoostExpr = queryWords.length > 0
    ? sql`+ COALESCE((
        SELECT 0.05 * COUNT(*)
        FROM jsonb_array_elements("entities") AS e
        WHERE ${queryWords.map((w) => sql`e->>'text' ILIKE ${'%' + w + '%'}`).reduce((acc, cur) => sql`${acc} OR ${cur}`)}
      ), 0)`
    : sql``;

  const results = await db.execute(sql`
    SELECT "id", "content", "sourceName", "sourceUrl",
           (1 - ("embedding" <=> ${vectorStr}::vector)) ${entityBoostExpr} AS score
    FROM "Memory"
    WHERE "userId" = ${userId} ${kbCondition} ${aclCondition} ${hiddenFilter} ${dateFromCondition} ${dateToCondition}
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
  limit: number = 10,
  aclTokens?: string[],
  dateRange?: DateRange,
): Promise<MemoryChunk[]> {
  limit = clampLimit(limit);
  const kbCondition = kbId ? sql`AND "kbId" = ${kbId}` : sql``;
  const aclCondition = aclTokens && aclTokens.length > 0
    ? sql`AND ("accessControlList" IS NULL OR "accessControlList" = '[]'::jsonb OR "accessControlList" ?| ${aclTokens}::text[])`
    : sql``;
  const hiddenFilter = sql`AND ("hidden" IS NULL OR "hidden" = false)`;
  const dateFromCondition = dateRange?.from ? sql`AND "createdAt" >= ${dateRange.from}::timestamptz` : sql``;
  const dateToCondition = dateRange?.to ? sql`AND "createdAt" <= ${dateRange.to}::timestamptz` : sql``;

  const results = await db.execute(sql`
    SELECT "id", "content", "sourceName", "sourceUrl",
           ts_rank("tsv", plainto_tsquery('english', ${query})) AS score
    FROM "Memory"
    WHERE "userId" = ${userId} ${kbCondition} ${aclCondition} ${hiddenFilter} ${dateFromCondition} ${dateToCondition}
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
  limit: number = 5,
  aclTokens?: string[],
  dateRange?: DateRange,
): Promise<MemoryChunk[]> {
  limit = clampLimit(limit);
  const k = 60; // RRF constant

  const [vectorResults, kwResults] = await Promise.all([
    searchSimilar(userId, query, kbId, limit * 2, aclTokens, dateRange),
    keywordSearch(userId, query, kbId, limit * 2, aclTokens, dateRange),
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

  // Take top-20 for reranking, then slice to final limit
  const top20 = Array.from(scoreMap.values())
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .slice(0, 20);

  // Pass top-20 to reranker if available; merge: finalScore = 0.6 * rrfScore + 0.4 * rerankerScore
  if (isRerankAvailable() && top20.length > 0) {
    try {
      const rerankItems = top20.map(({ chunk, rrfScore }) => ({ ...chunk, rrfScore }));
      const reranked = await rerank(query, rerankItems, top20.length);

      // Normalize rrfScore to [0,1] range for blending
      const maxRrf = top20[0].rrfScore || 1;
      const blended = reranked.map((r) => {
        const rrfNorm = (r.item as unknown as { rrfScore: number }).rrfScore / maxRrf;
        const finalScore = 0.6 * rrfNorm + 0.4 * r.relevanceScore;
        return { ...r.item, score: finalScore };
      });

      return blended
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
    } catch (err) {
      logger.warn({ err }, "hybridSearch: reranker failed, falling back to RRF-only results");
    }
  }

  // Fallback: return RRF-only results
  return top20
    .slice(0, limit)
    .map(({ chunk, rrfScore }) => ({ ...chunk, score: rrfScore }));
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

// ─── ACL Management ─────────────────────────────────────────────────────────

/** Update ACL on all chunks matching a source document. */
export async function updateDocumentAcl(
  kbId: string,
  sourceName: string,
  accessControlList: string[],
): Promise<number> {
  const aclJson = JSON.stringify(accessControlList);
  const result = await db.execute(sql`
    UPDATE "Memory"
    SET "accessControlList" = ${aclJson}::jsonb
    WHERE "kbId" = ${kbId} AND "sourceName" = ${sourceName}
  `);
  return result.rowCount ?? 0;
}

/** Update ACL on a specific chunk by ID. */
export async function updateChunkAcl(
  chunkId: string,
  accessControlList: string[],
): Promise<void> {
  const aclJson = JSON.stringify(accessControlList);
  await db.execute(sql`
    UPDATE "Memory"
    SET "accessControlList" = ${aclJson}::jsonb
    WHERE "id" = ${chunkId}
  `);
}

/** Set hidden status for a document's chunks. */
export async function setDocumentHidden(
  kbId: string,
  sourceName: string,
  hidden: boolean,
): Promise<number> {
  const result = await db.execute(sql`
    UPDATE "Memory"
    SET "hidden" = ${hidden}
    WHERE "kbId" = ${kbId} AND "sourceName" = ${sourceName}
  `);
  return result.rowCount ?? 0;
}

/** Update boost factor for a document's chunks. */
export async function updateDocumentBoost(
  kbId: string,
  sourceName: string,
  boostFactor: number,
): Promise<number> {
  const result = await db.execute(sql`
    UPDATE "Memory"
    SET "boostFactor" = ${boostFactor}
    WHERE "kbId" = ${kbId} AND "sourceName" = ${sourceName}
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

/** Sanitize user input before interpolation into LLM prompts */
function sanitizeQuery(text: string): string {
  return text
    .substring(0, 2000)
    .replace(/\b(system|assistant|user|human)\s*:/gi, (_match, role) => `${role as string} -`)
    .replace(/ignore\s+(all\s+)?previous\s+instructions/gi, "[filtered]")
    .replace(/you\s+are\s+now\b/gi, "[filtered]");
}

async function generateHypotheticalDocument(query: string): Promise<string> {
  try {
    const result = await routeAndCollect({
      model: "auto",
      messages: [
        {
          role: "user",
          content: `Write a short, factual paragraph (3-5 sentences) that directly answers this question. Do not include disclaimers or hedging — just provide a confident, informative answer as if it were from a knowledge base document.\n\nQuestion: ${sanitizeQuery(query)}`,
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
  aclTokens?: string[],
): Promise<MemoryChunk[]> {
  limit = clampLimit(limit);
  const hypotheticalDoc = await generateHypotheticalDocument(query);
  const hydeEmbedding = await embed(hypotheticalDoc);
  const vectorStr = safeVectorLiteral(hydeEmbedding);

  const kbCondition = kbId ? sql`AND "kbId" = ${kbId}` : sql``;
  const aclCondition = aclTokens && aclTokens.length > 0
    ? sql`AND ("accessControlList" IS NULL OR "accessControlList" = '[]'::jsonb OR "accessControlList" ?| ${aclTokens}::text[])`
    : sql``;
  const hiddenFilter = sql`AND ("hidden" IS NULL OR "hidden" = false)`;

  const results = await db.execute(sql`
    SELECT "id", "content", "sourceName", "sourceUrl",
           1 - ("embedding" <=> ${vectorStr}::vector) AS score
    FROM "Memory"
    WHERE "userId" = ${userId} ${kbCondition} ${aclCondition} ${hiddenFilter}
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
  aclTokens?: string[],
  dateRange?: DateRange,
): Promise<MemoryChunk[]> {
  limit = clampLimit(limit);
  const k = 60;

  const searches: Promise<MemoryChunk[]>[] = [
    searchSimilar(userId, query, kbId, limit * 2, aclTokens, dateRange),
    keywordSearch(userId, query, kbId, limit * 2, aclTokens, dateRange),
  ];

  if (useHyde) {
    searches.push(hydeSearch(userId, query, kbId, limit * 2, aclTokens));
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

  // Take top-20 for reranking
  const top20Enhanced = Array.from(scoreMap.values())
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .slice(0, 20);

  // Pass top-20 to reranker if available; merge: finalScore = 0.6 * rrfScore + 0.4 * rerankerScore
  if (isRerankAvailable() && top20Enhanced.length > 0) {
    try {
      const rerankItems = top20Enhanced.map(({ chunk, rrfScore }) => ({ ...chunk, rrfScore }));
      const reranked = await rerank(query, rerankItems, top20Enhanced.length);

      const maxRrf = top20Enhanced[0].rrfScore || 1;
      const blended = reranked.map((r) => {
        const rrfNorm = (r.item as unknown as { rrfScore: number }).rrfScore / maxRrf;
        const finalScore = 0.6 * rrfNorm + 0.4 * r.relevanceScore;
        return { ...r.item, score: finalScore };
      });

      return blended
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
    } catch (err) {
      logger.warn({ err }, "enhancedHybridSearch: reranker failed, falling back to RRF-only results");
    }
  }

  return top20Enhanced
    .slice(0, limit)
    .map(({ chunk, rrfScore }) => ({ ...chunk, score: rrfScore }));
}

