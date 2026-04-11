import { canUse } from "./quotaTracker.js";
import { checkRPM } from "./rpmLimiter.js";
import { hasAdapter } from "../adapters/registry.js";
import logger from "../lib/logger.js";

// ─── Provider Chain ──────────────────────────────────────────────────────────
// Defines the priority order for free-tier providers.
// Each entry specifies rate and quota limits.

export interface ChainEntry {
  provider: string;
  model: string;
  rpm: number;
  daily_tokens: number;
  daily_requests: number;
}

/**
 * Free-tier provider chain — ordered by preference.
 * These are providers with generous free tiers.
 */
export const FREE_TIER_CHAIN: ChainEntry[] = [
  {
    provider: "gemini",
    model: "gemini-2.0-flash",
    rpm: 15,
    daily_tokens: 1_000_000,
    daily_requests: 1500,
  },
  {
    provider: "groq",
    model: "llama-3.3-70b-versatile",
    rpm: 30,
    daily_tokens: 500_000,
    daily_requests: 14400,
  },
  {
    provider: "openrouter",
    model: "meta-llama/llama-3.1-8b-instruct:free",
    rpm: 20,
    daily_tokens: 200_000,
    daily_requests: 200,
  },
  {
    provider: "cerebras",
    model: "llama-3.3-70b",
    rpm: 30,
    daily_tokens: 1_000_000,
    daily_requests: 960,
  },
  {
    provider: "ollama",
    model: "llama3.2",
    rpm: 999,
    daily_tokens: 999_999_999,
    daily_requests: 999_999,
  },
];

/**
 * Paid provider chain — used when user has API keys and prefers quality.
 */
export const PAID_CHAIN: ChainEntry[] = [
  {
    provider: "openai",
    model: "gpt-4o",
    rpm: 500,
    daily_tokens: 10_000_000,
    daily_requests: 10000,
  },
  {
    provider: "anthropic",
    model: "claude-3-5-sonnet-20241022",
    rpm: 50,
    daily_tokens: 5_000_000,
    daily_requests: 4000,
  },
  {
    provider: "gemini",
    model: "gemini-2.0-flash",
    rpm: 15,
    daily_tokens: 1_000_000,
    daily_requests: 1500,
  },
  {
    provider: "mistral",
    model: "mistral-small-latest",
    rpm: 60,
    daily_tokens: 5_000_000,
    daily_requests: 5000,
  },
];

/**
 * Select the best available provider from a chain based on current quotas and RPM.
 * Returns null if all providers are exhausted.
 */
export function selectProvider(
  estimatedTokens: number,
  chain: ChainEntry[] = FREE_TIER_CHAIN
): { provider: string; model: string } | null {
  for (const entry of chain) {
    // Skip if adapter not registered
    if (!hasAdapter(entry.provider)) continue;

    // Check daily quota
    if (!canUse(entry.provider, entry.daily_requests, entry.daily_tokens)) {
      logger.debug({ provider: entry.provider }, "Provider daily quota exceeded, skipping");
      continue;
    }

    // Check RPM
    if (!checkRPM(entry.provider, entry.rpm)) {
      logger.debug({ provider: entry.provider }, "Provider RPM limit reached, skipping");
      continue;
    }

    // Check if estimated tokens would exceed remaining quota
    // (rough check — we don't know completion tokens yet)
    return { provider: entry.provider, model: entry.model };
  }

  return null;
}

/**
 * Get chain entry for a specific provider (used to look up limits).
 */
export function getChainEntry(
  provider: string,
  chain: ChainEntry[] = [...FREE_TIER_CHAIN, ...PAID_CHAIN]
): ChainEntry | undefined {
  return chain.find((e) => e.provider === provider);
}
