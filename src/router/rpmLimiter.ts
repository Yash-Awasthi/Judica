// P3-13: Sliding window rate limiter per provider using a ring buffer approach.
// Previous implementation used Array.shift() which is O(n) per prune.
// Now uses a start-index pointer for O(1) amortized pruning.

interface SlidingWindow {
  timestamps: number[];
  start: number; // index of the first valid entry
}

const windows = new Map<string, SlidingWindow>();

function getWindow(provider: string): SlidingWindow {
  let win = windows.get(provider);
  if (!win) {
    win = { timestamps: [], start: 0 };
    windows.set(provider, win);
  }
  return win;
}

/** Prune expired entries by advancing the start pointer (O(1) amortized). */
function prune(win: SlidingWindow, cutoff: number): void {
  while (win.start < win.timestamps.length && win.timestamps[win.start] < cutoff) {
    win.start++;
  }

  // Compact when more than half the array is dead — prevents unbounded memory growth
  if (win.start > 512 && win.start > win.timestamps.length / 2) {
    win.timestamps = win.timestamps.slice(win.start);
    win.start = 0;
  }
}

/** Active count in the current window. */
function activeCount(win: SlidingWindow): number {
  return win.timestamps.length - win.start;
}

/**
 * Check if a provider is within its RPM limit.
 * Uses a sliding window of 60 seconds.
 * P3-14: Supports optional userId for per-user scoping. Without userId,
 * falls back to global per-provider tracking (backward compatible).
 */
export function checkRPM(provider: string, limitPerMin: number, userId?: string): boolean {
  const key = userId ? `${provider}:${userId}` : provider;
  const win = getWindow(key);
  prune(win, Date.now() - 60_000);
  return activeCount(win) < limitPerMin;
}

/**
 * Record a request for RPM tracking. Call after sending the request.
 */
export function recordRequest(provider: string, userId?: string): void {
  const key = userId ? `${provider}:${userId}` : provider;
  const win = getWindow(key);
  win.timestamps.push(Date.now());
}

/**
 * Get current RPM usage for a provider.
 */
export function getCurrentRPM(provider: string, userId?: string): number {
  const key = userId ? `${provider}:${userId}` : provider;
  const win = getWindow(key);
  prune(win, Date.now() - 60_000);
  return activeCount(win);
}

// ─── Periodic cleanup of stale windows ─────────────────────────────────────

const MAX_WINDOWS = 50_000;
const WINDOW_CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

const _cleanupInterval = setInterval(() => {
  const cutoff = Date.now() - 60_000;
  for (const [key, win] of windows) {
    prune(win, cutoff);
    if (activeCount(win) === 0) {
      windows.delete(key);
    }
  }
  // Hard cap: if still over limit, evict oldest entries
  if (windows.size > MAX_WINDOWS) {
    const excess = windows.size - MAX_WINDOWS;
    const keys = windows.keys();
    for (let i = 0; i < excess; i++) {
      const k = keys.next().value;
      if (k) windows.delete(k);
    }
  }
}, WINDOW_CLEANUP_INTERVAL_MS);

if (_cleanupInterval.unref) _cleanupInterval.unref();
