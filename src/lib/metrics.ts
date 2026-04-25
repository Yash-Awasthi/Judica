// This file provides TEXT SIMILARITY metrics (tokenSimilarity, semanticSimilarity).
// NOT to be confused with lib/prometheusMetrics.ts which provides Prometheus counters/histograms.
// Despite the naming collision, these serve different purposes and should remain separate.
import type { AgentOutput } from "./schemas.js";
import { mlWorker } from "../lib/ml/ml_worker.js";
import logger from "./logger.js";

// Configurable consensus threshold via environment variable
// NaN guard — fall back to 0.85 if env var is non-numeric
const _parsedConsensus = parseFloat(process.env.CONSENSUS_THRESHOLD || "0.85");
const CONSENSUS_THRESHOLD = Number.isFinite(_parsedConsensus) && _parsedConsensus > 0 && _parsedConsensus <= 1 ? _parsedConsensus : 0.85;

// In-memory similarity cache — avoids recomputing identical pairs across rounds.
// Keyed by sorted pair hash. Bounded to prevent unbounded growth.
const MAX_CACHE_SIZE = 500;
const similarityCache = new Map<string, number>();

/** Clear the similarity cache (for testing). */
export function clearSimilarityCache(): void {
  similarityCache.clear();
}

function getCacheKey(a: string, b: string): string {
  // Sort to ensure (a,b) and (b,a) hit the same cache entry
  return a < b ? `${a.slice(0, 100)}||${b.slice(0, 100)}` : `${b.slice(0, 100)}||${a.slice(0, 100)}`;
}

// Token overlap is an unreliable fallback for semantic comparison —
// it uses Jaccard coefficient on word tokens which misses synonyms, paraphrases,
// and context. This is acceptable as a degraded-mode approximation but should
// not be relied upon for production consensus decisions.
function tokenSimilarity(a: string, b: string): number {
  const normalize = (s: string) => new Set(
    s.toLowerCase().replace(/[^a-z0-9]/g, " ").split(/\s+/).filter(w => w.length > 2)
  );
  const setA = normalize(a);
  const setB = normalize(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;

  let overlap = 0;
  for (const w of setA) { if (setB.has(w)) overlap++; }
  const union = new Set([...setA, ...setB]).size;
  return overlap / union;
}

async function semanticSimilarity(a: string, b: string): Promise<number> {
  // Empty string guard — empty responses should not score as consensus
  if (!a.trim() || !b.trim()) {
    return 0;
  }

  // Check cache before computing
  const cacheKey = getCacheKey(a, b);
  const cached = similarityCache.get(cacheKey);
  if (cached !== undefined) return cached;

  let score: number;
  try {
    score = await mlWorker.computeSimilarity(a, b);
  } catch (err) {
    // Graceful fallback — ML similarity failure should not crash the request.
    // Fall back to token overlap similarity instead of throwing.
    if ((err as NodeJS.ErrnoException).code === 'ENOENT' || process.env.NODE_ENV === 'test') {
      score = tokenSimilarity(a, b);
    } else {
      logger.error({ err: (err as Error).message }, "ML similarity failed — falling back to token similarity");
      // Token similarity is on same 0-1 scale as cosine similarity,
      // but distribution differs. No normalization needed since both return [0,1].
      score = tokenSimilarity(a, b);
    }
  }

  // Store in cache (evict oldest if full)
  if (similarityCache.size >= MAX_CACHE_SIZE) {
    const firstKey = similarityCache.keys().next().value;
    if (firstKey) similarityCache.delete(firstKey);
  }
  similarityCache.set(cacheKey, score);

  return score;
}

export async function pairwiseSimilarity(a: AgentOutput, b: AgentOutput): Promise<number> {
  return await semanticSimilarity(a.answer, b.answer);
}

export async function computeConsensus(outputs: AgentOutput[]): Promise<number> {
  if (outputs.length < 2) return 1.0;

  // Filter out empty responses before computing consensus
  const validOutputs = outputs.filter(o => o.answer.trim().length > 0);
  if (validOutputs.length < 2) return 0.0;

  // Parallelize pairwise similarity — O(n²) pairs computed concurrently
  // instead of sequential awaits. For N agents, this is N*(N-1)/2 comparisons.
  const pairs: Promise<number>[] = [];

  for (let i = 0; i < validOutputs.length; i++) {
    for (let j = i + 1; j < validOutputs.length; j++) {
      pairs.push(pairwiseSimilarity(validOutputs[i], validOutputs[j]));
    }
  }

  const similarities = await Promise.all(pairs);

  if (similarities.length === 0) return 0.0;

  return similarities.reduce((a, b) => a + b, 0) / similarities.length;
}

// Threshold is now configurable via CONSENSUS_THRESHOLD env var
export async function isConsensusReached(outputs: AgentOutput[], threshold = CONSENSUS_THRESHOLD): Promise<boolean> {
  return (await computeConsensus(outputs)) >= threshold;
}
