/**
 * Vector DB adapter abstraction.
 *
 * Provides a pluggable interface for vector databases (pgvector, Pinecone,
 * Weaviate, Qdrant, Milvus, Vespa, etc.). The current implementation uses
 * pgvector via Drizzle, but this interface allows swapping backends without
 * touching service-layer code.
 *
 * Supported backends:
 *   - pgvector   (default, via Drizzle + PostgreSQL)
 *   - vespa      (Vespa search engine — high-performance, hybrid BM25+ANN)
 *   - weaviate   (Weaviate — vector-first DB with GraphQL hybrid search)
 *   - pinecone   (Pinecone — managed vector DB, REST API v1)
 *
 * Usage:
 *   import { getVectorAdapter } from "./vectorDb.adapter.js";
 *   const adapter = getVectorAdapter();
 *   await adapter.upsert(collection, id, vector, metadata);
 *   const results = await adapter.search(collection, queryVector, topK);
 *
 * To switch backends at startup:
 *   import { initVectorAdapterFromEnv } from "./vectorDb.adapter.js";
 *   initVectorAdapterFromEnv();
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

/**
 * Initialise the vector DB adapter from environment variables.
 *
 * Checks VECTOR_DB_BACKEND (or falls back to detecting configured env vars)
 * and swaps the active adapter accordingly. Call this once at server startup.
 *
 * Supported values for VECTOR_DB_BACKEND:
 *   "vespa"    — requires VESPA_ENDPOINT
 *   "weaviate" — requires WEAVIATE_URL
 *   "pinecone" — requires PINECONE_API_KEY + PINECONE_ENVIRONMENT + PINECONE_INDEX
 *   "pgvector" — default (no extra env vars)
 */
export function initVectorAdapterFromEnv(): void {
  const backend = (process.env.VECTOR_DB_BACKEND ?? "").toLowerCase();

  if (backend === "vespa" || (!backend && process.env.VESPA_ENDPOINT)) {
    const endpoint = process.env.VESPA_ENDPOINT;
    if (!endpoint) {
      throw new Error("VESPA_ENDPOINT must be set when using the Vespa vector backend");
    }
    // Dynamic import kept as synchronous require-style to avoid top-level await
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { VespaAdapter } = require("./vespa.adapter.js") as typeof import("./vespa.adapter.js");
    setVectorAdapter(
      new VespaAdapter({
        endpoint,
        appName: process.env.VESPA_APP_NAME ?? "judica",
        namespace: process.env.VESPA_NAMESPACE,
      }),
    );
    return;
  }

  if (backend === "weaviate" || (!backend && process.env.WEAVIATE_URL)) {
    const url = process.env.WEAVIATE_URL;
    if (!url) {
      throw new Error("WEAVIATE_URL must be set when using the Weaviate vector backend");
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { WeaviateAdapter } = require("./weaviate.adapter.js") as typeof import("./weaviate.adapter.js");
    setVectorAdapter(
      new WeaviateAdapter({
        url,
        apiKey: process.env.WEAVIATE_API_KEY,
      }),
    );
    return;
  }

  if (backend === "pinecone" || (!backend && process.env.PINECONE_API_KEY)) {
    const apiKey = process.env.PINECONE_API_KEY;
    const environment = process.env.PINECONE_ENVIRONMENT;
    const indexName = process.env.PINECONE_INDEX;
    if (!apiKey || !environment || !indexName) {
      throw new Error(
        "PINECONE_API_KEY, PINECONE_ENVIRONMENT and PINECONE_INDEX must all be set when using the Pinecone vector backend",
      );
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PineconeAdapter } = require("./pinecone.adapter.js") as typeof import("./pinecone.adapter.js");
    setVectorAdapter(new PineconeAdapter({ apiKey, environment, indexName }));
    return;
  }

  // Default: pgvector (already set)
}
