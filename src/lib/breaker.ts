import CircuitBreaker from "opossum";
import logger from "./logger.js";
import type { Provider } from "./providers.js";

/**
 * Circuit breaker utility for provider adapters.
 *
 * STATUS: This module is wired into ALL provider classes:
 * - Adapter layer (OpenAI, Anthropic, Gemini, Groq, Ollama, OpenRouter, Custom)
 *   wraps fetch via `getBreaker(provider, fetchFn).fire()`.
 * - Concrete provider layer (lib/providers/concrete/*) wraps fetch via
 *   `BaseProvider.protectedFetch()` which delegates to getBreaker internally.
 */

// P9-08: TTL-based eviction — breakers unused for 10 minutes are cleaned up
const BREAKER_TTL_MS = 10 * 60 * 1000;
const MAX_BREAKERS = 200; // hard cap to prevent unbounded growth

interface BreakerEntry {
  breaker: CircuitBreaker;
  lastUsed: number;
}

const breakerRegistry = new Map<string, BreakerEntry>();

// P9-08: Periodic cleanup of stale breakers (every 5 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of breakerRegistry) {
    if (now - entry.lastUsed > BREAKER_TTL_MS) {
      entry.breaker.shutdown();
      breakerRegistry.delete(key);
      logger.debug({ key }, "Evicted stale circuit breaker");
    }
  }
}, 5 * 60 * 1000).unref();

const BREAKER_OPTIONS = {
  timeout: 45000,
  errorThresholdPercentage: 50,
  resetTimeout: 30000, // wait 30s before trying again
  // P9-09: Only count 5xx server errors toward the failure threshold.
  // 4xx client errors are not provider failures and should not trip the breaker.
  errorFilter: (err: Error & { statusCode?: number }) => {
    const status = err.statusCode;
    // Return true = DO NOT count as failure (filter it out)
    if (status && status >= 400 && status < 500) return true;
    return false;
  },
};

export function getBreaker<T extends (...args: unknown[]) => Promise<unknown>>(
  provider: Pick<Provider, "name">,
  action: T
): CircuitBreaker<Parameters<T>, ReturnType<T>> {
  const key = `${provider.name}:${action.name}`;

  const existing = breakerRegistry.get(key);
  if (existing) {
    existing.lastUsed = Date.now();
    return wrapBreaker(existing.breaker, provider) as CircuitBreaker<Parameters<T>, ReturnType<T>>;
  }

  // P9-08: Evict oldest entry if at capacity
  if (breakerRegistry.size >= MAX_BREAKERS) {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    for (const [k, entry] of breakerRegistry) {
      if (entry.lastUsed < oldestTime) {
        oldestTime = entry.lastUsed;
        oldestKey = k;
      }
    }
    if (oldestKey) {
      breakerRegistry.get(oldestKey)?.breaker.shutdown();
      breakerRegistry.delete(oldestKey);
    }
  }

  // P9-10: Disable Opossum's built-in timeout — we use external AbortController.
  // Having both active causes the losing timer to dangle.
  const breaker = new CircuitBreaker(action, { ...BREAKER_OPTIONS, timeout: false });

  breaker.fallback(() => {
    throw new Error(`CircuitBreaker opened for ${provider.name} (API potentially down)`);
  });

  breaker.on("open", () => {
    logger.warn({ provider: provider.name, action: action.name }, "Circuit Breaker OPENED - API is failing");
  });

  breaker.on("halfOpen", () => {
    logger.info({ provider: provider.name, action: action.name }, "Circuit Breaker HALF-OPEN - testing recovery");
  });

  breaker.on("close", () => {
    logger.info({ provider: provider.name, action: action.name }, "Circuit Breaker CLOSED - API recovered");
  });

  breakerRegistry.set(key, { breaker, lastUsed: Date.now() });

  return wrapBreaker(breaker, provider) as CircuitBreaker<Parameters<T>, ReturnType<T>>;
}

// P9-11 + P1-11: Runtime guard on fire() return value.
// Override fire() directly on the breaker instance instead of using
// Object.create() prototype chain, which is fragile (mutations leak,
// prototype traversal can expose internal state).  Since each breaker
// is already cached per-key, direct mutation is safe.
function wrapBreaker(breaker: CircuitBreaker, provider: Pick<Provider, "name">): CircuitBreaker {
  const originalFire = breaker.fire.bind(breaker);
  breaker.fire = async function (...args: unknown[]) {
    const result = await originalFire(...args);
    // P9-11: Runtime type guard — reject non-Response values
    if (result && typeof result === "object" && "ok" in (result as object)) {
      return result;
    }
    throw new Error(`CircuitBreaker for ${provider.name} returned non-Response (breaker may be open)`);
  };
  return breaker;
}
