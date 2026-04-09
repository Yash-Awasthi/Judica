import { AgentOutput, ScoredOpinion, AdversarialResult, GroundingResult, PeerReview } from "./schemas.js";
import { mlWorker } from "../lib/ml/ml_worker.js";
import { validationModule } from "./validation.js";
import logger from "./logger.js";

async function computeSemanticSimilarityML(a: string, b: string): Promise<number> {
  try {
    return await mlWorker.computeSimilarity(a, b);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT' || process.env.NODE_ENV === 'test') {
      const normalize = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9]/g, " ").split(/\s+/).filter(w => w.length > 2));
      const setA = normalize(a);
      const setB = normalize(b);
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
  if (reviews.length === 0) return 0.5;
  const label = anonymizedLabels.get(agentName);
  if (!label) return 0.0;
  
  let totalNormalizedScore = 0;
  let reviewCount = 0;

  for (const review of reviews) {
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

    let adversarialPenalty = 0;
    if (op.adversarial) {
      if (op.adversarial.stress_score > 0.4) {
        adversarialPenalty = -(op.adversarial.stress_score * 0.2);
      }
    }
    finalScore += adversarialPenalty;

    let groundingPenalty = 0;
    if (op.grounding) {
      if (!op.grounding.grounded || op.grounding.unsupported_claims.length > 0) {
        groundingPenalty = -(op.grounding.unsupported_claims.length * 0.05);
      }
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
        confidence: op.structured.confidence,
        agreement: Math.min(agreement, 1.0),
        peerRanking: Math.min(peerRanking, 1.0),
        validationPenalty: vPenalty,
        adversarialPenalty: adversarialPenalty,
        groundingPenalty: groundingPenalty,
        final: Math.max(0, Math.round(finalScore * 1000) / 1000)
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