import { AgentOutput } from "./schemas.js";
import { mlWorker } from "./ml/ml_worker.js";
import logger from "./logger.js";

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
  try {
    return await mlWorker.computeSimilarity(a, b);
  } catch (err) {
    logger.error({ err: (err as Error).message }, "ML similarity failed in metrics - critical error");
    throw new Error("ML Consensus Engine Failure");
  }
}

export async function pairwiseSimilarity(a: AgentOutput, b: AgentOutput): Promise<number> {
  return await semanticSimilarity(a.answer, b.answer);
}

export async function computeConsensus(outputs: AgentOutput[]): Promise<number> {
  if (outputs.length < 2) return 1.0;

  const similarities: number[] = [];

  for (let i = 0; i < outputs.length; i++) {
    for (let j = i + 1; j < outputs.length; j++) {
      const sim = await pairwiseSimilarity(outputs[i], outputs[j]);
      similarities.push(sim);
    }
  }

  if (similarities.length === 0) return 0.0;

  return similarities.reduce((a, b) => a + b, 0) / similarities.length;
}

export async function isConsensusReached(outputs: AgentOutput[], threshold = 0.85): Promise<boolean> {
  return (await computeConsensus(outputs)) >= threshold;
}