// ─── RPM Limiter ─────────────────────────────────────────────────────────────
// Sliding window rate limiter per provider. Tracks request timestamps.

const windows = new Map<string, number[]>();

/**
 * Check if a provider is within its RPM limit.
 * Uses a sliding window of 60 seconds.
 */
export function checkRPM(provider: string, limitPerMin: number): boolean {
  const now = Date.now();
  const cutoff = now - 60_000;

  let timestamps = windows.get(provider);
  if (!timestamps) {
    timestamps = [];
    windows.set(provider, timestamps);
  }

  // Prune old entries
  while (timestamps.length > 0 && timestamps[0] < cutoff) {
    timestamps.shift();
  }

  return timestamps.length < limitPerMin;
}

/**
 * Record a request for RPM tracking. Call after sending the request.
 */
export function recordRequest(provider: string): void {
  const now = Date.now();
  let timestamps = windows.get(provider);
  if (!timestamps) {
    timestamps = [];
    windows.set(provider, timestamps);
  }
  timestamps.push(now);
}

/**
 * Get current RPM usage for a provider.
 */
export function getCurrentRPM(provider: string): number {
  const cutoff = Date.now() - 60_000;
  const timestamps = windows.get(provider);
  if (!timestamps) return 0;

  // Prune old
  while (timestamps.length > 0 && timestamps[0] < cutoff) {
    timestamps.shift();
  }

  return timestamps.length;
}
