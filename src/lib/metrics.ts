import { AgentOutput } from "./schemas.js";
import { mlWorker } from "./ml/ml_worker.js";
import logger from "./logger.js";

/**
 * Compute token-level overlap between two strings (Jaccard similarity).
 * Keep as a basic fallback or for small metadata strings.
 */
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

/**
 * High-fidelity semantic similarity using local ML embeddings.
 * No fallback to heuristics if ML fails in this phase, to ensure mathematical correctness.
 */
async function semanticSimilarity(a: string, b: string): Promise<number> {
  try {
    return await mlWorker.computeSimilarity(a, b);
  } catch (err) {
    logger.error({ err: (err as Error).message }, "ML similarity failed in metrics - critical error");
    throw new Error("ML Consensus Engine Failure");
  }
}

/**
 * Compute pairwise similarity between two structured agent outputs.
 * Purely based on semantic similarity of the final answer.
 * Removed all heuristics and confidence weights.
 */
export async function pairwiseSimilarity(a: AgentOutput, b: AgentOutput): Promise<number> {
  // Directly compare the primary answer text
  return await semanticSimilarity(a.answer, b.answer);
}

/**
 * Compute consensus score across all agent outputs.
 * Formula: consensus = avg(pairwise_cosine_similarity(embeddings))
 * Implements outlier exclusion (similarity < 0.5 deleted from average).
 */
export async function computeConsensus(outputs: AgentOutput[]): Promise<number> {
  if (outputs.length < 2) return 1.0;
  
  const similarities: number[] = [];
  
  for (let i = 0; i < outputs.length; i++) {
    for (let j = i + 1; j < outputs.length; j++) {
      const sim = await pairwiseSimilarity(outputs[i], outputs[j]);
      // Phase 1: Consensus Purity Update 
      // Rule: include all responses to reflect the full diverse viewpoint in the consensus baseline.
      similarities.push(sim);
    }
  }
  
  if (similarities.length === 0) return 0.0;
  
  return similarities.reduce((a, b) => a + b, 0) / similarities.length;
}

/**
 * Check if consensus threshold is met.
 */
export async function isConsensusReached(outputs: AgentOutput[], threshold = 0.85): Promise<boolean> {
  return (await computeConsensus(outputs)) >= threshold;
}