/**
 * Semantic Memory Deduplication — Phase 2.5
 *
 * Detects and merges duplicate memory facts using string similarity.
 * Prevents the memory store from accumulating redundant variations of the same fact.
 *
 * Inspired by:
 * - mem0 (Apache 2.0, mem0ai/mem0) — contradiction and duplicate detection
 * - FAISS (MIT, facebookresearch/faiss) — similarity search for deduplication
 *
 * Strategy: Jaccard trigram similarity between new fact and existing facts.
 * If similarity > threshold (0.8), merge by keeping the higher-confidence version.
 * Production upgrade: replace with vector cosine similarity via pgvector.
 */

import { db } from "./drizzle.js";
import { memoryFacts } from "../db/schema/memoryFacts.js";
import { eq, and } from "drizzle-orm";
import logger from "./logger.js";

const DEDUP_THRESHOLD = 0.8;

/** Extract character trigrams from a string */
function trigrams(text: string): Set<string> {
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
  const set = new Set<string>();
  for (let i = 0; i <= normalized.length - 3; i++) {
    set.add(normalized.slice(i, i + 3));
  }
  return set;
}

/** Jaccard similarity between two trigram sets */
function jaccardTrigramSim(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) { if (b.has(t)) intersection++; }
  const union = a.size + b.size - intersection;
  return union > 0 ? intersection / union : 0;
}

export interface DeduplicationResult {
  isDuplicate: boolean;
  existingId?: string;
  similarity?: number;
}

/**
 * Check if a new fact is a near-duplicate of any existing fact for the user.
 * Returns the existing fact's ID if a duplicate is found.
 */
export async function checkDuplicate(
  userId: number,
  newFact: string,
  threshold = DEDUP_THRESHOLD,
): Promise<DeduplicationResult> {
  const existingFacts = await db
    .select({ id: memoryFacts.id, fact: memoryFacts.fact })
    .from(memoryFacts)
    .where(eq(memoryFacts.userId, userId))
    .limit(500); // Check against recent memories

  const newTrigrams = trigrams(newFact);

  for (const existing of existingFacts) {
    const existingTrigrams = trigrams(existing.fact);
    const sim = jaccardTrigramSim(newTrigrams, existingTrigrams);
    if (sim >= threshold) {
      logger.debug({ similarity: sim, existingId: existing.id }, "Duplicate memory detected");
      return { isDuplicate: true, existingId: existing.id, similarity: sim };
    }
  }

  return { isDuplicate: false };
}

/**
 * Deduplicate a batch of fact strings against each other.
 * Returns only the unique facts (keeping first occurrence of each cluster).
 */
export function deduplicateBatch(facts: string[], threshold = DEDUP_THRESHOLD): string[] {
  const unique: string[] = [];
  const uniqueTrigrams: Set<string>[] = [];

  for (const fact of facts) {
    const ft = trigrams(fact);
    let isDup = false;
    for (const existing of uniqueTrigrams) {
      if (jaccardTrigramSim(ft, existing) >= threshold) {
        isDup = true;
        break;
      }
    }
    if (!isDup) {
      unique.push(fact);
      uniqueTrigrams.push(ft);
    }
  }

  return unique;
}
