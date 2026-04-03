import prisma from "./db.js";
import logger from "./logger.js";
import { computeConsensus, pairwiseSimilarity } from "./metrics.js";
import { AgentOutput } from "./schemas.js";

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

/**
 * Evaluate a council deliberation session.
 */
export async function evaluateCouncilSession(
  sessionId: string,
  conversationId: string,
  userId: number,
  agentOutputs: AgentOutput[],
  totalTokens: number,
  duration: number,
  userFeedback?: number
): Promise<EvaluationResult> {
  try {
    // Calculate individual criteria
    const coherence = await calculateCoherence(agentOutputs);
    const consensus = await computeConsensus(agentOutputs);
    const diversity = calculateDiversity(agentOutputs);
    const quality = calculateQuality(agentOutputs);
    const efficiency = calculateEfficiency(totalTokens, agentOutputs.length, duration);
    
    // Calculate overall score (weighted average)
    const weights = { coherence: 0.25, consensus: 0.25, diversity: 0.2, quality: 0.2, efficiency: 0.1 };
    const overallScore = (
      coherence * weights.coherence +
      consensus * weights.consensus +
      diversity * weights.diversity +
      quality * weights.quality +
      efficiency * weights.efficiency
    ) * 100;
    
    // Generate recommendations
    const recommendations = generateRecommendations({
      coherence,
      consensus,
      diversity,
      quality,
      efficiency
    });
    
    // Identify strengths and weaknesses
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
    
    // Store evaluation result
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

/**
 * Calculate coherence score based on similarity between responses.
 */
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

/**
 * Calculate diversity score based on variance in responses.
 */
function calculateDiversity(outputs: AgentOutput[]): number {
  if (outputs.length < 2) return 0;
  
  // Calculate variance in confidence levels
  const confidences = outputs.map(o => o.confidence);
  const meanConfidence = confidences.reduce((sum, c) => sum + c, 0) / confidences.length;
  const variance = confidences.reduce((sum, c) => sum + Math.pow(c - meanConfidence, 2), 0) / confidences.length;
  
  // Calculate variance in response lengths
  const lengths = outputs.map(o => o.answer.length + o.reasoning.length);
  const meanLength = lengths.reduce((sum, l) => sum + l, 0) / lengths.length;
  const lengthVariance = lengths.reduce((sum, l) => sum + Math.pow(l - meanLength, 2), 0) / lengths.length;
  
  // Normalize variance scores (0-1 range)
  const confidenceDiversity = Math.min(variance * 4, 1); // Scale variance to 0-1
  const lengthDiversity = Math.min(lengthVariance / 10000, 1); // Scale length variance
  
  // Check keyword diversity
  const allKeywords = new Set<string>();
  outputs.forEach(o => {
    const keywords = extractKeywords(o.answer + " " + o.reasoning);
    keywords.forEach(k => allKeywords.add(k));
  });
  
  const keywordDiversity = Math.min(allKeywords.size / (outputs.length * 10), 1);
  
  return (confidenceDiversity + lengthDiversity + keywordDiversity) / 3;
}

/**
 * Calculate quality score based on response characteristics.
 */
function calculateQuality(outputs: AgentOutput[]): number {
  let totalQuality = 0;
  
  for (const output of outputs) {
    let quality = 0;
    
    // Answer quality (length, completeness)
    const answerLength = output.answer.length;
    if (answerLength > 50 && answerLength < 1000) {
      quality += 0.3;
    } else if (answerLength >= 1000) {
      quality += 0.2; // Penalize overly long answers
    }
    
    // Reasoning quality
    const reasoningLength = output.reasoning.length;
    if (reasoningLength > 100 && reasoningLength < 2000) {
      quality += 0.3;
    } else if (reasoningLength >= 2000) {
      quality += 0.2;
    }
    
    // Key points quality
    if (output.key_points.length >= 2 && output.key_points.length <= 5) {
      quality += 0.2;
    }
    
    // Confidence appropriateness
    if (output.confidence >= 0.3 && output.confidence <= 0.9) {
      quality += 0.2;
    }
    
    totalQuality += quality;
  }
  
  return outputs.length > 0 ? totalQuality / outputs.length : 0;
}

/**
 * Calculate efficiency score based on token usage.
 */
function calculateEfficiency(totalTokens: number, agentCount: number, duration: number): number {
  // Tokens per agent
  const tokensPerAgent = totalTokens / agentCount;
  
  // Time efficiency (faster is better, but not too fast)
  const optimalDuration = agentCount * 10000; // 10 seconds per agent
  const timeEfficiency = Math.max(0, 1 - Math.abs(duration - optimalDuration) / optimalDuration);
  
  // Token efficiency (lower is better, but need minimum tokens)
  const optimalTokensPerAgent = 1000;
  const tokenEfficiency = Math.max(0, 1 - Math.abs(tokensPerAgent - optimalTokensPerAgent) / optimalTokensPerAgent);
  
  return (timeEfficiency + tokenEfficiency) / 2;
}

/**
 * Extract keywords from text for diversity analysis.
 */
function extractKeywords(text: string): string[] {
  const words = text.toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 3)
    .filter(word => !isStopWord(word));
  
  return [...new Set(words)].slice(0, 20);
}

function isStopWord(word: string): boolean {
  const stopWords = new Set(['the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been', 'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'can', 'this', 'that', 'these', 'those', 'what', 'which', 'who', 'when', 'where', 'why', 'how', 'not', 'no', 'yes', 'if', 'then', 'else', 'because', 'since', 'until', 'while', 'during', 'before', 'after', 'above', 'below', 'under', 'over', 'between', 'among', 'through', 'against', 'without', 'within', 'upon', 'about', 'along', 'around', 'behind', 'beyond', 'inside', 'outside', 'toward', 'towards', 'into', 'onto', 'off']);
  return stopWords.has(word);
}

/**
 * Generate recommendations based on evaluation criteria.
 */
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

/**
 * Identify strengths based on evaluation criteria.
 */
function identifyStrengths(criteria: EvaluationCriteria): string[] {
  const strengths: string[] = [];
  
  if (criteria.coherence > 0.8) strengths.push("High response coherence");
  if (criteria.consensus > 0.8) strengths.push("Strong consensus building");
  if (criteria.diversity > 0.7) strengths.push("Excellent perspective diversity");
  if (criteria.quality > 0.8) strengths.push("High-quality responses");
  if (criteria.efficiency > 0.8) strengths.push("Optimal resource efficiency");
  
  return strengths;
}

/**
 * Identify weaknesses based on evaluation criteria.
 */
function identifyWeaknesses(criteria: EvaluationCriteria): string[] {
  const weaknesses: string[] = [];
  
  if (criteria.coherence < 0.4) weaknesses.push("Low response coherence");
  if (criteria.consensus < 0.4) weaknesses.push("Poor consensus achievement");
  if (criteria.diversity < 0.3) weaknesses.push("Limited perspective diversity");
  if (criteria.quality < 0.4) weaknesses.push("Low response quality");
  if (criteria.efficiency < 0.4) weaknesses.push("Poor resource efficiency");
  
  return weaknesses;
}

/**
 * Store evaluation result in database.
 */
async function storeEvaluationResult(result: EvaluationResult): Promise<void> {
  try {
    // Store in a dedicated evaluation table (would need to be added to schema)
    await prisma.evaluation.create({
      data: {
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
      }
    });
  } catch (err) {
    logger.error({ err: (err as Error).message }, "Failed to store evaluation result");
  }
}

/**
 * Get evaluation metrics for a user over time.
 */
export async function getUserEvaluationMetrics(userId: number, days: number = 30): Promise<EvaluationMetrics> {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  
  const evaluations = await prisma.evaluation.findMany({
    where: {
      userId,
      timestamp: { gte: startDate }
    },
    orderBy: { timestamp: "asc" }
  });
  
  if (evaluations.length === 0) {
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
  
  const averageConsensus = evaluations.reduce((sum: number, e: { consensus: number }) => sum + e.consensus, 0) / evaluations.length;
  const averageDiversity = evaluations.reduce((sum: number, e: { diversity: number }) => sum + e.diversity, 0) / evaluations.length;
  const averageQuality = evaluations.reduce((sum: number, e: { quality: number }) => sum + e.quality, 0) / evaluations.length;
  const averageEfficiency = evaluations.reduce((sum: number, e: { efficiency: number }) => sum + e.efficiency, 0) / evaluations.length;
  
  // Calculate improvement trend (compare first half vs second half)
  const midpoint = Math.floor(evaluations.length / 2);
  const firstHalf = evaluations.slice(0, midpoint);
  const secondHalf = evaluations.slice(midpoint);
  
  const firstHalfAvg = firstHalf.length > 0 ? firstHalf.reduce((sum: number, e: { overallScore: number }) => sum + e.overallScore, 0) / firstHalf.length : 0;
  const secondHalfAvg = secondHalf.length > 0 ? secondHalf.reduce((sum: number, e: { overallScore: number }) => sum + e.overallScore, 0) / secondHalf.length : 0;
  
  const improvementTrend = secondHalfAvg - firstHalfAvg;
  
  return {
    averageConsensus,
    averageDiversity,
    averageQuality,
    averageEfficiency,
    totalEvaluations: evaluations.length,
    improvementTrend,
    userSatisfaction: 0 // Would be calculated from user feedback
  };
}

/**
 * Benchmark council performance against standards.
 */
export async function benchmarkCouncilPerformance(
  userId: number,
  councilSize: number,
  queryComplexity: 'simple' | 'moderate' | 'complex'
): Promise<{
  userScore: number;
  benchmarkScore: number;
  percentile: number;
  ranking: 'excellent' | 'good' | 'average' | 'below_average';
}> {
  const metrics = await getUserEvaluationMetrics(userId);
  
  // Get benchmark data for similar councils
  const benchmarks = await prisma.evaluation.aggregate({
    where: {
      timestamp: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
    },
    _avg: {
      overallScore: true
    },
    _count: true
  });
  
  const userScore = metrics.averageConsensus * 25 + metrics.averageQuality * 25 + metrics.averageDiversity * 25 + metrics.averageEfficiency * 25;
  const benchmarkScore = (benchmarks._avg.overallScore || 0) * 100;
  
  // Calculate percentile (simplified)
  const percentile = Math.max(0, Math.min(100, (userScore / benchmarkScore) * 100));
  
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
