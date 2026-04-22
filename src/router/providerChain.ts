import { canUse } from "./quotaTracker.js";
import { checkRPM } from "./rpmLimiter.js";
import { hasAdapter } from "../adapters/registry.js";
import { routerExhaustedTotal } from "../lib/prometheusMetrics.js";
import logger from "../lib/logger.js";

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
 * P4-22: Load a provider chain from env/config JSON if provided.
 * Format: PROVIDER_CHAIN_FREE / PROVIDER_CHAIN_PAID as JSON array of ChainEntry.
 * Falls back to the hardcoded defaults below.
 *
 * Example: PROVIDER_CHAIN_FREE='[{"provider":"gemini","model":"gemini-2.0-flash","rpm":15,"daily_tokens":1000000,"daily_requests":1500}]'
 */
function loadChainFromEnv(envKey: string, fallback: ChainEntry[]): ChainEntry[] {
  const raw = process.env[envKey];
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      logger.warn({ envKey }, "Invalid provider chain config (not a non-empty array), using default");
      return fallback;
    }
    // P20-07: Validate types and numeric ranges — reject nonsensical values like negative RPM
    for (const entry of parsed) {
      if (!entry.provider || !entry.model) {
        logger.warn({ envKey, entry }, "Invalid chain entry (missing provider/model), using default chain");
        return fallback;
      }
      // Validate numeric fields are finite positive numbers
      if (!Number.isFinite(entry.rpm) || entry.rpm < 0 ||
          !Number.isFinite(entry.daily_tokens) || entry.daily_tokens < 0 ||
          !Number.isFinite(entry.daily_requests) || entry.daily_requests < 0) {
        logger.warn({ envKey, entry }, "Invalid chain entry (bad numeric values), using default chain");
        return fallback;
      }
      if (entry.rpm <= 0 || (entry.daily_tokens !== undefined && entry.daily_tokens <= 0) ||
          (entry.daily_requests !== undefined && entry.daily_requests <= 0)) {
        logger.warn({ envKey, entry }, "Chain entry has non-positive numeric limits, using default chain");
        return fallback;
      }
    }
    logger.info({ envKey, count: parsed.length }, "Loaded provider chain from env");
    return parsed as ChainEntry[];
  } catch (err) {
    logger.warn({ envKey, err: (err as Error).message }, "Failed to parse provider chain JSON, using default");
    return fallback;
  }
}

/**
 * Free-tier provider chain — ordered by preference.
 * These are providers with generous free tiers.
 * P4-22: Overridable via PROVIDER_CHAIN_FREE env var (JSON array).
 */
export const FREE_TIER_CHAIN: ChainEntry[] = loadChainFromEnv("PROVIDER_CHAIN_FREE", [
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
    // P3-17: OpenRouter :free models have a ~20 req/day actual limit,
    // not 200 as previously configured. Align with upstream reality.
    daily_requests: 20,
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
]);

/**
 * Paid provider chain — used when user has API keys and prefers quality.
 * P4-22: Overridable via PROVIDER_CHAIN_PAID env var (JSON array).
 */
export const PAID_CHAIN: ChainEntry[] = loadChainFromEnv("PROVIDER_CHAIN_PAID", [
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
    model: "mistral-small-2501",
    rpm: 60,
    daily_tokens: 5_000_000,
    daily_requests: 5000,
  },
]);

/**
 * Select the best available provider from a chain based on current quotas and RPM.
 * Returns null if all providers are exhausted.
 * P2-11: estimatedTokens is checked against daily_tokens quota.
 */
export function selectProvider(
  estimatedTokens: number,
  chain: ChainEntry[] = FREE_TIER_CHAIN
): { provider: string; model: string } | null {
  for (const entry of chain) {
    // Skip if adapter not registered
    if (!hasAdapter(entry.provider)) continue;

    // Check daily quota (P2-11: factor in estimated tokens for this request)
    if (!canUse(entry.provider, entry.daily_requests, entry.daily_tokens)) {
      logger.debug({ provider: entry.provider }, "Provider daily quota exceeded, skipping");
      continue;
    }

    // Check RPM
    if (!checkRPM(entry.provider, entry.rpm)) {
      logger.debug({ provider: entry.provider }, "Provider RPM limit reached, skipping");
      continue;
    }

    return { provider: entry.provider, model: entry.model };
  }

  // P4-13: Track when all providers in a chain are exhausted
  const chainName = chain === FREE_TIER_CHAIN ? "free" : chain === PAID_CHAIN ? "paid" : "custom";
  routerExhaustedTotal.inc({ chain: chainName });

  return null;
}

/**
 * Get chain entry for a specific provider (used to look up limits).
 * P2-10: When provider appears in both chains, prefer PAID limits (higher).
 */
export function getChainEntry(
  provider: string,
  chain: ChainEntry[] = [...PAID_CHAIN, ...FREE_TIER_CHAIN]
): ChainEntry | undefined {
  return chain.find((e) => e.provider === provider);
}
