import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock logger before any imports that use it
vi.mock("../../src/lib/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Mock env — start with both keys present; individual tests override as needed
const mockEnv = {
  OPENAI_API_KEY: "sk-test-openai-key",
  GOOGLE_API_KEY: "",
  DATABASE_URL: "postgresql://test:test@localhost:5432/test",
  JWT_SECRET: "test-jwt-secret-min-16-chars",
  MASTER_ENCRYPTION_KEY: "test-master-encryption-key-min-32-characters-long",
};

vi.mock("../../src/config/env.js", () => ({ env: mockEnv }));

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch as any;

// Helper: make a successful OpenAI response
function openAIResponse(embedding: number[]) {
  return {
    ok: true,
    json: async () => ({ data: [{ embedding }] }),
    text: async () => "",
  };
}

// Helper: make a successful Gemini response
function geminiResponse(values: number[]) {
  return {
    ok: true,
    json: async () => ({ embedding: { values } }),
    text: async () => "",
  };
}

// Helper: make a failed response
function failedResponse(status: number, body: string) {
  return {
    ok: false,
    status,
    text: async () => body,
    json: async () => ({}),
  };
}

describe("Embeddings Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();

    // Default: OpenAI key set, Gemini key unset
    mockEnv.OPENAI_API_KEY = "sk-test-openai-key";
    mockEnv.GOOGLE_API_KEY = "";
  });

  // ── OpenAI path ───────────────────────────────────────────────

  describe("OpenAI provider", () => {
    it("should call OpenAI embeddings endpoint with correct parameters", async () => {
      const fakeEmbedding = Array.from({ length: 1536 }, (_, i) => i * 0.001);
      mockFetch.mockResolvedValueOnce(openAIResponse(fakeEmbedding));

      const { embed } = await import("../../src/services/embeddings.service.js");
      const result = await embed("hello world");

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe("https://api.openai.com/v1/embeddings");
      expect(opts.method).toBe("POST");
      expect(opts.headers.Authorization).toBe("Bearer sk-test-openai-key");
      const body = JSON.parse(opts.body);
      expect(body.model).toBe("text-embedding-3-small");
      expect(body.input).toBe("hello world");
      expect(result).toEqual(fakeEmbedding);
    });

    it("should throw on non-ok OpenAI response", async () => {
      mockFetch.mockResolvedValueOnce(failedResponse(429, "rate limited"));

      const { embed } = await import("../../src/services/embeddings.service.js");
      await expect(embed("fail text")).rejects.toThrow("OpenAI embeddings failed: 429 rate limited");
    });
  });

  // ── Gemini path ───────────────────────────────────────────────

  describe("Gemini provider", () => {
    beforeEach(() => {
      mockEnv.OPENAI_API_KEY = "";
      mockEnv.GOOGLE_API_KEY = "google-test-key";
    });

    it("should call Gemini embeddings endpoint with correct parameters", async () => {
      const fakeValues = Array.from({ length: 1536 }, (_, i) => i * 0.001);
      mockFetch.mockResolvedValueOnce(geminiResponse(fakeValues));

      const { embed } = await import("../../src/services/embeddings.service.js");
      const result = await embed("hello gemini");

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toContain("text-embedding-004:embedContent");
      expect(url).not.toContain("key="); // API key moved to header
      expect(opts.headers["x-goog-api-key"]).toBe("google-test-key");
      const body = JSON.parse(opts.body);
      expect(body.content.parts[0].text).toBe("hello gemini");
      expect(body.outputDimensionality).toBe(1536);
      expect(result).toHaveLength(1536);
    });

    it("should truncate embeddings longer than 1536 dimensions", async () => {
      const longValues = Array.from({ length: 2048 }, (_, i) => i * 0.001);
      mockFetch.mockResolvedValueOnce(geminiResponse(longValues));

      const { embed } = await import("../../src/services/embeddings.service.js");
      const result = await embed("long embedding");

      expect(result).toHaveLength(1536);
      // Truncation should keep the first 1536 values unchanged
      expect(result).toEqual(longValues.slice(0, 1536));
    });

    it("should pad and normalize embeddings shorter than 1536 dimensions", async () => {
      // Use a simple vector so we can verify normalization math
      const shortValues = [3, 4]; // norm = 5
      mockFetch.mockResolvedValueOnce(geminiResponse(shortValues));

      const { embed } = await import("../../src/services/embeddings.service.js");
      const result = await embed("short embedding");

      expect(result).toHaveLength(1536);

      // Step 1: normalize [3,4] => [0.6, 0.8]
      // Step 2: pad to 1536 with zeros
      // Step 3: re-normalize full vector (norm of [0.6, 0.8, 0, ...] = 1.0)
      // So final vector first two elements should be 0.6 and 0.8
      expect(result[0]).toBeCloseTo(0.6, 5);
      expect(result[1]).toBeCloseTo(0.8, 5);

      // Padded positions should all be 0
      for (let i = 2; i < 1536; i++) {
        expect(result[i]).toBe(0);
      }

      // Full vector norm should be ~1.0
      const norm = Math.sqrt(result.reduce((s, v) => s + v * v, 0));
      expect(norm).toBeCloseTo(1.0, 5);
    });

    it("should handle exact 1536-dimension Gemini response without modification", async () => {
      const exactValues = Array.from({ length: 1536 }, (_, i) => (i + 1) * 0.0001);
      mockFetch.mockResolvedValueOnce(geminiResponse(exactValues));

      const { embed } = await import("../../src/services/embeddings.service.js");
      const result = await embed("exact dim");

      // >= TARGET_DIMENSIONS takes the slice path, which is identity for exact length
      expect(result).toEqual(exactValues.slice(0, 1536));
      expect(result).toHaveLength(1536);
    });

    it("should throw on non-ok Gemini response", async () => {
      mockFetch.mockResolvedValueOnce(failedResponse(500, "internal error"));

      const { embed } = await import("../../src/services/embeddings.service.js");
      await expect(embed("fail text")).rejects.toThrow("Gemini embeddings failed: 500 internal error");
    });
  });

  // ── No provider ───────────────────────────────────────────────

  describe("no provider available", () => {
    it("should throw when neither API key is set", async () => {
      mockEnv.OPENAI_API_KEY = "";
      mockEnv.GOOGLE_API_KEY = "";

      const { embed } = await import("../../src/services/embeddings.service.js");
      await expect(embed("no keys")).rejects.toThrow(
        "No embedding provider available. Set OPENAI_API_KEY or GOOGLE_API_KEY."
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // ── Provider fallback ─────────────────────────────────────────

  describe("provider fallback", () => {
    it("should use Gemini when OPENAI_API_KEY is absent but GOOGLE_API_KEY is set", async () => {
      mockEnv.OPENAI_API_KEY = "";
      mockEnv.GOOGLE_API_KEY = "google-test-key";

      const fakeValues = Array.from({ length: 1536 }, () => 0.01);
      mockFetch.mockResolvedValueOnce(geminiResponse(fakeValues));

      const { embed } = await import("../../src/services/embeddings.service.js");
      const result = await embed("fallback to gemini");

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain("generativelanguage.googleapis.com");
      expect(result).toHaveLength(1536);
    });

    it("should prefer OpenAI when both keys are set", async () => {
      mockEnv.OPENAI_API_KEY = "sk-test-openai-key";
      mockEnv.GOOGLE_API_KEY = "google-test-key";

      const fakeEmbedding = Array.from({ length: 1536 }, () => 0.01);
      mockFetch.mockResolvedValueOnce(openAIResponse(fakeEmbedding));

      const { embed } = await import("../../src/services/embeddings.service.js");
      await embed("both keys present");

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe("https://api.openai.com/v1/embeddings");
    });
  });

  // ── LRU cache ─────────────────────────────────────────────────

  describe("LRU cache", () => {
    it("should return cached embedding on second call with same text", async () => {
      const fakeEmbedding = Array.from({ length: 1536 }, (_, i) => i * 0.001);
      mockFetch.mockResolvedValue(openAIResponse(fakeEmbedding));

      const { embed } = await import("../../src/services/embeddings.service.js");

      const first = await embed("cached text");
      const second = await embed("cached text");

      // fetch should only be called once — second call hits cache
      expect(mockFetch).toHaveBeenCalledOnce();
      expect(first).toEqual(second);
    });

    it("should not cache across different texts", async () => {
      const embedding1 = Array.from({ length: 1536 }, () => 0.1);
      const embedding2 = Array.from({ length: 1536 }, () => 0.2);
      mockFetch
        .mockResolvedValueOnce(openAIResponse(embedding1))
        .mockResolvedValueOnce(openAIResponse(embedding2));

      const { embed } = await import("../../src/services/embeddings.service.js");

      const first = await embed("text A");
      const second = await embed("text B");

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(first).not.toEqual(second);
    });
  });

  // ── Batch embedding ───────────────────────────────────────────

  describe("embedBatch", () => {
    it("should embed all texts and return array of embeddings", async () => {
      const emb1 = Array.from({ length: 1536 }, () => 0.1);
      const emb2 = Array.from({ length: 1536 }, () => 0.2);
      const emb3 = Array.from({ length: 1536 }, () => 0.3);
      mockFetch
        .mockResolvedValueOnce(openAIResponse(emb1))
        .mockResolvedValueOnce(openAIResponse(emb2))
        .mockResolvedValueOnce(openAIResponse(emb3));

      const { embedBatch } = await import("../../src/services/embeddings.service.js");
      const results = await embedBatch(["a", "b", "c"]);

      expect(results).toHaveLength(3);
      expect(results[0]).toEqual(emb1);
      expect(results[1]).toEqual(emb2);
      expect(results[2]).toEqual(emb3);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it("should return empty array for empty input", async () => {
      const { embedBatch } = await import("../../src/services/embeddings.service.js");
      const results = await embedBatch([]);

      expect(results).toEqual([]);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should use cache for repeated text across sequential calls", async () => {
      const emb = Array.from({ length: 1536 }, () => 0.5);
      mockFetch.mockResolvedValue(openAIResponse(emb));

      const { embed, embedBatch } = await import("../../src/services/embeddings.service.js");

      // First call populates the cache
      await embed("repeated");
      expect(mockFetch).toHaveBeenCalledOnce();

      // Batch call with the same text should hit cache for that entry
      mockFetch.mockClear();
      const results = await embedBatch(["repeated", "new-text"]);

      expect(results).toHaveLength(2);
      // "repeated" was cached, only "new-text" triggers a fetch
      expect(mockFetch).toHaveBeenCalledOnce();
      expect(results[0]).toEqual(emb);
      expect(results[1]).toEqual(emb);
    });
  });
});
