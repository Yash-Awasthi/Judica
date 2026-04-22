// P2-22: Cost/usage logic is scattered across 5 places:
// 1. lib/cost.ts (this file) — cost calculation
// 2. lib/realtimeCost.ts — per-session cost tracking
// 3. services/usageService.ts — daily usage recording
// 4. routes/costs.ts — cost API endpoint
// 5. routes/usage.ts — usage API endpoint
// Future: consolidate into services/usage.service.ts as single source of truth.
import { db } from "./drizzle.js";
import { eq, and, gte, sql } from "drizzle-orm";
import { dailyUsage } from "../db/schema/users.js";
import logger from "./logger.js";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

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

// P9-65: Externalized pricing table — loaded from config/pricing.json if available,
// falling back to compiled defaults. Update pricing without redeploying by editing the JSON file.
const PRICING_CONFIG_PATH = resolve(process.cwd(), "config/pricing.json");

function loadPricingConfig(): CostConfig[] {
  try {
    if (existsSync(PRICING_CONFIG_PATH)) {
      const raw = readFileSync(PRICING_CONFIG_PATH, "utf-8");
      const parsed = JSON.parse(raw) as CostConfig[];
      logger.info({ count: parsed.length, path: PRICING_CONFIG_PATH }, "Loaded external pricing config");
      return parsed;
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "Failed to load external pricing config — using defaults");
  }
  return BUILTIN_COST_CONFIG;
}

const BUILTIN_COST_CONFIG: CostConfig[] = [
  // OpenAI — current models (prices per 1K tokens)
  { provider: "openai", model: "gpt-4o", inputTokenPrice: 0.0025, outputTokenPrice: 0.01, currency: "USD" },
  { provider: "openai", model: "gpt-4o-2024-11-20", inputTokenPrice: 0.0025, outputTokenPrice: 0.01, currency: "USD" },
  { provider: "openai", model: "gpt-4o-mini", inputTokenPrice: 0.00015, outputTokenPrice: 0.0006, currency: "USD" },
  { provider: "openai", model: "gpt-4-turbo", inputTokenPrice: 0.01, outputTokenPrice: 0.03, currency: "USD" },
  { provider: "openai", model: "o1", inputTokenPrice: 0.015, outputTokenPrice: 0.06, currency: "USD" },
  { provider: "openai", model: "o1-mini", inputTokenPrice: 0.003, outputTokenPrice: 0.012, currency: "USD" },
  { provider: "openai", model: "o1-pro", inputTokenPrice: 0.15, outputTokenPrice: 0.6, currency: "USD" },
  { provider: "openai", model: "o3", inputTokenPrice: 0.01, outputTokenPrice: 0.04, currency: "USD" },
  { provider: "openai", model: "o3-mini", inputTokenPrice: 0.0011, outputTokenPrice: 0.0044, currency: "USD" },
  { provider: "openai", model: "o4-mini", inputTokenPrice: 0.0011, outputTokenPrice: 0.0044, currency: "USD" },
  { provider: "openai", model: "gpt-4.1", inputTokenPrice: 0.002, outputTokenPrice: 0.008, currency: "USD" },
  { provider: "openai", model: "gpt-4.1-mini", inputTokenPrice: 0.0004, outputTokenPrice: 0.0016, currency: "USD" },
  { provider: "openai", model: "gpt-4.1-nano", inputTokenPrice: 0.0001, outputTokenPrice: 0.0004, currency: "USD" },

  // Anthropic — current models
  { provider: "anthropic", model: "claude-opus-4-20250514", inputTokenPrice: 0.015, outputTokenPrice: 0.075, currency: "USD" },
  { provider: "anthropic", model: "claude-sonnet-4-20250514", inputTokenPrice: 0.003, outputTokenPrice: 0.015, currency: "USD" },
  { provider: "anthropic", model: "claude-3-7-sonnet-20250219", inputTokenPrice: 0.003, outputTokenPrice: 0.015, currency: "USD" },
  { provider: "anthropic", model: "claude-3-5-sonnet-20241022", inputTokenPrice: 0.003, outputTokenPrice: 0.015, currency: "USD" },
  { provider: "anthropic", model: "claude-3-5-haiku-20241022", inputTokenPrice: 0.0008, outputTokenPrice: 0.004, currency: "USD" },
  { provider: "anthropic", model: "claude-3-opus-20240229", inputTokenPrice: 0.015, outputTokenPrice: 0.075, currency: "USD" },
  { provider: "anthropic", model: "claude-3-haiku-20240307", inputTokenPrice: 0.00025, outputTokenPrice: 0.00125, currency: "USD" },

  // Google — current models
  { provider: "google", model: "gemini-2.5-pro-preview-05-06", inputTokenPrice: 0.00125, outputTokenPrice: 0.01, currency: "USD" },
  { provider: "google", model: "gemini-2.5-flash-preview-04-17", inputTokenPrice: 0.00015, outputTokenPrice: 0.0006, currency: "USD" },
  { provider: "google", model: "gemini-2.0-flash", inputTokenPrice: 0.0001, outputTokenPrice: 0.0004, currency: "USD" },
  { provider: "google", model: "gemini-2.0-flash-lite", inputTokenPrice: 0.000075, outputTokenPrice: 0.0003, currency: "USD" },
  { provider: "google", model: "gemini-1.5-pro", inputTokenPrice: 0.00125, outputTokenPrice: 0.005, currency: "USD" },
  { provider: "google", model: "gemini-1.5-flash", inputTokenPrice: 0.000075, outputTokenPrice: 0.0003, currency: "USD" },

  // Meta (via Groq / OpenRouter)
  { provider: "groq", model: "llama-3.3-70b-versatile", inputTokenPrice: 0.00059, outputTokenPrice: 0.00079, currency: "USD" },
  { provider: "groq", model: "llama-3.1-8b-instant", inputTokenPrice: 0.00005, outputTokenPrice: 0.00008, currency: "USD" },
  { provider: "groq", model: "llama-4-scout-17b-16e-instruct", inputTokenPrice: 0.00011, outputTokenPrice: 0.00034, currency: "USD" },
  { provider: "groq", model: "llama-4-maverick-17b-128e-instruct", inputTokenPrice: 0.0005, outputTokenPrice: 0.00077, currency: "USD" },

  // DeepSeek (via OpenRouter)
  { provider: "openrouter", model: "deepseek/deepseek-chat-v3-0324", inputTokenPrice: 0.00014, outputTokenPrice: 0.00028, currency: "USD" },
  { provider: "openrouter", model: "deepseek/deepseek-reasoner", inputTokenPrice: 0.00055, outputTokenPrice: 0.00219, currency: "USD" },

  // Mistral (via OpenRouter)
  { provider: "openrouter", model: "mistral/mistral-large-latest", inputTokenPrice: 0.002, outputTokenPrice: 0.006, currency: "USD" },
  { provider: "openrouter", model: "mistral/mistral-small-2501", inputTokenPrice: 0.0001, outputTokenPrice: 0.0003, currency: "USD" },
];

// P9-65: Load from external config file, fall back to built-in defaults
export const DEFAULT_COST_CONFIG: CostConfig[] = loadPricingConfig();

export function calculateCost(
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
  customConfig?: CostConfig[]
): number {
  // P29-09: Non-negative guard on token counts
  inputTokens = Number.isFinite(inputTokens) && inputTokens > 0 ? inputTokens : 0;
  outputTokens = Number.isFinite(outputTokens) && outputTokens > 0 ? outputTokens : 0;

  const config = customConfig || DEFAULT_COST_CONFIG;
  const pricing = config.find(c => c.provider === provider && c.model === model);

  if (!pricing) {
    // P9-69: Unknown model — use conservative estimate based on pricing table median
    // instead of near-zero fallback that lets usage go unaccounted.
    logger.warn({ provider, model }, "No pricing config found — using conservative estimate");
    // Use median of known models' prices as a reasonable upper bound
    const sorted = [...config].sort((a, b) =>
      (a.inputTokenPrice + a.outputTokenPrice) - (b.inputTokenPrice + b.outputTokenPrice)
    );
    const median = sorted[Math.floor(sorted.length / 2)];
    if (median) {
      return (inputTokens * median.inputTokenPrice + outputTokens * median.outputTokenPrice) / 1000;
    }
    return (inputTokens * 0.003 + outputTokens * 0.015) / 1000; // fallback to mid-tier pricing
  }

  const inputCost = (inputTokens * pricing.inputTokenPrice) / 1000;
  const outputCost = (outputTokens * pricing.outputTokenPrice) / 1000;

  return inputCost + outputCost;
}

// P9-67: Cost is persisted via dailyUsage table (aggregated per user per day).
// Individual request costs are logged but not stored in a per-request ledger.
// TODO: Add a `usage_ledger` table for per-request cost records if audit trail needed.
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
    today.setUTCHours(0, 0, 0, 0);

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

// P9-68: Note — byProvider and byModel are not populated here because dailyUsage
// table stores only aggregate tokens/requests per day (no provider/model breakdown).
// These fields exist for future use when per-request ledger (P9-67) is implemented.
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

// P9-66: Use actual weighted average from pricing table instead of a magic constant.
// This tracks closer to real costs as the model mix changes.
function estimateCostFromTokens(tokens: number): number {
  if (DEFAULT_COST_CONFIG.length === 0) {
    return tokens * 0.00002; // fallback: ~$0.02 per 1K tokens
  }
  // Weighted average across all models (assumes ~60% input, 40% output distribution)
  const avgPricePerToken = DEFAULT_COST_CONFIG.reduce((sum, c) => {
    return sum + (c.inputTokenPrice * 0.6 + c.outputTokenPrice * 0.4);
  }, 0) / DEFAULT_COST_CONFIG.length / 1000;
  return tokens * avgPricePerToken;
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
  today.setUTCHours(0, 0, 0, 0);
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

  // P9-70: Fixed efficiency formula — clamp to [0, 100] range.
  // Lower cost per request = better efficiency.
  // Score inversely proportional to cost, normalized to $1 as "expensive".
  const costScore = Math.max(0, Math.min(100, 100 * (1 - Math.min(avgCostPerRequest, 1))));
  // Token efficiency: penalize excessive token usage (>10K tokens/request is wasteful)
  const tokenScore = Math.max(0, Math.min(100, 100 * (1 - Math.min(avgTokensPerRequest / 10000, 1))));

  const costEfficiencyScore = Math.round((costScore * 0.6 + tokenScore * 0.4));

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
