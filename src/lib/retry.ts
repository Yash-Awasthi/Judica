import logger from "./logger.js";

// Global retry budget — prevents retry amplification across layers
// Each layer (provider, strategy, router) retries independently; this cap
// limits total concurrent retries system-wide.
const MAX_CONCURRENT_RETRIES = 50;
let activeRetries = 0;

// Retry metrics for observability
// Cap retriesByProvider Map to prevent unbounded growth from many distinct labels
const MAX_PROVIDER_METRIC_ENTRIES = 200;
const retryMetrics = {
  totalRetries: 0,
  retriesByProvider: new Map<string, number>(),
  abortedRetries: 0,
  budgetExhausted: 0,
};

export function getRetryMetrics() {
  return {
    ...retryMetrics,
    activeRetries,
    retriesByProvider: Object.fromEntries(retryMetrics.retriesByProvider),
  };
}

/**
 * Retry count semantics clarified:
 * - `maxRetries` means ADDITIONAL retries after the first attempt.
 * - `maxRetries: 2` = 1 initial attempt + 2 retries = 3 total attempts.
 */
export async function withRetry<T>(
  fn: (signal?: AbortSignal) => Promise<T>,
  options: {
    maxRetries?: number;
    initialDelay?: number;
    maxDelay?: number;
    factor?: number;
    onRetry?: (error: unknown, attempt: number) => void;
    shouldRetry?: (error: unknown) => boolean;
    signal?: AbortSignal;
    label?: string; // optional label for metrics tracking
  } = {}
): Promise<T> {
  const {
    onRetry,
    signal,
  } = options;

  // Guard numeric options against NaN, negative, and non-finite values.
  // Fall back to safe defaults so delay calculations never produce NaN.
  const maxRetries = Number.isFinite(options.maxRetries) && (options.maxRetries as number) >= 0
    ? (options.maxRetries as number) : 2;
  const initialDelay = Number.isFinite(options.initialDelay) && (options.initialDelay as number) > 0
    ? (options.initialDelay as number) : 1000;
  const maxDelay = Number.isFinite(options.maxDelay) && (options.maxDelay as number) > 0
    ? (options.maxDelay as number) : 10000;
  const factor = Number.isFinite(options.factor) && (options.factor as number) >= 1
    ? (options.factor as number) : 2;

  let attempt = 0;
  let delay = initialDelay;

  while (true) {
    try {
      return await fn(signal);
    } catch (error) {
      attempt++;

      // AbortError must never retry — check BEFORE shouldRetry predicate
      if ((error as Error).name === "AbortError" || signal?.aborted) {
        throw error;
      }

      if (attempt > maxRetries || (options.shouldRetry && !options.shouldRetry(error))) {
        throw error;
      }

      // Check global retry budget
      if (activeRetries >= MAX_CONCURRENT_RETRIES) {
        retryMetrics.budgetExhausted++;
        logger.warn({ activeRetries, label: options.label }, "Global retry budget exhausted — not retrying");
        throw error;
      }

      activeRetries++;
      // Track retry metrics
      retryMetrics.totalRetries++;
      if (options.label) {
        const prev = retryMetrics.retriesByProvider.get(options.label) || 0;
        retryMetrics.retriesByProvider.set(options.label, prev + 1);
        // Evict oldest entry if map exceeds cap
        if (retryMetrics.retriesByProvider.size > MAX_PROVIDER_METRIC_ENTRIES) {
          const oldest = retryMetrics.retriesByProvider.keys().next().value;
          if (oldest !== undefined) retryMetrics.retriesByProvider.delete(oldest);
        }
      }

      if (onRetry) {
        onRetry(error, attempt);
      }

      // Check AbortSignal during backoff sleep — don't wait if already aborted
      try {
        // Track retry metrics
        // Cap counter to prevent overflow past Number.MAX_SAFE_INTEGER
        if (retryMetrics.totalRetries < Number.MAX_SAFE_INTEGER) {
          retryMetrics.totalRetries++;
        }
        if (options.label) {
          const prev = retryMetrics.retriesByProvider.get(options.label) || 0;
          retryMetrics.retriesByProvider.set(options.label, prev + 1);
        }

        if (onRetry) {
          onRetry(error, attempt);
        }

        // Check AbortSignal during backoff sleep — don't wait if already aborted
        await new Promise<void>((resolve, reject) => {
          let onAbort: (() => void) | undefined;
          const timer = setTimeout(() => {
            if (onAbort && signal) signal.removeEventListener("abort", onAbort);
            resolve();
          }, delay);

          if (signal) {
            if (signal.aborted) {
              clearTimeout(timer);
              reject(new DOMException("Retry aborted", "AbortError"));
              return;
            }
            onAbort = () => {
              clearTimeout(timer);
              reject(new DOMException("Retry aborted", "AbortError"));
            };
            signal.addEventListener("abort", onAbort, { once: true });
          }
        });
      } finally {
        activeRetries--;
      }

      const jitter = Math.random() * 200; // 0-200ms randomized noise
      delay = Math.min(delay * factor + jitter, maxDelay);
    }
  }
}
