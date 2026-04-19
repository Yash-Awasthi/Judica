import CircuitBreaker from "opossum";
import logger from "./logger.js";
import { Provider } from "./providers.js";

/**
 * Circuit breaker utility for provider adapters.
 *
 * STATUS: This module is wired into ALL provider classes:
 * - Adapter layer (OpenAI, Anthropic, Gemini, Groq, Ollama, OpenRouter, Custom)
 *   wraps fetch via `getBreaker(provider, fetchFn).fire()`.
 * - Concrete provider layer (lib/providers/concrete/*) wraps fetch via
 *   `BaseProvider.protectedFetch()` which delegates to getBreaker internally.
 */

const breakerRegistry = new Map<string, CircuitBreaker>();

const BREAKER_OPTIONS = {
  timeout: 45000,
  errorThresholdPercentage: 50,
  resetTimeout: 30000, // wait 30s before trying again
};

export function getBreaker<T extends (...args: unknown[]) => Promise<unknown>>(
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
