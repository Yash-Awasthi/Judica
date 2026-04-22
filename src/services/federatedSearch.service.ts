import { db } from "../lib/drizzle.js";
import { sql } from "drizzle-orm";
import { embed } from "./embeddings.service.js";
import { safeVectorLiteral } from "./vectorStore.service.js";
import { hybridSearch } from "./vectorStore.service.js";
import { pool } from "../lib/db.js";
import logger from "../lib/logger.js";

/**
 * Federated search result: a unified item from any index.
 */
export interface FederatedResult {
  id: string;
  content: string;
  source: "kb" | "repo" | "conversation" | "fact";
  sourceName: string | null;
  score: number;
  metadata?: Record<string, unknown>;
}

/**
 * Search across conversation history (Chat table) using vector similarity.
 */
async function searchConversations(
  userId: number,
  queryEmbedding: number[],
  limit: number,
): Promise<FederatedResult[]> {
  try {
    const vectorStr = safeVectorLiteral(queryEmbedding);
    const result = await db.execute(sql`
      SELECT "id", "question", "verdict",
             1 - ("embedding" <=> ${vectorStr}::vector) AS score
      FROM "Chat"
      WHERE "userId" = ${userId}
        AND "embedding" IS NOT NULL
      ORDER BY score DESC
      LIMIT ${limit}
    `);

    return (result.rows as Array<{ [key: string]: unknown }>).map((row) => ({
      id: row.id as string,
      content: `Q: ${row.question}\nA: ${row.verdict}`,
      source: "conversation" as const,
      sourceName: "conversation history",
      score: row.score as number,
    }));
  } catch (err) {
    logger.warn({ err }, "Federated search: conversation search failed");
    return [];
  }
}

/**
 * Search across all code repositories for a user using vector similarity.
 */
async function searchAllRepos(
  userId: number,
  queryEmbedding: number[],
  limit: number,
): Promise<FederatedResult[]> {
  try {
    const vectorStr = safeVectorLiteral(queryEmbedding);
    const { rows } = await pool.query<{
      id: string;
      path: string;
      language: string;
      content: string;
      score: number;
      repoName: string;
    }>(
      `SELECT cf."id", cf."path", cf."language", cf."content",
              1 - (cf."embedding" <=> $1::vector) AS score,
              cr."name" AS "repoName"
       FROM "CodeFile" cf
       JOIN "CodeRepository" cr ON cf."repoId" = cr."id"
       WHERE cr."userId" = $2
       ORDER BY score DESC
       LIMIT $3`,
      [vectorStr, userId, limit]
    );

    return rows.map((row) => ({
      id: row.id,
      content: `[${row.path} (${row.language})]\n${row.content}`,
      source: "repo" as const,
      sourceName: `${row.repoName}/${row.path}`,
      score: row.score,
    }));
  } catch (err) {
    logger.warn({ err }, "Federated search: repo search failed");
    return [];
  }
}

/**
 * Search shared facts from council deliberations.
 */
async function searchFacts(
  queryEmbedding: number[],
  conversationId?: string,
  limit: number = 5,
): Promise<FederatedResult[]> {
  try {
    // SharedFact doesn't have embeddings, so do text-based search
    // Only include if conversationId is provided
    if (!conversationId) return [];

    const result = await db.execute(sql`
      SELECT "id", "content", "sourceAgent", "type", "confidence"
      FROM "SharedFact"
      WHERE "conversationId" = ${conversationId}
      ORDER BY "confidence" DESC
      LIMIT ${limit}
    `);

    return (result.rows as Array<{ [key: string]: unknown }>).map((row) => ({
      id: row.id as string,
      content: `[${row.type}] ${row.content} (confidence: ${row.confidence}, source: ${row.sourceAgent})`,
      source: "fact" as const,
      sourceName: row.sourceAgent as string | null,
      score: (row.confidence as number) || 0.5,
    }));
  } catch (err) {
    logger.warn({ err }, "Federated search: fact search failed");
    return [];
  }
}

export interface FederatedSearchOptions {
  userId: number;
  query: string;
  kbId?: string | null;
  conversationId?: string;
  limit?: number;
  /** Which indexes to search. Defaults to all. */
  indexes?: ("kb" | "repo" | "conversation" | "fact")[];
  /** P4-18: Per-source timeout in ms. Defaults to 10s. Prevents one slow backend from stalling the whole call. */
  perSourceTimeoutMs?: number;
}

/**
 * Multi-index federated search: queries across KBs, repos, conversation
 * history, and shared facts in parallel, then merges using RRF.
 */
export async function federatedSearch(opts: FederatedSearchOptions): Promise<FederatedResult[]> {
  const {
    userId,
    query,
    kbId,
    conversationId,
    limit = 10,
    indexes = ["kb", "repo", "conversation", "fact"],
    perSourceTimeoutMs = 10_000,
  } = opts;

  const k = 60; // RRF constant

  // P4-18: Helper to race a search against a per-source timeout.
  // Returns empty results on timeout instead of failing the whole federated search.
  function withTimeout<T>(
    source: string,
    promise: Promise<T>,
    fallback: T,
  ): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((resolve) =>
        setTimeout(() => {
          logger.warn({ source, timeoutMs: perSourceTimeoutMs }, "Federated search source timed out");
          resolve(fallback);
        }, perSourceTimeoutMs),
      ),
    ]);
  }

  // Embed query once, reuse across all indexes
  const queryEmbedding = await embed(query);
  const perIndexLimit = limit * 2;

  // Run all searches in parallel
  const searches: Promise<{ source: string; results: FederatedResult[] }>[] = [];

  if (indexes.includes("kb")) {
    searches.push(
      withTimeout("kb",
        hybridSearch(userId, query, kbId || null, perIndexLimit).then((chunks) => ({
          source: "kb",
          results: chunks.map((c) => ({
            id: c.id,
            content: c.content,
            source: "kb" as const,
            sourceName: c.sourceName,
            score: c.score,
          })),
        })),
        { source: "kb", results: [] },
      )
    );
  }

  if (indexes.includes("repo")) {
    searches.push(
      withTimeout("repo",
        searchAllRepos(userId, queryEmbedding, perIndexLimit).then((results) => ({
          source: "repo",
          results,
        })),
        { source: "repo", results: [] },
      )
    );
  }

  if (indexes.includes("conversation")) {
    searches.push(
      withTimeout("conversation",
        searchConversations(userId, queryEmbedding, perIndexLimit).then((results) => ({
          source: "conversation",
          results,
        })),
        { source: "conversation", results: [] },
      )
    );
  }

  if (indexes.includes("fact") && conversationId) {
    searches.push(
      withTimeout("fact",
        searchFacts(queryEmbedding, conversationId, perIndexLimit).then((results) => ({
          source: "fact",
          results,
        })),
        { source: "fact", results: [] },
      )
    );
  }

  const allSearchResults = await Promise.all(searches);

  // Merge with Reciprocal Rank Fusion
  // P35-10: Cap scoreMap to prevent unbounded memory growth
  const MAX_SCORE_MAP = 10_000;
  const scoreMap = new Map<string, { result: FederatedResult; rrfScore: number }>();

  for (const { results } of allSearchResults) {
    results.forEach((result, rank) => {
      if (scoreMap.size >= MAX_SCORE_MAP && !scoreMap.has(result.id)) return;
      const existing = scoreMap.get(result.id);
      const rrfContrib = 1 / (rank + 1 + k);
      if (existing) {
        existing.rrfScore += rrfContrib;
      } else {
        scoreMap.set(result.id, { result, rrfScore: rrfContrib });
      }
    });
  }

  const merged = Array.from(scoreMap.values())
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .slice(0, limit)
    .map(({ result, rrfScore }) => ({ ...result, score: rrfScore }));

  logger.debug(
    {
      query: query.substring(0, 80),
      indexes,
      resultCounts: Object.fromEntries(allSearchResults.map((s) => [s.source, s.results.length])),
      mergedCount: merged.length,
    },
    "Federated search complete"
  );

  return merged;
}

/**
 * Format federated search results for injection into messages.
 */
export function formatFederatedContext(results: FederatedResult[]): string {
  if (results.length === 0) return "";

  const grouped: Record<string, FederatedResult[]> = {};
  for (const r of results) {
    (grouped[r.source] = grouped[r.source] || []).push(r);
  }

  const parts: string[] = [];

  if (grouped.kb?.length) {
    parts.push(
      "[KNOWLEDGE BASE]\n" +
      grouped.kb.map((r) => `Source: ${r.sourceName || "unknown"}\n${r.content}`).join("\n---\n") +
      "\n[/KNOWLEDGE BASE]"
    );
  }

  if (grouped.repo?.length) {
    parts.push(
      "[CODE REPOSITORY]\n" +
      grouped.repo.map((r) => r.content).join("\n---\n") +
      "\n[/CODE REPOSITORY]"
    );
  }

  if (grouped.conversation?.length) {
    parts.push(
      "[CONVERSATION HISTORY]\n" +
      grouped.conversation.map((r) => r.content).join("\n---\n") +
      "\n[/CONVERSATION HISTORY]"
    );
  }

  if (grouped.fact?.length) {
    parts.push(
      "[COUNCIL FACTS]\n" +
      grouped.fact.map((r) => r.content).join("\n") +
      "\n[/COUNCIL FACTS]"
    );
  }

  return parts.join("\n\n");
}
