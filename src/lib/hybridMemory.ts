/**
 * Hybrid Memory Store — Phase 2.9
 *
 * Every memory stored simultaneously in three places:
 * 1. Vector similarity via pgvector (semantic search)
 * 2. Key-value lookup via exact fact text (fast exact retrieval)
 * 3. Graph traversal via memory_triples (relationship search)
 *
 * Inspired by:
 * - mem0 (Apache 2.0, mem0ai/mem0) — hybrid architecture with multi-store retrieval
 *
 * Current implementation:
 * - Vector store: stubbed (requires pgvector; upgrades memoryFacts.embedding column)
 * - KV store: exact text lookup on memoryFacts.fact
 * - Graph store: triple-pattern lookup on memoryTriples (subject/predicate/object)
 * - Merge: deduplicate by content, sort by score descending
 */

import { db } from "./drizzle.js";
import { memoryFacts } from "../db/schema/memoryFacts.js";
import { memoryTriples } from "../db/schema/memoryTriples.js";
import { eq, ilike, gte, desc, and } from "drizzle-orm";

export interface HybridMemoryResult {
  store: "kv" | "vector" | "graph";
  content: string;
  score: number;
  conversationId?: string | null;
}

/**
 * KV store lookup — fast exact/prefix match on fact text.
 * Production: use a Redis hash map keyed by userId:factHash.
 */
async function kvLookup(userId: number, query: string): Promise<HybridMemoryResult[]> {
  const rows = await db
    .select()
    .from(memoryFacts)
    .where(and(
      eq(memoryFacts.userId, userId),
      ilike(memoryFacts.fact, `%${query.slice(0, 60)}%`),
    ))
    .limit(20);

  return rows.map(r => ({
    store: "kv" as const,
    content: r.fact,
    score: r.decayScore ?? 1.0,
    conversationId: r.conversationId,
  }));
}

/**
 * Vector store lookup — semantic similarity.
 * Stub: falls back to decay-sorted full scan.
 * Production upgrade: use pgvector `<=>` cosine distance with embedding column.
 */
async function vectorLookup(userId: number, _query: string): Promise<HybridMemoryResult[]> {
  const rows = await db
    .select()
    .from(memoryFacts)
    .where(and(
      eq(memoryFacts.userId, userId),
      gte(memoryFacts.decayScore, 0.3),
    ))
    .orderBy(desc(memoryFacts.decayScore))
    .limit(20);

  return rows.map(r => ({
    store: "vector" as const,
    content: r.fact,
    score: r.decayScore ?? 1.0,
    conversationId: r.conversationId,
  }));
}

/**
 * Graph store lookup — triple-pattern match.
 * Matches triples where subject or object contains query terms.
 */
async function graphLookup(userId: number, query: string): Promise<HybridMemoryResult[]> {
  const term = `%${query.slice(0, 40)}%`;

  const rows = await db
    .select()
    .from(memoryTriples)
    .where(and(
      eq(memoryTriples.userId, userId),
      ilike(memoryTriples.subject, term),
    ))
    .limit(20);

  return rows.map(r => ({
    store: "graph" as const,
    content: `${r.subject} ${r.predicate} ${r.object}`,
    score: r.confidence ?? 1.0,
    conversationId: r.conversationId,
  }));
}

/**
 * Hybrid retrieval — queries all three stores in parallel and merges results.
 * Deduplicates by content string, keeps highest score per content.
 */
export async function hybridMemorySearch(
  userId: number,
  query: string,
  topN = 15,
): Promise<HybridMemoryResult[]> {
  const [kvResults, vectorResults, graphResults] = await Promise.all([
    kvLookup(userId, query),
    vectorLookup(userId, query),
    graphLookup(userId, query),
  ]);

  const all = [...kvResults, ...vectorResults, ...graphResults];

  // Deduplicate by content, keeping highest score
  const seen = new Map<string, HybridMemoryResult>();
  for (const r of all) {
    const existing = seen.get(r.content);
    if (!existing || r.score > existing.score) {
      seen.set(r.content, r);
    }
  }

  return Array.from(seen.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}

/** Format hybrid memory results as a context block */
export function formatHybridMemoryContext(results: HybridMemoryResult[]): string {
  if (results.length === 0) return "";
  const lines = results.map(r => `• [${r.store}] ${r.content}`).join("\n");
  return `[HYBRID MEMORY — ${results.length} results]\n${lines}\n[/HYBRID MEMORY]`;
}
