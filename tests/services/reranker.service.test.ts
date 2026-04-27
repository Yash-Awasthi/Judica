import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock logger (with child support)
vi.mock("../../src/lib/logger.js", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    })),
  },
}));

import {
  isRerankAvailable,
  rerank,
  rerankChunks,
  type RerankableItem,
} from "../../src/services/reranker.service.js";

const items: RerankableItem[] = [
  { id: "a", content: "Artificial intelligence is a technology..." },
  { id: "b", content: "Machine learning is a subset of AI..." },
  { id: "c", content: "Deep learning uses neural networks..." },
];

describe("reranker.service", () => {
  let mockFetch: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.COHERE_API_KEY;
    mockFetch = vi.spyOn(global, "fetch");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── isRerankAvailable ──────────────────────────────────────────────────────

  describe("isRerankAvailable", () => {
    it("returns false when COHERE_API_KEY is not set", () => {
      expect(isRerankAvailable()).toBe(false);
    });

    it("returns true when COHERE_API_KEY is set", () => {
      process.env.COHERE_API_KEY = "test-key-123";
      expect(isRerankAvailable()).toBe(true);
    });
  });

  // ─── rerank — no API key (fallback) ────────────────────────────────────────

  describe("rerank — no API key", () => {
    it("returns empty array when items is empty", async () => {
      const result = await rerank("query", []);
      expect(result).toEqual([]);
    });

    it("returns items in original order without calling fetch", async () => {
      const result = await rerank("artificial intelligence", items);
      expect(mockFetch).not.toHaveBeenCalled();
      expect(result).toHaveLength(3);
      expect(result[0].item.id).toBe("a");
      expect(result[1].item.id).toBe("b");
      expect(result[2].item.id).toBe("c");
    });

    it("assigns relevanceScore = 1 - idx * 0.01 for each position", async () => {
      const result = await rerank("artificial intelligence", items);
      expect(result[0].relevanceScore).toBe(1);
      expect(result[1].relevanceScore).toBeCloseTo(0.99);
      expect(result[2].relevanceScore).toBeCloseTo(0.98);
    });

    it("sets originalIndex equal to position in input array", async () => {
      const result = await rerank("query", items);
      expect(result[0].originalIndex).toBe(0);
      expect(result[1].originalIndex).toBe(1);
      expect(result[2].originalIndex).toBe(2);
    });

    it("respects topN by slicing results to that length", async () => {
      const result = await rerank("query", items, 2);
      expect(result).toHaveLength(2);
      expect(result[0].item.id).toBe("a");
      expect(result[1].item.id).toBe("b");
    });

    it("returns all items when topN is undefined", async () => {
      const result = await rerank("query", items, undefined);
      expect(mockFetch).not.toHaveBeenCalled();
      expect(result).toHaveLength(items.length);
    });
  });

  // ─── rerank — with API key ──────────────────────────────────────────────────

  describe("rerank — with API key", () => {
    beforeEach(() => {
      process.env.COHERE_API_KEY = "cohere-test-key";
    });

    it("calls fetch with the correct Cohere URL", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [
            { index: 2, relevance_score: 0.95 },
            { index: 0, relevance_score: 0.80 },
            { index: 1, relevance_score: 0.50 },
          ],
        }),
        text: async () => "",
      } as Response);

      await rerank("neural networks", items);

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://api.cohere.ai/v1/rerank");
    });

    it("sends correct Authorization and Content-Type headers", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [{ index: 0, relevance_score: 0.9 }] }),
        text: async () => "",
      } as Response);

      await rerank("query", items);

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      expect(headers["Authorization"]).toBe("Bearer cohere-test-key");
      expect(headers["Content-Type"]).toBe("application/json");
    });

    it("passes topN to the API body as top_n", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [
            { index: 1, relevance_score: 0.9 },
            { index: 0, relevance_score: 0.7 },
          ],
        }),
        text: async () => "",
      } as Response);

      await rerank("query", items, 2);

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string);
      expect(body.top_n).toBe(2);
    });

    it("uses items.length as top_n when topN is undefined", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: items.map((_, idx) => ({ index: idx, relevance_score: 1 - idx * 0.1 })),
        }),
        text: async () => "",
      } as Response);

      await rerank("query", items);

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string);
      expect(body.top_n).toBe(items.length);
    });

    it("maps API results back to items by index in correct order", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [
            { index: 1, relevance_score: 0.9 },
            { index: 0, relevance_score: 0.7 },
          ],
        }),
        text: async () => "",
      } as Response);

      const result = await rerank("query", items, 2);

      expect(result).toHaveLength(2);
      expect(result[0].item.id).toBe("b");
      expect(result[0].relevanceScore).toBe(0.9);
      expect(result[0].originalIndex).toBe(1);
      expect(result[1].item.id).toBe("a");
      expect(result[1].relevanceScore).toBe(0.7);
      expect(result[1].originalIndex).toBe(0);
    });

    it("truncates document content to 4096 chars in the request body", async () => {
      const longContent = "x".repeat(8000);
      const longItems: RerankableItem[] = [{ id: "long", content: longContent }];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [{ index: 0, relevance_score: 0.5 }] }),
        text: async () => "",
      } as Response);

      await rerank("query", longItems);

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string);
      expect(body.documents[0]).toHaveLength(4096);
    });

    it("falls back to original order when API returns !response.ok", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "Internal Server Error",
      } as Response);

      const result = await rerank("query", items);

      expect(result).toHaveLength(3);
      expect(result[0].item.id).toBe("a");
      expect(result[1].item.id).toBe("b");
      expect(result[2].item.id).toBe("c");
    });

    it("falls back to original order when fetch throws", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network failure"));

      const result = await rerank("query", items);

      expect(result).toHaveLength(3);
      expect(result[0].item.id).toBe("a");
    });

    it("fallback on error respects topN slice", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        text: async () => "Service Unavailable",
      } as Response);

      const result = await rerank("query", items, 1);

      expect(result).toHaveLength(1);
      expect(result[0].item.id).toBe("a");
    });

    it("fallback on thrown error also applies relevanceScore formula", async () => {
      mockFetch.mockRejectedValueOnce(new Error("timeout"));

      const result = await rerank("query", items);

      expect(result[0].relevanceScore).toBe(1);
      expect(result[1].relevanceScore).toBeCloseTo(0.99);
      expect(result[2].relevanceScore).toBeCloseTo(0.98);
    });
  });

  // ─── rerankChunks ───────────────────────────────────────────────────────────

  describe("rerankChunks", () => {
    it("returns items with a score field added", async () => {
      const chunks = [
        { id: "a", content: "Artificial intelligence is a technology...", score: 0.6 },
        { id: "b", content: "Machine learning is a subset of AI...", score: 0.5 },
        { id: "c", content: "Deep learning uses neural networks...", score: 0.4 },
      ];

      const result = await rerankChunks("AI", chunks, 3);

      expect(result).toHaveLength(3);
      for (const item of result) {
        expect(typeof item.score).toBe("number");
      }
    });

    it("defaults topN to 5 when not provided", async () => {
      const manyChunks: RerankableItem[] = Array.from({ length: 10 }, (_, i) => ({
        id: String(i),
        content: `Document number ${i}`,
      }));

      const result = await rerankChunks("query", manyChunks);

      expect(result).toHaveLength(5);
    });

    it("overwrites existing score property with reranked relevanceScore", async () => {
      const chunks = [
        { id: "a", content: "First doc", score: 0.99 },
        { id: "b", content: "Second doc", score: 0.01 },
      ];

      const result = await rerankChunks("query", chunks, 2);

      // Fallback mode: scores are 1.0 and 0.99, not the originals
      expect(result[0].score).toBe(1);
      expect(result[1].score).toBeCloseTo(0.99);
    });

    it("preserves all other fields from the original item", async () => {
      const chunks = [{ id: "x", content: "Some content", sourceName: "doc.pdf", page: 3 }];
      const result = await rerankChunks("query", chunks, 1);

      expect(result[0].id).toBe("x");
      expect(result[0].content).toBe("Some content");
      expect(result[0].sourceName).toBe("doc.pdf");
      expect(result[0].page).toBe(3);
    });
  });
});
