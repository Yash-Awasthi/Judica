import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock logger
vi.mock("../../src/lib/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  rerank,
  rerankChunks,
  isRerankAvailable,
  type RerankableItem,
} from "../../src/services/reranker.service.js";

describe("reranker.service", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.COHERE_API_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe("isRerankAvailable", () => {
    it("should return false when no API key", () => {
      expect(isRerankAvailable()).toBe(false);
    });

    it("should return true when API key is set", () => {
      process.env.COHERE_API_KEY = "test-key";
      expect(isRerankAvailable()).toBe(true);
    });
  });

  describe("rerank", () => {
    const items: RerankableItem[] = [
      { id: "1", content: "First document about machine learning" },
      { id: "2", content: "Second document about cooking recipes" },
      { id: "3", content: "Third document about neural networks" },
    ];

    it("should return items in original order when no API key", async () => {
      const results = await rerank("machine learning", items);

      expect(results).toHaveLength(3);
      expect(results[0].item.id).toBe("1");
      expect(results[0].originalIndex).toBe(0);
      expect(results[0].relevanceScore).toBe(1);
      expect(results[1].relevanceScore).toBe(0.99);
    });

    it("should respect topN when no API key", async () => {
      const results = await rerank("machine learning", items, 2);
      expect(results).toHaveLength(2);
    });

    it("should return empty array for empty items", async () => {
      const results = await rerank("query", []);
      expect(results).toHaveLength(0);
    });

    it("should call Cohere API when key is set", async () => {
      process.env.COHERE_API_KEY = "test-key";

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          results: [
            { index: 2, relevance_score: 0.95 },
            { index: 0, relevance_score: 0.80 },
            { index: 1, relevance_score: 0.10 },
          ],
        }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const results = await rerank("neural networks", items);

      expect(mockFetch).toHaveBeenCalledOnce();
      expect(results).toHaveLength(3);
      // Reranked: item 3 first (index 2), then item 1 (index 0)
      expect(results[0].item.id).toBe("3");
      expect(results[0].relevanceScore).toBe(0.95);
      expect(results[1].item.id).toBe("1");
    });

    it("should fallback gracefully on API error", async () => {
      process.env.COHERE_API_KEY = "test-key";

      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        text: () => Promise.resolve("rate limited"),
      });
      vi.stubGlobal("fetch", mockFetch);

      const results = await rerank("query", items);

      // Should fallback to original order
      expect(results).toHaveLength(3);
      expect(results[0].item.id).toBe("1");
    });

    it("should fallback gracefully on network error", async () => {
      process.env.COHERE_API_KEY = "test-key";

      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));

      const results = await rerank("query", items);
      expect(results).toHaveLength(3);
      expect(results[0].item.id).toBe("1");
    });
  });

  describe("rerankChunks", () => {
    it("should rerank and return items with updated scores", async () => {
      const chunks = [
        { id: "1", content: "Doc A", sourceName: "a.pdf", score: 0.8 },
        { id: "2", content: "Doc B", sourceName: "b.pdf", score: 0.7 },
      ];

      const result = await rerankChunks("query", chunks, 2);

      expect(result).toHaveLength(2);
      // Each item should have a score property
      for (const item of result) {
        expect(item.score).toBeDefined();
        expect(typeof item.score).toBe("number");
      }
    });
  });
});
