/**
 * Executes a function with exponential backoff retries.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    initialDelay?: number;
    maxDelay?: number;
    factor?: number;
    onRetry?: (error: any, attempt: number) => void;
    shouldRetry?: (error: any) => boolean;
  } = {}
): Promise<T> {
  const {
    maxRetries = 2,
    initialDelay = 1000,
    maxDelay = 10000,
    factor = 2,
    onRetry,
  } = options;

  let attempt = 0;
  let delay = initialDelay;

  while (true) {
    try {
      return await fn();
    } catch (error) {
      attempt++;
      
      // Don't retry if it's an AbortError (timeout) or if we hit the limit
      if (attempt > maxRetries || (error as Error).name === "AbortError" || (options.shouldRetry && !options.shouldRetry(error))) {
        throw error;
      }

      if (onRetry) {
        onRetry(error, attempt);
      }

      await new Promise((resolve) => setTimeout(resolve, delay));
      
      // Calculate next delay with exponential backoff + tiny jitter
      const jitter = Math.random() * 200; // 0-200ms randomized noise
      delay = Math.min(delay * factor + jitter, maxDelay);
    }
  }
}
