import { db } from "./drizzle.js";
import { eq, and, gte, sql } from "drizzle-orm";
import { dailyUsage } from "../db/schema/users.js";
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
  // OpenAI — current models (prices per 1K tokens)
  { provider: "openai", model: "gpt-4o", inputTokenPrice: 0.0025, outputTokenPrice: 0.01, currency: "USD" },
  { provider: "openai", model: "gpt-4o-mini", inputTokenPrice: 0.00015, outputTokenPrice: 0.0006, currency: "USD" },
  { provider: "openai", model: "gpt-4-turbo", inputTokenPrice: 0.01, outputTokenPrice: 0.03, currency: "USD" },
  { provider: "openai", model: "o1", inputTokenPrice: 0.015, outputTokenPrice: 0.06, currency: "USD" },
  { provider: "openai", model: "o1-mini", inputTokenPrice: 0.003, outputTokenPrice: 0.012, currency: "USD" },
  { provider: "openai", model: "o3-mini", inputTokenPrice: 0.0011, outputTokenPrice: 0.0044, currency: "USD" },

  // Anthropic — current models
  { provider: "anthropic", model: "claude-opus-4-20250514", inputTokenPrice: 0.015, outputTokenPrice: 0.075, currency: "USD" },
  { provider: "anthropic", model: "claude-sonnet-4-20250514", inputTokenPrice: 0.003, outputTokenPrice: 0.015, currency: "USD" },
  { provider: "anthropic", model: "claude-3-5-sonnet-20241022", inputTokenPrice: 0.003, outputTokenPrice: 0.015, currency: "USD" },
  { provider: "anthropic", model: "claude-3-5-haiku-20241022", inputTokenPrice: 0.0008, outputTokenPrice: 0.004, currency: "USD" },
  { provider: "anthropic", model: "claude-3-opus-20240229", inputTokenPrice: 0.015, outputTokenPrice: 0.075, currency: "USD" },
  { provider: "anthropic", model: "claude-3-haiku-20240307", inputTokenPrice: 0.00025, outputTokenPrice: 0.00125, currency: "USD" },

  // Google — current models
  { provider: "google", model: "gemini-2.0-flash", inputTokenPrice: 0.0001, outputTokenPrice: 0.0004, currency: "USD" },
  { provider: "google", model: "gemini-2.0-flash-lite", inputTokenPrice: 0.000075, outputTokenPrice: 0.0003, currency: "USD" },
  { provider: "google", model: "gemini-1.5-pro", inputTokenPrice: 0.00125, outputTokenPrice: 0.005, currency: "USD" },
  { provider: "google", model: "gemini-1.5-flash", inputTokenPrice: 0.000075, outputTokenPrice: 0.0003, currency: "USD" },

  // Meta (via Groq / OpenRouter)
  { provider: "groq", model: "llama-3.3-70b-versatile", inputTokenPrice: 0.00059, outputTokenPrice: 0.00079, currency: "USD" },
  { provider: "groq", model: "llama-3.1-8b-instant", inputTokenPrice: 0.00005, outputTokenPrice: 0.00008, currency: "USD" },

  // Mistral (via OpenRouter)
  { provider: "openrouter", model: "mistral/mistral-large-latest", inputTokenPrice: 0.002, outputTokenPrice: 0.006, currency: "USD" },
  { provider: "openrouter", model: "mistral/mistral-small-latest", inputTokenPrice: 0.0001, outputTokenPrice: 0.0003, currency: "USD" },
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

    await db
      .insert(dailyUsage)
      .values({
        userId,
        date: today,
        requests: 1,
        tokens: totalTokens,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [dailyUsage.userId, dailyUsage.date],
        set: {
          requests: sql`${dailyUsage.requests} + 1`,
          tokens: sql`${dailyUsage.tokens} + ${totalTokens}`,
          updatedAt: new Date(),
        },
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

  const usage = await db
    .select()
    .from(dailyUsage)
    .where(
      and(
        eq(dailyUsage.userId, userId),
        gte(dailyUsage.date, startDate)
      )
    )
    .orderBy(dailyUsage.date);

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

  const usage = await db
    .select()
    .from(dailyUsage)
    .where(gte(dailyUsage.date, startDate))
    .orderBy(dailyUsage.date);

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

  const [dailyRows, monthlyRows] = await Promise.all([
    db
      .select()
      .from(dailyUsage)
      .where(
        and(
          eq(dailyUsage.userId, userId),
          eq(dailyUsage.date, today)
        )
      )
      .limit(1),
    db
      .select({
        totalTokens: sql<number>`coalesce(sum(${dailyUsage.tokens}), 0)`,
        totalRequests: sql<number>`coalesce(sum(${dailyUsage.requests}), 0)`,
      })
      .from(dailyUsage)
      .where(
        and(
          eq(dailyUsage.userId, userId),
          gte(dailyUsage.date, monthStart)
        )
      )
  ]);

  const dailyTokens = dailyRows[0]?.tokens || 0;
  const monthlyTokens = monthlyRows[0]?.totalTokens || 0;

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
  const usage = await db
    .select()
    .from(dailyUsage)
    .where(
      and(
        eq(dailyUsage.userId, userId),
        gte(dailyUsage.date, new Date(Date.now() - days * 24 * 60 * 60 * 1000))
      )
    );

  const totalRequests = usage.reduce((sum, day) => sum + day.requests, 0);

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
