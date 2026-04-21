import logger from "../lib/logger.js";

/**
 * Cohere reranking service: post-retrieval reranking using Cohere's
 * rerank-english-v3.0 model. Improves precision by rescoring top-k
 * results against the original query.
 *
 * Optional: gracefully degrades when COHERE_API_KEY is not set.
 */

export interface RerankableItem {
  id: string;
  content: string;
  [key: string]: unknown;
}

export interface RerankResult<T extends RerankableItem> {
  item: T;
  relevanceScore: number;
  originalIndex: number;
}

const COHERE_RERANK_URL = "https://api.cohere.ai/v1/rerank";
const COHERE_MODEL = "rerank-english-v3.0";

/**
 * Check if Cohere reranking is available (API key configured).
 */
export function isRerankAvailable(): boolean {
  return !!process.env.COHERE_API_KEY;
}

/**
 * Rerank items using Cohere's rerank API.
 * Returns items sorted by relevance score (highest first).
 *
 * If Cohere is unavailable, returns items in original order with
 * synthetic scores based on position.
 */
export async function rerank<T extends RerankableItem>(
  query: string,
  items: T[],
  topN?: number,
): Promise<RerankResult<T>[]> {
  if (items.length === 0) return [];

  const apiKey = process.env.COHERE_API_KEY;

  if (!apiKey) {
    logger.debug("Cohere reranking unavailable (no API key), returning original order");
    return items.slice(0, topN).map((item, idx) => ({
      item,
      relevanceScore: 1 - idx * 0.01,
      originalIndex: idx,
    }));
  }

  try {
    const documents = items.map((item) => item.content.substring(0, 4096));

    const response = await fetch(COHERE_RERANK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: COHERE_MODEL,
        query,
        documents,
        top_n: (topN != null && topN > 0) ? topN : items.length, // P26-10: Explicit null check to avoid falsy-0 bug
        return_documents: false,
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      logger.warn(
        { status: response.status, body: errText.substring(0, 200) },
        "Cohere rerank API error, falling back to original order"
      );
      return fallbackOrder(items, topN);
    }

    const data = (await response.json()) as {
      results: { index: number; relevance_score: number }[];
    };

    return data.results
      .filter((r) => r.index >= 0 && r.index < items.length) // P26-05: Validate index bounds
      .map((r) => ({
      item: items[r.index],
      relevanceScore: r.relevance_score,
      originalIndex: r.index,
    }));
  } catch (err) {
    logger.warn({ err }, "Cohere rerank failed, falling back to original order");
    return fallbackOrder(items, topN);
  }
}

function fallbackOrder<T extends RerankableItem>(
  items: T[],
  topN?: number,
): RerankResult<T>[] {
  return items.slice(0, topN).map((item, idx) => ({
    item,
    relevanceScore: 1 - idx * 0.01,
    originalIndex: idx,
  }));
}

/**
 * Rerank RAG chunks after retrieval. Convenience wrapper that converts
 * MemoryChunk-compatible items through Cohere reranking.
 */
export async function rerankChunks<T extends RerankableItem>(
  query: string,
  chunks: T[],
  topN: number = 5,
): Promise<T[]> {
  const reranked = await rerank(query, chunks, topN);
  return reranked.map((r) => ({
    ...r.item,
    score: r.relevanceScore,
  }));
}
