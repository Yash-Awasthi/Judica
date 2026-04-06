import prisma from "./db.js";
import logger from "./logger.js";

export interface CostConfig {
  provider: string;
  model: string;
  inputTokenPrice: number; // per 1K tokens
  outputTokenPrice: number; // per 1K tokens
  currency: string;
}

export interface TokenUsage {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number;
  timestamp: Date;
}

export interface CostBreakdown {
  totalCost: number;
  totalTokens: number;
  byProvider: Record<string, { cost: number; tokens: number; requests: number }>;
  byModel: Record<string, { cost: number; tokens: number; requests: number }>;
  byTimeframe: Record<string, { cost: number; tokens: number; requests: number }>;
}

export const DEFAULT_COST_CONFIG: CostConfig[] = [
  { provider: "openai", model: "gpt-4", inputTokenPrice: 0.03, outputTokenPrice: 0.06, currency: "USD" },
  { provider: "openai", model: "gpt-4-turbo", inputTokenPrice: 0.01, outputTokenPrice: 0.03, currency: "USD" },
  { provider: "openai", model: "gpt-3.5-turbo", inputTokenPrice: 0.0015, outputTokenPrice: 0.002, currency: "USD" },
  
  { provider: "anthropic", model: "claude-3-opus", inputTokenPrice: 0.015, outputTokenPrice: 0.075, currency: "USD" },
  { provider: "anthropic", model: "claude-3-sonnet", inputTokenPrice: 0.003, outputTokenPrice: 0.015, currency: "USD" },
  { provider: "anthropic", model: "claude-3-haiku", inputTokenPrice: 0.00025, outputTokenPrice: 0.00125, currency: "USD" },
  
  { provider: "google", model: "gemini-pro", inputTokenPrice: 0.0005, outputTokenPrice: 0.0015, currency: "USD" },
  { provider: "google", model: "gemini-pro-vision", inputTokenPrice: 0.0025, outputTokenPrice: 0.0075, currency: "USD" },
];

export function calculateCost(
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
  customConfig?: CostConfig[]
): number {
  const config = customConfig || DEFAULT_COST_CONFIG;
  const pricing = config.find(c => c.provider === provider && c.model === model);
  
  if (!pricing) {
    logger.warn({ provider, model }, "No pricing config found, using default rates");
    return (inputTokens * 0.001 + outputTokens * 0.002) / 1000;
  }
  
  const inputCost = (inputTokens * pricing.inputTokenPrice) / 1000;
  const outputCost = (outputTokens * pricing.outputTokenPrice) / 1000;
  
  return inputCost + outputCost;
}

export async function trackTokenUsage(
  userId: number,
  conversationId: string,
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
  requestType: string = "deliberation"
): Promise<void> {
  try {
    const totalTokens = inputTokens + outputTokens;
    const cost = calculateCost(provider, model, inputTokens, outputTokens);
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    await prisma.dailyUsage.upsert({
      where: {
        userId_date: {
          userId,
          date: today
        }
      },
      update: {
        requests: { increment: 1 },
        tokens: { increment: totalTokens }
      },
      create: {
        userId,
        date: today,
        requests: 1,
        tokens: totalTokens
      }
    });
    
    logger.info({
      userId,
      conversationId,
      provider,
      model,
      inputTokens,
      outputTokens,
      totalTokens,
      cost,
      requestType
    }, "Token usage tracked");
    
  } catch (err) {
    logger.error({ err: (err as Error).message, userId }, "Failed to track token usage");
  }
}

export async function getUserCostBreakdown(
  userId: number,
  days: number = 30
): Promise<CostBreakdown> {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  
  const usage = await prisma.dailyUsage.findMany({
    where: {
      userId,
      date: { gte: startDate }
    },
    orderBy: { date: "asc" }
  });
  
  const breakdown: CostBreakdown = {
    totalCost: 0,
    totalTokens: 0,
    byProvider: {},
    byModel: {},
    byTimeframe: {}
  };
  
  for (const record of usage) {
    const dateKey = record.date.toISOString().split('T')[0];
    
    const estimatedCost = estimateCostFromTokens(record.tokens);
    
    breakdown.totalCost += estimatedCost;
    breakdown.totalTokens += record.tokens;
    
    if (!breakdown.byTimeframe[dateKey]) {
      breakdown.byTimeframe[dateKey] = { cost: 0, tokens: 0, requests: 0 };
    }
    breakdown.byTimeframe[dateKey].cost += estimatedCost;
    breakdown.byTimeframe[dateKey].tokens += record.tokens;
    breakdown.byTimeframe[dateKey].requests += record.requests;
  }
  
  return breakdown;
}

function estimateCostFromTokens(tokens: number): number {
  const avgCostPerToken = 0.00002; // ~$0.02 per 1K tokens
  return tokens * avgCostPerToken;
}

export async function getOrganizationCostSummary(days: number = 30): Promise<{
  totalCost: number;
  totalTokens: number;
  totalRequests: number;
  userBreakdown: Array<{ userId: number; cost: number; tokens: number; requests: number }>;
  dailyTrend: Array<{ date: string; cost: number; tokens: number; requests: number }>;
}> {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  
  const usage = await prisma.dailyUsage.findMany({
    where: {
      date: { gte: startDate }
    },
    include: {
      user: {
        select: { id: true }
      }
    },
    orderBy: { date: "asc" }
  });
  
  const userBreakdown = new Map<number, { cost: number; tokens: number; requests: number }>();
  const dailyTrend = new Map<string, { cost: number; tokens: number; requests: number }>();
  
  let totalCost = 0;
  let totalTokens = 0;
  let totalRequests = 0;
  
  for (const record of usage) {
    const estimatedCost = estimateCostFromTokens(record.tokens);
    const dateKey = record.date.toISOString().split('T')[0];
    
    totalCost += estimatedCost;
    totalTokens += record.tokens;
    totalRequests += record.requests;
    
    const current = userBreakdown.get(record.userId) || { cost: 0, tokens: 0, requests: 0 };
    userBreakdown.set(record.userId, {
      cost: current.cost + estimatedCost,
      tokens: current.tokens + record.tokens,
      requests: current.requests + record.requests
    });
    
    const daily = dailyTrend.get(dateKey) || { cost: 0, tokens: 0, requests: 0 };
    dailyTrend.set(dateKey, {
      cost: daily.cost + estimatedCost,
      tokens: daily.tokens + record.tokens,
      requests: daily.requests + record.requests
    });
  }
  
  return {
    totalCost,
    totalTokens,
    totalRequests,
    userBreakdown: Array.from(userBreakdown.entries()).map(([userId, data]) => ({ userId, ...data })),
    dailyTrend: Array.from(dailyTrend.entries()).map(([date, data]) => ({ date, ...data }))
  };
}

export async function checkUserCostLimits(
  userId: number,
  dailyLimit?: number,
  monthlyLimit?: number
): Promise<{ withinLimits: boolean; dailyUsage: number; monthlyUsage: number; warnings: string[] }> {
  const now = new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  
  const [daily, monthly] = await Promise.all([
    prisma.dailyUsage.findFirst({
      where: { userId, date: today }
    }),
    prisma.dailyUsage.aggregate({
      where: {
        userId,
        date: { gte: monthStart }
      },
      _sum: {
        tokens: true,
        requests: true
      }
    })
  ]);
  
  const dailyTokens = daily?.tokens || 0;
  const monthlyTokens = monthly._sum.tokens || 0;
  
  const dailyCost = estimateCostFromTokens(dailyTokens);
  const monthlyCost = estimateCostFromTokens(monthlyTokens);
  
  const warnings: string[] = [];
  
  if (dailyLimit && dailyCost > dailyLimit * 0.8) {
    warnings.push(`Approaching daily cost limit: $${dailyCost.toFixed(2)} / $${dailyLimit}`);
  }
  
  if (monthlyLimit && monthlyCost > monthlyLimit * 0.8) {
    warnings.push(`Approaching monthly cost limit: $${monthlyCost.toFixed(2)} / $${monthlyLimit}`);
  }
  
  const withinLimits = 
    (!dailyLimit || dailyCost <= dailyLimit) &&
    (!monthlyLimit || monthlyCost <= monthlyLimit);
  
  return {
    withinLimits,
    dailyUsage: dailyCost,
    monthlyUsage: monthlyCost,
    warnings
  };
}

export async function getCostEfficiencyMetrics(userId: number, days: number = 30): Promise<{
  avgCostPerRequest: number;
  avgTokensPerRequest: number;
  costEfficiencyScore: number; // 0-100, higher is better
  recommendations: string[];
}> {
  const breakdown = await getUserCostBreakdown(userId, days);
  const dailyUsage = await prisma.dailyUsage.findMany({
    where: {
      userId,
      date: { gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000) }
    }
  });
  
  const totalRequests = dailyUsage.reduce((sum, day) => sum + day.requests, 0);
  
  if (totalRequests === 0) {
    return {
      avgCostPerRequest: 0,
      avgTokensPerRequest: 0,
      costEfficiencyScore: 100,
      recommendations: ["Start using the council to see efficiency metrics"]
    };
  }
  
  const avgCostPerRequest = breakdown.totalCost / totalRequests;
  const avgTokensPerRequest = breakdown.totalTokens / totalRequests;
  
  const costScore = Math.max(0, 100 - (avgCostPerRequest * 100)); // Penalize high cost
  const tokenScore = Math.min(100, (avgTokensPerRequest / 1000) * 10); // Reward reasonable token usage
  
  const costEfficiencyScore = (costScore + tokenScore) / 2;
  
  const recommendations: string[] = [];
  
  if (avgCostPerRequest > 0.50) {
    recommendations.push("Consider using more cost-effective models for simple queries");
  }
  
  if (avgTokensPerRequest > 5000) {
    recommendations.push("Optimize prompts to reduce token usage");
  }
  
  if (costEfficiencyScore > 80) {
    recommendations.push("Excellent cost efficiency maintained");
  }
  
  return {
    avgCostPerRequest,
    avgTokensPerRequest,
    costEfficiencyScore,
    recommendations
  };
}
