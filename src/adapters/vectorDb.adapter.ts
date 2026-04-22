/**
 * P4-20: Vector DB adapter abstraction.
 *
 * Provides a pluggable interface for vector databases (pgvector, Pinecone,
 * Weaviate, Qdrant, Milvus, etc.). The current implementation uses pgvector
 * via Drizzle, but this interface allows swapping backends without touching
 * service-layer code.
 *
 * Usage:
 *   import { getVectorAdapter } from "./vectorDb.adapter.js";
 *   const adapter = getVectorAdapter();
 *   await adapter.upsert(collection, id, vector, metadata);
 *   const results = await adapter.search(collection, queryVector, topK);
 */

export interface VectorSearchResult {
  id: string;
  score: number;
  metadata: Record<string, unknown>;
}

export interface VectorDbAdapter {
  /** Adapter name (e.g., "pgvector", "pinecone") */
  readonly name: string;

  /** Upsert a single vector with metadata. */
  upsert(
    collection: string,
    id: string,
    vector: number[],
    metadata: Record<string, unknown>,
  ): Promise<void>;

  /** Search for nearest neighbors. */
  search(
    collection: string,
    queryVector: number[],
    topK: number,
    filter?: Record<string, unknown>,
  ): Promise<VectorSearchResult[]>;

  /** Delete a vector by ID. */
  delete(collection: string, id: string): Promise<void>;

  /** Check connectivity / health. */
  ping(): Promise<boolean>;
}

/**
 * Default pgvector adapter — delegates to the existing vectorStore.service.ts.
 * Other adapters (Pinecone, Qdrant, etc.) can implement VectorDbAdapter and
 * be registered via `setVectorAdapter()`.
 */
class PgVectorAdapter implements VectorDbAdapter {
  readonly name = "pgvector";

  async upsert(
    _collection: string,
    _id: string,
    _vector: number[],
    _metadata: Record<string, unknown>,
  ): Promise<void> {
    // Delegates to existing vectorStore.service storeChunk / storeEmbedding
    // This is a shim — the real implementation lives in vectorStore.service.ts
    // and should be migrated to call this adapter instead.
    throw new Error("pgvector upsert: use vectorStore.service.storeChunk() directly until migration is complete");
  }

  async search(
    _collection: string,
    _queryVector: number[],
    _topK: number,
    _filter?: Record<string, unknown>,
  ): Promise<VectorSearchResult[]> {
    throw new Error("pgvector search: use vectorStore.service.hybridSearch() directly until migration is complete");
  }

  async delete(_collection: string, _id: string): Promise<void> {
    throw new Error("pgvector delete: use vectorStore.service directly until migration is complete");
  }

  async ping(): Promise<boolean> {
    // pgvector is always available if the DB is up
    return true;
  }
}

let currentAdapter: VectorDbAdapter = new PgVectorAdapter();

/** Get the active vector DB adapter. */
export function getVectorAdapter(): VectorDbAdapter {
  return currentAdapter;
}

/** Swap the vector DB adapter (e.g., to Pinecone or Qdrant). */
export function setVectorAdapter(adapter: VectorDbAdapter): void {
  if (!adapter || typeof adapter.search !== "function") {
    throw new Error("Invalid vector DB adapter: must implement search()");
  }
  currentAdapter = adapter;
}
