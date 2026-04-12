import CircuitBreaker from "opossum";
import logger from "./logger.js";
import { Provider } from "./providers.js";

/**
 * Circuit breaker utility for provider adapters.
 *
 * STATUS: This module IS wired into all adapter-layer classes (OpenAI, Anthropic,
 * Gemini, Groq, Ollama, OpenRouter, Custom).  Each adapter wraps its fetch call
 * with `getBreaker(provider, fetchFn).fire()`.
 *
 * It is NOT yet wired into the older concrete provider classes under
 * `lib/providers/concrete/` — those use direct `fetch` calls and rely on
 * per-request AbortController timeouts instead.  Wiring the breaker there would
 * require changing the `call()` signature to accept an injectable fetch, which
 * is a larger refactor tracked separately.
 */

const breakerRegistry = new Map<string, CircuitBreaker>();

const BREAKER_OPTIONS = {
  timeout: 45000,
  errorThresholdPercentage: 50,
  resetTimeout: 30000, // wait 30s before trying again
};

export function getBreaker<T extends (...args: any[]) => Promise<any>>(
  provider: Provider,
  action: T
): CircuitBreaker<Parameters<T>, ReturnType<T>> {
  const key = `${provider.name}:${action.name}`;

  if (!breakerRegistry.has(key)) {
    const breaker = new CircuitBreaker(action, BREAKER_OPTIONS);

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

    breakerRegistry.set(key, breaker);
  }

  const breaker = breakerRegistry.get(key)!;
  return breaker as CircuitBreaker<Parameters<T>, ReturnType<T>>;
}
