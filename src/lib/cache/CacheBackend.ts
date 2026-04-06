/**
 * CacheBackend interface for pluggable caching implementations.
 * 
 * This abstraction decouples cache logic from specific storage backends
 * (Redis, PostgreSQL, etc.) allowing the cache layer to work with
 * any compliant implementation.
 */

export interface CacheEntry {
  verdict: string;
  opinions: any[];
  metadata?: Record<string, unknown>;
}

export interface SemanticSearchResult {
  keyHash: string;
  verdict: string;
  opinions: any[];
  distance: number;
}

export interface CacheBackend {
  /**
   * Get a cached entry by key.
   * Returns null if not found or expired.
   */
  get(key: string): Promise<CacheEntry | null>;

  /**
   * Set a cache entry with optional TTL in milliseconds.
   */
  set(key: string, value: CacheEntry, ttlMs?: number): Promise<void>;

  /**
   * Delete a cache entry by key.
   */
  delete(key: string): Promise<void>;

  /**
   * Optional: Search by vector embedding (semantic similarity).
   * Only implemented by backends supporting vector search.
   */
  searchSemantic?(embedding: number[], threshold?: number): Promise<SemanticSearchResult | null>;

  /**
   * Optional: Store entry with embedding for semantic search.
   * Only implemented by backends supporting vector storage.
   */
  setSemantic?(key: string, prompt: string, value: CacheEntry, embedding: number[] | null, ttlMs?: number): Promise<void>;

  /**
   * Optional: Delete expired entries.
   * Called periodically for cleanup.
   */
  cleanup?(): Promise<void>;
}
