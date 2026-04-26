/**
 * Cross-Conversation Memory Retrieval — Phase 2.7
 *
 * Retrieves relevant memory facts and triples from previous conversations
 * based on semantic similarity with the current question.
 *
 * Inspired by:
 * - mem0 (Apache 2.0, mem0ai/mem0) — persistent cross-session memory search
 * - Zep (Apache 2.0, getzep/zep) — temporal knowledge graph search
 *
 * Strategy: keyword overlap (Jaccard) between question and memory facts.
 * Production upgrade: use pgvector cosine similarity for true semantic search.
 */

import { db } from "./drizzle.js";
import { memoryFacts } from "../db/schema/memoryFacts.js";
import { memoryTriples } from "../db/schema/memoryTriples.js";
import { eq, gte, desc } from "drizzle-orm";

/** Tokenize text into lowercase words, strip common stop words */
function keywords(text: string): Set<string> {
  const stop = new Set(["a","an","the","is","are","was","in","on","at","to","for","of","and","or","but","it","this","that"]);
  return new Set(
    text.toLowerCase().replace(/[^\w\s]/g, " ").split(/\s+/)
      .filter(w => w.length > 2 && !stop.has(w))
  );
}

function jaccardSim(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const w of a) { if (b.has(w)) intersection++; }
  return intersection / (a.size + b.size - intersection);
}

export interface RetrievedMemory {
  type: "fact" | "triple";
  content: string;
  relevance: number;
  conversationId?: string | null;
}

/**
 * Retrieve memories relevant to a question across all conversations.
 * Returns top-N facts and triples sorted by relevance.
 */
export async function retrieveCrossConversationMemory(
  userId: number,
  question: string,
  topN = 10,
): Promise<RetrievedMemory[]> {
  const qKws = keywords(question);

  const [facts, triples] = await Promise.all([
    db.select().from(memoryFacts)
      .where(gte(memoryFacts.decayScore, 0.1))
      .orderBy(desc(memoryFacts.decayScore))
      .limit(200),
    db.select().from(memoryTriples)
      .where(eq(memoryTriples.userId, userId))
      .limit(200),
  ]);

  const candidates: RetrievedMemory[] = [];

  for (const f of facts) {
    const sim = jaccardSim(qKws, keywords(f.fact));
    if (sim > 0) {
      candidates.push({
        type: "fact",
        content: f.fact,
        relevance: sim * (f.decayScore ?? 1.0),
        conversationId: f.conversationId,
      });
    }
  }

  for (const t of triples) {
    const tripleText = `${t.subject} ${t.predicate} ${t.object}`;
    const sim = jaccardSim(qKws, keywords(tripleText));
    if (sim > 0) {
      candidates.push({
        type: "triple",
        content: tripleText,
        relevance: sim * (t.confidence ?? 1.0),
        conversationId: t.conversationId,
      });
    }
  }

  return candidates
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, topN);
}

/** Format retrieved memories as a system context block */
export function formatCrossMemoryContext(memories: RetrievedMemory[]): string {
  if (memories.length === 0) return "";
  const lines = memories.map(m => `• [${m.type}] ${m.content}`).join("\n");
  return `[LONG-TERM MEMORY]\n${lines}\n[/LONG-TERM MEMORY]`;
}
