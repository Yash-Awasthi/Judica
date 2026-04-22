import type { AgentOutput, ScoredOpinion, AdversarialResult, GroundingResult, PeerReview } from "./schemas.js";
import { mlWorker } from "../lib/ml/ml_worker.js";
import { validationModule } from "./validation.js";
import logger from "./logger.js";

let mlFallbackWarned = false;

const MAX_SIMILARITY_INPUT_LENGTH = 10_000;

async function computeSemanticSimilarityML(a: string, b: string): Promise<number> {
  const cappedA = a.length > MAX_SIMILARITY_INPUT_LENGTH ? a.slice(0, MAX_SIMILARITY_INPUT_LENGTH) : a;
  const cappedB = b.length > MAX_SIMILARITY_INPUT_LENGTH ? b.slice(0, MAX_SIMILARITY_INPUT_LENGTH) : b;
  try {
    return await mlWorker.computeSimilarity(cappedA, cappedB);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT' || process.env.NODE_ENV === 'test') {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT' && process.env.NODE_ENV !== 'test' && !mlFallbackWarned) {
        logger.warn("ML worker binary not found — falling back to Jaccard similarity. Scoring accuracy will be degraded.");
        mlFallbackWarned = true;
      }
      const normalize = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9]/g, " ").split(/\s+/).filter(w => w.length > 2));
      const setA = normalize(cappedA);
      const setB = normalize(cappedB);
      if (setA.size === 0 && setB.size === 0) return 1;
      if (setA.size === 0 || setB.size === 0) return 0;
      let overlap = 0;
      for (const w of setA) { if (setB.has(w)) overlap++; }
      const union = new Set([...setA, ...setB]).size;
      return overlap / union;
    }
    logger.error({ err: err instanceof Error ? err.message : String(err) }, "Scoring ML similarity check CRITICAL FAILURE.");
    throw new Error("ML Scoring Engine Failure", { cause: err });
  }
}

async function computeAgreement(a: AgentOutput, b: AgentOutput): Promise<number> {
  return await computeSemanticSimilarityML(a.answer, b.answer);
}

async function averageAgreement(index: number, outputs: AgentOutput[]): Promise<number> {
  if (outputs.length <= 1) return 1.0;
  let total = 0;
  let count = 0;
  for (let i = 0; i < outputs.length; i++) {
    if (i === index) continue;
    const sim = await computeAgreement(outputs[index], outputs[i]);
    total += sim;
    count++;
  }
  return count > 0 ? total / count : 1.0;
}

function computePeerRankingScore(agentName: string, anonymizedLabels: Map<string, string>, reviews: PeerReview[]): number {
  const label = anonymizedLabels.get(agentName);
  if (!label) return 0.0;
  if (reviews.length === 0) return 0.5;
  
  let totalNormalizedScore = 0;
  let reviewCount = 0;

  for (const review of reviews) {
    if (!Array.isArray(review.ranking)) continue;
    const rankIndex = review.ranking.indexOf(label);
    if (rankIndex === -1) continue;

    const normalized = 1 - (rankIndex / Math.max(review.ranking.length - 1, 1));
    totalNormalizedScore += normalized;
    reviewCount++;
  }
  
  return reviewCount > 0 ? totalNormalizedScore / reviewCount : 0.0;
}

export async function scoreOpinions(
  opinions: { 
    name: string; 
    opinion: string; 
    structured: AgentOutput; 
    isFallback?: boolean;
    adversarial?: AdversarialResult;
    grounding?: GroundingResult;
  }[],
  peerReviews: PeerReview[],
  anonymizedLabels: Map<string, string>
): Promise<ScoredOpinion[]> {
  const outputs = opinions.map(o => o.structured);
  
  const scored = await Promise.all(opinions.map(async (op, i) => {
    const agreement = await averageAgreement(i, outputs);
    const peerRanking = computePeerRankingScore(op.name, anonymizedLabels, peerReviews);
    
    let finalScore = (0.6 * agreement) + (0.4 * peerRanking);

    const validationResults = await validationModule.validate(op.structured);
    const vPenalty = Math.max(-0.3, validationResults
      .filter(r => !r.valid)
      .reduce((sum, r) => sum + r.confidence_adjustment, 0));
    finalScore += vPenalty;

    // P10-37: If validation finds critical failures, quarantine the response
    const criticalFailures = validationResults.filter(r => !r.valid && r.confidence_adjustment <= -0.2);
    if (criticalFailures.length > 0) {
      finalScore = Math.min(finalScore, 0.1); // Cap at 0.1 — effectively quarantined
    }

    let adversarialPenalty = 0;
    if (op.adversarial) {
      if (op.adversarial.stress_score > 0.4) {
        adversarialPenalty = -(op.adversarial.stress_score * 0.2);
      }
      // P10-126: If adversarial parse failed (is_robust defaults to true on failure),
      // apply penalty instead of rewarding the failure
      if (!op.adversarial.is_robust && op.adversarial.failures.length === 0) {
        // Suspicious: marked not robust but no failures identified — likely parse error
        adversarialPenalty = -0.1;
      }
    } else {
      // P10-126: Missing adversarial result = could not validate = penalize, not reward
      adversarialPenalty = -0.05;
    }
    finalScore += adversarialPenalty;

    let groundingPenalty = 0;
    if (op.grounding) {
      if (!op.grounding.grounded || op.grounding.unsupported_claims.length > 0) {
        groundingPenalty = -(op.grounding.unsupported_claims.length * 0.05);
      }
    } else {
      // P10-126: Missing grounding result = could not verify = penalize, not assume grounded
      groundingPenalty = -0.05;
    }
    finalScore += groundingPenalty;

    if (agreement < 0.5) {
      finalScore *= 0.1; 
    }

    return {
      name: op.name,
      opinion: op.opinion,
      structured: op.structured,
      scores: {
        // P10-42: Clamp confidence to [0, 1] to prevent out-of-range arithmetic
        confidence: Math.max(0, Math.min(1, op.structured.confidence)),
        agreement: Math.max(0, Math.min(1, agreement)),
        peerRanking: Math.max(0, Math.min(1, peerRanking)),
        validationPenalty: vPenalty,
        adversarialPenalty: adversarialPenalty,
        groundingPenalty: groundingPenalty,
        final: Math.max(0, Math.min(1, Math.round(finalScore * 1000) / 1000))
      },
      validation: validationResults,
      adversarial: op.adversarial,
      grounding: op.grounding
    } as ScoredOpinion;
  }));

  return scored;
}

export function filterAndRank(scored: ScoredOpinion[], minThreshold = 0.3): ScoredOpinion[] {
  return scored.filter(s => s.scores.final >= minThreshold).sort((a, b) => b.scores.final - a.scores.final);
}