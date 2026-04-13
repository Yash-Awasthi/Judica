import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock backends
vi.mock("../../src/lib/cache/backends.js", () => ({
  redisBackend: { get: vi.fn(), set: vi.fn().mockResolvedValue(undefined) },
  postgresBackend: { 
    get: vi.fn(), 
    setSemantic: vi.fn().mockResolvedValue(undefined), 
    searchSemantic: vi.fn(), 
    cleanup: vi.fn().mockResolvedValue(undefined) 
  }
}));

// Mock logger
vi.mock("../../src/lib/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn() }
}));

// Mock fetch
global.fetch = vi.fn() as any;

describe("Cache Utility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockMembers = [{ model: "m1", temperature: 0.7, systemPrompt: "s1" }];
  const mockPrompt = "test prompt";

  it("should generate deterministic cache keys", async () => {
    const { generateCacheKey } = await import("../../src/lib/cache.js");
    
    const key1 = generateCacheKey(mockPrompt, mockMembers);
    const key2 = generateCacheKey(mockPrompt, mockMembers);
    expect(key1).toBe(key2);
    expect(key1).toHaveLength(64); // sha256 hex
  });

  it("should handle redis cache hits", async () => {
    const { getCachedResponse } = await import("../../src/lib/cache.js");
    const { redisBackend } = await import("../../src/lib/cache/backends.js");

    (redisBackend.get as any).mockResolvedValue({ verdict: "hit" });

    const result = await getCachedResponse(mockPrompt, mockMembers);
    expect(result).toEqual({ verdict: "hit" });
    expect(redisBackend.get).toHaveBeenCalled();
  });

  it("should fallback to postgres on redis miss", async () => {
    const { getCachedResponse } = await import("../../src/lib/cache.js");
    const { redisBackend, postgresBackend } = await import("../../src/lib/cache/backends.js");

    (redisBackend.get as any).mockResolvedValue(null);
    (postgresBackend.get as any).mockResolvedValue({ verdict: "pg-hit" });

    const result = await getCachedResponse(mockPrompt, mockMembers);
    expect(result).toEqual({ verdict: "pg-hit" });
    expect(redisBackend.set).toHaveBeenCalled(); // Should update redis
  });

  it("should handle semantic search hit", async () => {
    const { getCachedResponse } = await import("../../src/lib/cache.js");
    const { redisBackend, postgresBackend } = await import("../../src/lib/cache/backends.js");
    const { env } = await import("../../src/config/env.js");

    // Enable vector cache for this test
    (env as any).ENABLE_VECTOR_CACHE = true;
    (env as any).OPENAI_API_KEY = "test-key";

    (redisBackend.get as any).mockResolvedValue(null);
    (postgresBackend.get as any).mockResolvedValue(null);
    
    // Mock fetch for embedding
    (global.fetch as any).mockResolvedValue({
      json: vi.fn().mockResolvedValue({ data: [{ embedding: [0.1, 0.2] }] })
    });

    (postgresBackend.searchSemantic as any).mockResolvedValue({ 
      distance: 0.1, 
      verdict: "vector-hit",
      opinions: []
    });

    const result = await getCachedResponse(mockPrompt, mockMembers);
    expect(result?.verdict).toBe("vector-hit");
  });

  it("should cache new responses", async () => {
    const { setCachedResponse } = await import("../../src/lib/cache.js");
    const { redisBackend, postgresBackend } = await import("../../src/lib/cache/backends.js");

    await setCachedResponse(mockPrompt, mockMembers, undefined, [], "verdict", []);
    
    expect(postgresBackend.setSemantic).toHaveBeenCalled();
    expect(redisBackend.set).toHaveBeenCalled();
  });

  it("should handle embedding lock/concurrency", async () => {
    const { getEmbeddingWithLock } = await import("../../src/lib/cache.js");
    const { env } = await import("../../src/config/env.js");
    (env as any).OPENAI_API_KEY = "test-key";

    let callCount = 0;
    (global.fetch as any).mockImplementation(async () => {
      callCount++;
      await new Promise(r => setTimeout(r, 10));
      return {
        json: vi.fn().mockResolvedValue({ data: [{ embedding: [callCount] }] })
      };
    });

    // Fire two identical requests simultaneously
    const [res1, res2] = await Promise.all([
      getEmbeddingWithLock("same text"),
      getEmbeddingWithLock("same text")
    ]);

    expect(callCount).toBe(1); // Should only call fetch once
    expect(res1).toEqual(res2);
  });
});
