
// Single source of truth for opinions type — import from here, don't duplicate
export interface CacheEntry {
  verdict: string;
  opinions: Array<{ name: string; opinion: string; [key: string]: unknown }>;
  metadata?: Record<string, unknown>;
}

export interface SemanticSearchResult {
  keyHash: string;
  verdict: string;
  opinions: Array<{ name: string; opinion: string; [key: string]: unknown }>;
  distance: number;
}

/**
 * TTL contract:
 * - `ttlMs` is REQUIRED for set/setSemantic — backends must not store entries without expiry.
 * - A value of 0 or negative is invalid and should be treated as an error.
 * - Backends should store the absolute expiry time (Date.now() + ttlMs) for cleanup.
 */
export interface CacheBackend {

  get(key: string): Promise<CacheEntry | null>;

  /** @param ttlMs - Time-to-live in milliseconds. REQUIRED; must be > 0. */
  set(key: string, value: CacheEntry, ttlMs: number): Promise<void>;

  delete(key: string): Promise<void>;

  searchSemantic?(embedding: number[], threshold?: number): Promise<SemanticSearchResult | null>;

  /** @param ttlMs - Time-to-live in milliseconds. REQUIRED; must be > 0. */
  setSemantic?(key: string, prompt: string, value: CacheEntry, embedding: number[] | null, ttlMs: number): Promise<void>;

  cleanup?(): Promise<void>;
}

/**
 * TTL validation helper — call at the start of set/setSemantic implementations.
 * Throws if ttlMs is not a positive finite number.
 */
export function validateTtl(ttlMs: number): void {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw new RangeError(`Invalid TTL: ${ttlMs}ms — must be a positive finite number`);
  }
}
