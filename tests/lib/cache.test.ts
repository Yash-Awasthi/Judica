import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock logger
vi.mock("../../src/lib/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));

// Mock env
vi.mock("../../src/config/env.js", () => ({
  env: { OPENAI_API_KEY: "test-key", ENABLE_VECTOR_CACHE: true }
}));

// Mock backends
vi.mock("../../src/lib/cache/backends.js", () => ({
  redisBackend: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  },
  postgresBackend: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    searchSemantic: vi.fn().mockResolvedValue(null),
    setSemantic: vi.fn().mockResolvedValue(undefined),
    cleanup: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock global fetch for embedding calls
global.fetch = vi.fn() as any;

import { generateCacheKey, getCachedResponse, setCachedResponse, getEmbeddingWithLock } from "../../src/lib/cache.js";
import { redisBackend, postgresBackend } from "../../src/lib/cache/backends.js";
import logger from "../../src/lib/logger.js";

const mockMembers = [
  { model: "gpt-4", temperature: 0.7, systemPrompt: "You are helpful", tools: ["search"] },
  { model: "claude-3", temperature: 0.5, systemPrompt: "Be concise", tools: ["code"] },
];
const mockMaster = { model: "gpt-4", systemPrompt: "Master prompt" };
const mockHistory = [
  { role: "user", content: "Hello" },
  { role: "assistant", content: "Hi there" },
];
const mockPrompt = "What is the meaning of life?";

function mockFetchEmbedding(embedding: number[] = [0.1, 0.2, 0.3]) {
  (global.fetch as any).mockResolvedValue({
    json: vi.fn().mockResolvedValue({ data: [{ embedding }] }),
  });
}

describe("Cache module", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset fetch to return a valid embedding by default
    mockFetchEmbedding();
  });

  // ---------------------------------------------------------------
  // generateCacheKey
  // ---------------------------------------------------------------
  describe("generateCacheKey", () => {
    it("returns a consistent hash for the same input", () => {
      const key1 = generateCacheKey(mockPrompt, mockMembers, mockMaster, mockHistory);
      const key2 = generateCacheKey(mockPrompt, mockMembers, mockMaster, mockHistory);
      expect(key1).toBe(key2);
      expect(key1).toHaveLength(64); // SHA-256 hex digest
    });

    it("returns different hashes for different prompts", () => {
      const key1 = generateCacheKey("prompt A", mockMembers, mockMaster, mockHistory);
      const key2 = generateCacheKey("prompt B", mockMembers, mockMaster, mockHistory);
      expect(key1).not.toBe(key2);
    });

    it("sorts members deterministically regardless of input order", () => {
      const membersForward = [
        { model: "a-model", temperature: 0.1, systemPrompt: "A" },
        { model: "z-model", temperature: 0.9, systemPrompt: "Z" },
      ];
      const membersReversed = [
        { model: "z-model", temperature: 0.9, systemPrompt: "Z" },
        { model: "a-model", temperature: 0.1, systemPrompt: "A" },
      ];
      const key1 = generateCacheKey(mockPrompt, membersForward);
      const key2 = generateCacheKey(mockPrompt, membersReversed);
      expect(key1).toBe(key2);
    });

    it("handles missing master and empty history", () => {
      const key1 = generateCacheKey(mockPrompt, mockMembers);
      const key2 = generateCacheKey(mockPrompt, mockMembers, undefined, []);
      expect(key1).toBe(key2);
      // Should still produce a valid 64-char hex string
      expect(key1).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  // ---------------------------------------------------------------
  // getCachedResponse
  // ---------------------------------------------------------------
  describe("getCachedResponse", () => {
    it("returns a redis hit immediately without querying postgres", async () => {
      const redisData = { verdict: "redis-verdict", opinions: [{ text: "ok" }] };
      (redisBackend.get as any).mockResolvedValue(redisData);

      const result = await getCachedResponse(mockPrompt, mockMembers, mockMaster, mockHistory);

      expect(result).toEqual(redisData);
      expect(redisBackend.get).toHaveBeenCalledTimes(1);
      // postgres should not have been consulted for exact match
      expect(postgresBackend.get).not.toHaveBeenCalled();
      expect(postgresBackend.searchSemantic).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ match: "exact", source: "redis" }),
        "Cache hit"
      );
    });

    it("falls through to vector search when redis misses", async () => {
      (redisBackend.get as any).mockResolvedValue(null);
      const vectorResult = { verdict: "vector-verdict", opinions: [{ text: "vec" }], distance: 0.08 };
      (postgresBackend.searchSemantic as any).mockResolvedValue(vectorResult);

      const result = await getCachedResponse(mockPrompt, mockMembers, mockMaster, mockHistory);

      expect(result).toEqual({ verdict: "vector-verdict", opinions: [{ text: "vec" }] });
      expect(redisBackend.get).toHaveBeenCalledTimes(1);
      expect(postgresBackend.searchSemantic).toHaveBeenCalledWith(
        expect.any(Array), // embedding
        0.15               // threshold
      );
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ match: "vector", source: "postgres" }),
        "Cache hit (vector)"
      );
    });

    it("falls through to postgres exact match when vector search misses", async () => {
      (redisBackend.get as any).mockResolvedValue(null);
      (postgresBackend.searchSemantic as any).mockResolvedValue(null);
      const pgData = { verdict: "pg-exact", opinions: [] };
      (postgresBackend.get as any).mockResolvedValue(pgData);

      const result = await getCachedResponse(mockPrompt, mockMembers, mockMaster, mockHistory);

      expect(result).toEqual(pgData);
      expect(postgresBackend.get).toHaveBeenCalledTimes(1);
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ match: "exact", source: "postgres" }),
        "Cache hit"
      );
    });

    it("returns null when all cache layers miss", async () => {
      (redisBackend.get as any).mockResolvedValue(null);
      (postgresBackend.searchSemantic as any).mockResolvedValue(null);
      (postgresBackend.get as any).mockResolvedValue(null);

      const result = await getCachedResponse(mockPrompt, mockMembers, mockMaster, mockHistory);

      expect(result).toBeNull();
    });

    it("backfills redis on a postgres exact-match hit", async () => {
      (redisBackend.get as any).mockResolvedValue(null);
      (postgresBackend.searchSemantic as any).mockResolvedValue(null);
      const pgData = { verdict: "backfill-me", opinions: [{ id: 1 }] };
      (postgresBackend.get as any).mockResolvedValue(pgData);

      await getCachedResponse(mockPrompt, mockMembers, mockMaster, mockHistory);

      expect(redisBackend.set).toHaveBeenCalledWith(
        expect.any(String),   // keyHash
        pgData,
        24 * 60 * 60 * 1000  // CACHE_TTL_MS
      );
    });
  });

  // ---------------------------------------------------------------
  // setCachedResponse
  // ---------------------------------------------------------------
  describe("setCachedResponse", () => {
    it("calls setSemantic and redis.set with the correct cache entry", async () => {
      const verdict = "approved";
      const opinions = [{ agent: "a1", opinion: "looks good" }];

      await setCachedResponse(mockPrompt, mockMembers, mockMaster, mockHistory, verdict, opinions);

      const expectedKey = generateCacheKey(mockPrompt, mockMembers, mockMaster, mockHistory);
      const expectedEntry = {
        verdict,
        opinions,
        metadata: { prompt: mockPrompt.slice(0, 500) },
      };

      expect(postgresBackend.setSemantic).toHaveBeenCalledWith(
        expectedKey,
        mockPrompt,
        expectedEntry,
        expect.any(Array), // embedding
        24 * 60 * 60 * 1000
      );

      expect(redisBackend.set).toHaveBeenCalledWith(
        expectedKey,
        expectedEntry,
        24 * 60 * 60 * 1000
      );
    });
  });

  // ---------------------------------------------------------------
  // getEmbeddingWithLock
  // ---------------------------------------------------------------
  describe("getEmbeddingWithLock", () => {
    it("deduplicates concurrent calls for the same text", async () => {
      let fetchCallCount = 0;
      (global.fetch as any).mockImplementation(async () => {
        fetchCallCount++;
        // Simulate network latency so both callers overlap
        await new Promise((r) => setTimeout(r, 20));
        return {
          json: vi.fn().mockResolvedValue({ data: [{ embedding: [1, 2, 3] }] }),
        };
      });

      const [res1, res2] = await Promise.all([
        getEmbeddingWithLock("identical text"),
        getEmbeddingWithLock("identical text"),
      ]);

      // fetch should only have been invoked once
      expect(fetchCallCount).toBe(1);
      // Both callers get the same result
      expect(res1).toEqual([1, 2, 3]);
      expect(res2).toEqual([1, 2, 3]);
    });
  });
});
