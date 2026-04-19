

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

export interface CacheBackend {

  get(key: string): Promise<CacheEntry | null>;

  set(key: string, value: CacheEntry, ttlMs?: number): Promise<void>;

  delete(key: string): Promise<void>;

  searchSemantic?(embedding: number[], threshold?: number): Promise<SemanticSearchResult | null>;

  setSemantic?(key: string, prompt: string, value: CacheEntry, embedding: number[] | null, ttlMs?: number): Promise<void>;

  cleanup?(): Promise<void>;
}
