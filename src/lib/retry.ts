import logger from "./logger.js";

// P9-33: Global retry budget — prevents retry amplification across layers
// Each layer (provider, strategy, router) retries independently; this cap
// limits total concurrent retries system-wide.
const MAX_CONCURRENT_RETRIES = 50;
let activeRetries = 0;

// P9-34: Retry metrics for observability
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
 * P9-32: Retry count semantics clarified:
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
    label?: string; // P9-34: optional label for metrics tracking
  } = {}
): Promise<T> {
  const {
    maxRetries = 2,
    initialDelay = 1000,
    maxDelay = 10000,
    factor = 2,
    onRetry,
    signal,
  } = options;

  let attempt = 0;
  let delay = initialDelay;

  while (true) {
    try {
      return await fn(signal);
    } catch (error) {
      attempt++;

      // P9-31: AbortError must never retry — check BEFORE shouldRetry predicate
      if ((error as Error).name === "AbortError" || signal?.aborted) {
        throw error;
      }

      if (attempt > maxRetries || (options.shouldRetry && !options.shouldRetry(error))) {
        throw error;
      }

      // P9-33: Check global retry budget
      if (activeRetries >= MAX_CONCURRENT_RETRIES) {
        retryMetrics.budgetExhausted++;
        logger.warn({ activeRetries, label: options.label }, "Global retry budget exhausted — not retrying");
        throw error;
      }

      activeRetries++;
      // P9-34: Track retry metrics
      retryMetrics.totalRetries++;
      if (options.label) {
        const prev = retryMetrics.retriesByProvider.get(options.label) || 0;
        retryMetrics.retriesByProvider.set(options.label, prev + 1);
      }

      if (onRetry) {
        onRetry(error, attempt);
      }

      // P9-35: Check AbortSignal during backoff sleep — don't wait if already aborted
      try {
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
