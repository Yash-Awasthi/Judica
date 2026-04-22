import { db } from "./drizzle.js";
import { evaluations } from "../db/schema/users.js";
import { eq, gte, and, avg, count, asc } from "drizzle-orm";
import logger from "./logger.js";
import { computeConsensus, pairwiseSimilarity } from "./metrics.js";
import type { AgentOutput } from "./schemas.js";

export interface EvaluationCriteria {
  coherence: number; // 0-1: How well responses align
  consensus: number; // 0-1: Level of agreement
  diversity: number; // 0-1: Variety of perspectives
  quality: number; // 0-1: Overall response quality
  efficiency: number; // 0-1: Token efficiency
}

export interface EvaluationResult {
  sessionId: string;
  conversationId: string;
  userId: number;
  criteria: EvaluationCriteria;
  overallScore: number; // 0-100
  recommendations: string[];
  strengths: string[];
  weaknesses: string[];
  timestamp: Date;
}

export interface EvaluationMetrics {
  averageConsensus: number;
  averageDiversity: number;
  averageQuality: number;
  averageEfficiency: number;
  totalEvaluations: number;
  improvementTrend: number; // Positive = improving
  userSatisfaction: number; // 0-5 based on feedback
}

export async function evaluateCouncilSession(
  sessionId: string,
  conversationId: string,
  userId: number,
  agentOutputs: AgentOutput[],
  totalTokens: number,
  duration: number,
  _userFeedback?: number
): Promise<EvaluationResult> {
  try {
    const coherence = await calculateCoherence(agentOutputs);
    const consensus = await computeConsensus(agentOutputs);
    const diversity = calculateDiversity(agentOutputs);
    const quality = calculateQuality(agentOutputs);
    const efficiency = calculateEfficiency(totalTokens, agentOutputs.length, duration);

    const weights = { coherence: 0.25, consensus: 0.25, diversity: 0.2, quality: 0.2, efficiency: 0.1 };
    // P10-52: All criteria normalized to [0,1]; overallScore is [0,100] (criteria * 100)
    const overallScore = Math.max(0, Math.min(100, (
      coherence * weights.coherence +
      consensus * weights.consensus +
      diversity * weights.diversity +
      quality * weights.quality +
      efficiency * weights.efficiency
    ) * 100));

    const recommendations = generateRecommendations({
      coherence,
      consensus,
      diversity,
      quality,
      efficiency
    });

    const strengths = identifyStrengths({
      coherence,
      consensus,
      diversity,
      quality,
      efficiency
    });

    const weaknesses = identifyWeaknesses({
      coherence,
      consensus,
      diversity,
      quality,
      efficiency
    });

    const result: EvaluationResult = {
      sessionId,
      conversationId,
      userId,
      criteria: { coherence, consensus, diversity, quality, efficiency },
      overallScore,
      recommendations,
      strengths,
      weaknesses,
      timestamp: new Date()
    };

    await storeEvaluationResult(result);

    logger.info({
      sessionId,
      userId,
      overallScore,
      consensus,
      quality
    }, "Council evaluation completed");

    return result;

  } catch (err) {
    logger.error({ err: (err as Error).message, sessionId }, "Failed to evaluate council session");
    throw err;
  }
}

async function calculateCoherence(outputs: AgentOutput[]): Promise<number> {
  if (outputs.length < 2) return 1;

  let totalSimilarity = 0;
  let comparisons = 0;

  for (let i = 0; i < outputs.length; i++) {
    for (let j = i + 1; j < outputs.length; j++) {
      totalSimilarity += await pairwiseSimilarity(outputs[i], outputs[j]);
      comparisons++;
    }
  }

  return comparisons > 0 ? totalSimilarity / comparisons : 1;
}

function calculateDiversity(outputs: AgentOutput[]): number {
  if (outputs.length < 2) return 0;

  const confidences = outputs.map(o => o.confidence);
  const meanConfidence = confidences.reduce((sum, c) => sum + c, 0) / confidences.length;
  const variance = confidences.reduce((sum, c) => sum + Math.pow(c - meanConfidence, 2), 0) / confidences.length;

  const lengths = outputs.map(o => o.answer.length + o.reasoning.length);
  const meanLength = lengths.reduce((sum, l) => sum + l, 0) / lengths.length;
  const lengthVariance = lengths.reduce((sum, l) => sum + Math.pow(l - meanLength, 2), 0) / lengths.length;

  // P10-49: Normalize diversity scores relative to council size
  // Larger councils naturally have more variance; normalize to make scores comparable
  const sizeFactor = Math.log2(outputs.length) / Math.log2(10); // Normalize to ~10 agents
  const confidenceDiversity = Math.min(variance * 4 / Math.max(sizeFactor, 0.5), 1);
  const lengthDiversity = Math.min(lengthVariance / (10000 * Math.max(sizeFactor, 0.5)), 1);

  const allKeywords = new Set<string>();
  outputs.forEach(o => {
    const keywords = extractKeywords(o.answer + " " + o.reasoning);
    keywords.forEach(k => allKeywords.add(k));
  });

  // P10-49: Normalize keyword diversity by expected keywords per agent
  const expectedKeywordsPerAgent = 8;
  const keywordDiversity = Math.min(allKeywords.size / (outputs.length * expectedKeywordsPerAgent), 1);

  return (confidenceDiversity + lengthDiversity + keywordDiversity) / 3;
}

function calculateQuality(outputs: AgentOutput[]): number {
  let totalQuality = 0;

  for (const output of outputs) {
    let quality = 0;

    // P10-47: Use semantic quality metrics instead of pure length
    // Structural completeness: has answer, reasoning, key points
    const hasSubstantiveAnswer = output.answer.length >= 50;
    const hasReasoning = output.reasoning.length >= 50;
    const hasKeyPoints = output.key_points.length >= 2;
    const hasAssumptions = output.assumptions.length > 0;

    if (hasSubstantiveAnswer) quality += 0.25;
    if (hasReasoning) quality += 0.25;
    if (hasKeyPoints) quality += 0.2;
    if (hasAssumptions) quality += 0.1;

    // Confidence calibration: penalize extreme overconfidence or underconfidence
    if (output.confidence >= 0.3 && output.confidence <= 0.9) {
      quality += 0.2;
    } else if (output.confidence > 0.95) {
      quality += 0.05; // Overconfidence penalty
    } else {
      quality += 0.1;
    }

    totalQuality += quality;
  }

  return outputs.length > 0 ? totalQuality / outputs.length : 0;
}

// P10-48: Configurable efficiency baselines via environment variables
const _parsedDuration = parseInt(process.env.EVAL_OPTIMAL_DURATION_PER_AGENT_MS || "10000", 10);
const OPTIMAL_DURATION_PER_AGENT_MS = Number.isFinite(_parsedDuration) ? _parsedDuration : 10000;
const _parsedTokens = parseInt(process.env.EVAL_OPTIMAL_TOKENS_PER_AGENT || "1000", 10);
const OPTIMAL_TOKENS_PER_AGENT = Number.isFinite(_parsedTokens) ? _parsedTokens : 1000;

function calculateEfficiency(totalTokens: number, agentCount: number, duration: number): number {
  if (agentCount === 0) return 0;
  const tokensPerAgent = totalTokens / agentCount;

  const optimalDuration = agentCount * OPTIMAL_DURATION_PER_AGENT_MS;
  const timeEfficiency = Math.max(0, 1 - Math.abs(duration - optimalDuration) / optimalDuration);

  const tokenEfficiency = Math.max(0, 1 - Math.abs(tokensPerAgent - OPTIMAL_TOKENS_PER_AGENT) / OPTIMAL_TOKENS_PER_AGENT);

  return (timeEfficiency + tokenEfficiency) / 2;
}

function extractKeywords(text: string): string[] {
  // P10-53: Improved keyword extraction — handle punctuation, multi-word terms, stopwords
  const words = text.toLowerCase()
    .replace(/[^\w\s-]/g, ' ') // Keep hyphens for compound words
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(word => word.length > 3)
    .filter(word => !isStopWord(word))
    .filter(word => !/^\d+$/.test(word)); // Filter pure numbers

  return [...new Set(words)].slice(0, 20);
}

const STOP_WORDS = new Set(['the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been', 'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'can', 'this', 'that', 'these', 'those', 'what', 'which', 'who', 'when', 'where', 'why', 'how', 'not', 'no', 'yes', 'if', 'then', 'else', 'because', 'since', 'until', 'while', 'during', 'before', 'after', 'above', 'below', 'under', 'over', 'between', 'among', 'through', 'against', 'without', 'within', 'upon', 'about', 'along', 'around', 'behind', 'beyond', 'inside', 'outside', 'toward', 'towards', 'into', 'onto', 'off']);

function isStopWord(word: string): boolean {
  return STOP_WORDS.has(word);
}

function generateRecommendations(criteria: EvaluationCriteria): string[] {
  const recommendations: string[] = [];

  if (criteria.coherence < 0.6) {
    recommendations.push("Improve prompt clarity to increase response coherence");
  }

  if (criteria.consensus < 0.5) {
    recommendations.push("Consider using fewer agents or more focused questions to improve consensus");
  }

  if (criteria.diversity < 0.4) {
    recommendations.push("Add more diverse archetypes to get varied perspectives");
  }

  if (criteria.quality < 0.6) {
    recommendations.push("Refine system prompts to improve response quality");
  }

  if (criteria.efficiency < 0.5) {
    recommendations.push("Optimize token usage or adjust timeout settings for better efficiency");
  }

  if (criteria.coherence > 0.8 && criteria.consensus > 0.8) {
    recommendations.push("Excellent performance achieved - consider increasing complexity for more challenging queries");
  }

  return recommendations;
}

function identifyStrengths(criteria: EvaluationCriteria): string[] {
  const strengths: string[] = [];

  if (criteria.coherence > 0.8) strengths.push("High response coherence");
  if (criteria.consensus > 0.8) strengths.push("Strong consensus building");
  if (criteria.diversity > 0.7) strengths.push("Excellent perspective diversity");
  if (criteria.quality > 0.8) strengths.push("High-quality responses");
  if (criteria.efficiency > 0.8) strengths.push("Optimal resource efficiency");

  return strengths;
}

function identifyWeaknesses(criteria: EvaluationCriteria): string[] {
  const weaknesses: string[] = [];

  if (criteria.coherence < 0.4) weaknesses.push("Low response coherence");
  if (criteria.consensus < 0.4) weaknesses.push("Poor consensus achievement");
  if (criteria.diversity < 0.3) weaknesses.push("Limited perspective diversity");
  if (criteria.quality < 0.4) weaknesses.push("Low response quality");
  if (criteria.efficiency < 0.4) weaknesses.push("Poor resource efficiency");

  return weaknesses;
}

async function storeEvaluationResult(result: EvaluationResult): Promise<void> {
  try {
    await db.insert(evaluations).values({
      sessionId: result.sessionId,
      conversationId: result.conversationId,
      userId: result.userId,
      coherence: result.criteria.coherence,
      consensus: result.criteria.consensus,
      diversity: result.criteria.diversity,
      quality: result.criteria.quality,
      efficiency: result.criteria.efficiency,
      overallScore: result.overallScore,
      recommendations: result.recommendations,
      strengths: result.strengths,
      weaknesses: result.weaknesses,
      timestamp: result.timestamp
    });
  } catch (err) {
    // P10-55: Log at error level with structured context for alerting
    logger.error({
      err: (err as Error).message,
      sessionId: result.sessionId,
      userId: result.userId,
      overallScore: result.overallScore,
      alert: "evaluation_persistence_failure" // Structured field for log-based alerting
    }, "CRITICAL: Failed to persist evaluation metrics — data loss");
  }
}

export async function getUserEvaluationMetrics(userId: number, days: number = 30): Promise<EvaluationMetrics> {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const results = await db
    .select()
    .from(evaluations)
    .where(
      and(
        eq(evaluations.userId, userId),
        gte(evaluations.timestamp, startDate)
      )
    )
    .orderBy(asc(evaluations.timestamp));

  if (results.length === 0) {
    return {
      averageConsensus: 0,
      averageDiversity: 0,
      averageQuality: 0,
      averageEfficiency: 0,
      totalEvaluations: 0,
      improvementTrend: 0,
      userSatisfaction: 0
    };
  }

  // P10-54: Require minimum sample size for stable rolling averages
  const MIN_SAMPLE_SIZE = 3;
  const stableResults = results.length >= MIN_SAMPLE_SIZE;

  const averageConsensus = results.reduce((sum, e) => sum + e.consensus, 0) / results.length;
  const averageDiversity = results.reduce((sum, e) => sum + e.diversity, 0) / results.length;
  const averageQuality = results.reduce((sum, e) => sum + e.quality, 0) / results.length;
  const averageEfficiency = results.reduce((sum, e) => sum + e.efficiency, 0) / results.length;

  // P10-54: Only compute trend when enough samples exist
  const midpoint = Math.floor(results.length / 2);
  const firstHalf = results.slice(0, midpoint);
  const secondHalf = results.slice(midpoint);

  const firstHalfAvg = firstHalf.length > 0 ? firstHalf.reduce((sum, e) => sum + e.overallScore, 0) / firstHalf.length : 0;
  const secondHalfAvg = secondHalf.length > 0 ? secondHalf.reduce((sum, e) => sum + e.overallScore, 0) / secondHalf.length : 0;

  const improvementTrend = stableResults ? (secondHalfAvg - firstHalfAvg) : 0; // P10-54: No trend from <3 samples

  return {
    averageConsensus,
    averageDiversity,
    averageQuality,
    averageEfficiency,
    totalEvaluations: results.length,
    improvementTrend,
    // P10-51: userSatisfaction requires user feedback integration (thumbs up/down)
    // Currently returns 0 until feedback collection is wired up in the UI
    userSatisfaction: 0
  };
}

export async function benchmarkCouncilPerformance(
  userId: number,
  _councilSize: number,
  _queryComplexity: 'simple' | 'moderate' | 'complex'
): Promise<{
  userScore: number;
  benchmarkScore: number;
  percentile: number;
  ranking: 'excellent' | 'good' | 'average' | 'below_average';
}> {
  const metrics = await getUserEvaluationMetrics(userId);

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [benchmarks] = await db
    .select({
      avgOverallScore: avg(evaluations.overallScore),
      total: count(),
    })
    .from(evaluations)
    .where(gte(evaluations.timestamp, thirtyDaysAgo));

  const userScore = metrics.averageConsensus * 25 + metrics.averageQuality * 25 + metrics.averageDiversity * 25 + metrics.averageEfficiency * 25;
  const benchmarkScore = (Number(benchmarks?.avgOverallScore) || 0) * 100;

  // P10-50: Fix percentile — use proper ratio with NaN guard
  const percentile = benchmarkScore > 0
    ? Math.max(0, Math.min(100, (userScore / benchmarkScore) * 50)) // 50 = at benchmark average
    : (userScore > 0 ? 75 : 50); // No benchmark data: default to above-average if user has score

  let ranking: 'excellent' | 'good' | 'average' | 'below_average';
  if (percentile >= 90) ranking = 'excellent';
  else if (percentile >= 70) ranking = 'good';
  else if (percentile >= 50) ranking = 'average';
  else ranking = 'below_average';

  return {
    userScore,
    benchmarkScore,
    percentile,
    ranking
  };
}
