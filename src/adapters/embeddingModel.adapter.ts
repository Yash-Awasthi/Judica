/**
 * Embedding model abstraction.
 *
 * Decouples embedding generation from a specific provider. The RAG pipeline,
 * federated search, and vector store can call `getEmbeddingProvider().embed(text)`
 * without caring whether it's OpenAI, Gemini, Cohere, or a local model.
 *
 * The current embeddings.service.ts hard-codes provider selection via env vars.
 * This interface allows registering alternative providers and switching at runtime.
 *
 * Usage:
 *   import { getEmbeddingProvider } from "./embeddingModel.adapter.js";
 *   const vec = await getEmbeddingProvider().embed("hello world");
 */

export interface EmbeddingProvider {
  /** Provider identifier (e.g., "openai", "cohere", "local"). */
  readonly name: string;

  /** Target output dimensions. Must be consistent for a given collection. */
  readonly dimensions: number;

  /** The specific model name used (e.g., "text-embedding-3-small"). */
  readonly model: string;

  /** Generate an embedding vector for a single text input. */
  embed(text: string): Promise<number[]>;

  /** Generate embeddings for a batch of texts (for bulk ingestion). */
  embedBatch?(texts: string[]): Promise<number[][]>;
}

/**
 * Default provider — delegates to the existing embeddings.service.ts.
 * Acts as a bridge until callers are migrated to use this abstraction directly.
 */
class LegacyEmbeddingProvider implements EmbeddingProvider {
  readonly name = "legacy";
  readonly dimensions = 1536;
  readonly model = "auto-detected";

  async embed(text: string): Promise<number[]> {
    // Lazy-import to avoid circular dependency
    const { embed } = await import("../services/embeddings.service.js");
    return embed(text);
  }
}

let currentProvider: EmbeddingProvider = new LegacyEmbeddingProvider();

/** Get the active embedding provider. */
export function getEmbeddingProvider(): EmbeddingProvider {
  return currentProvider;
}

/** Set a custom embedding provider (e.g., Cohere, local SentenceTransformers). */
export function setEmbeddingProvider(provider: EmbeddingProvider): void {
  if (!provider || typeof provider.embed !== "function") {
    throw new Error("Invalid embedding provider: must implement embed()");
  }
  currentProvider = provider;
}
