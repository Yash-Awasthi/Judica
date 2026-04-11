import logger from "../lib/logger.js";

// ─── Quota Tracker ───────────────────────────────────────────────────────────
// Track per-provider per-day usage. In-memory for now, can be backed by Redis.

interface QuotaEntry {
  requests_used: number;
  tokens_used: number;
  last_reset: number; // epoch ms of midnight UTC
}

export interface QuotaStatus {
  requests_used: number;
  tokens_used: number;
  requests_remaining: number;
  tokens_remaining: number;
}

const quotas = new Map<string, QuotaEntry>();

function getTodayMidnight(): number {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

function getOrReset(provider: string): QuotaEntry {
  const midnight = getTodayMidnight();
  const entry = quotas.get(provider);

  if (!entry || entry.last_reset < midnight) {
    const fresh: QuotaEntry = { requests_used: 0, tokens_used: 0, last_reset: midnight };
    quotas.set(provider, fresh);
    return fresh;
  }

  return entry;
}

export function canUse(
  provider: string,
  maxDailyRequests = Infinity,
  maxDailyTokens = Infinity
): boolean {
  const entry = getOrReset(provider);
  return entry.requests_used < maxDailyRequests && entry.tokens_used < maxDailyTokens;
}

export function recordUsage(provider: string, tokens: number): void {
  const entry = getOrReset(provider);
  entry.requests_used++;
  entry.tokens_used += tokens;
}

export function getRemainingQuota(
  provider: string,
  maxDailyRequests = Infinity,
  maxDailyTokens = Infinity
): QuotaStatus {
  const entry = getOrReset(provider);
  return {
    requests_used: entry.requests_used,
    tokens_used: entry.tokens_used,
    requests_remaining: Math.max(0, maxDailyRequests - entry.requests_used),
    tokens_remaining: Math.max(0, maxDailyTokens - entry.tokens_used),
  };
}

export function resetQuota(provider: string): void {
  quotas.delete(provider);
}

export function getAllQuotas(): Record<string, QuotaEntry> {
  const result: Record<string, QuotaEntry> = {};
  for (const [k, v] of quotas) {
    result[k] = { ...v };
  }
  return result;
}
