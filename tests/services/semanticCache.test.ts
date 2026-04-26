import {
  cacheGet,
  cacheSet,
  getMemberCache,
  setMemberCache,
  getCacheStats,
  flushUserCache,
} from "../../src/services/semanticCache.service.js";
import { vi, describe, it, expect, beforeEach } from "vitest";

// Mock Redis and DB for unit tests
vi.mock("../../src/lib/redis.js", () => ({
  default: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue("OK"),
    incr: vi.fn().mockResolvedValue(1),
    del: vi.fn().mockResolvedValue(1),
  },
}));

vi.mock("../../src/lib/drizzle.js", () => ({
  db: {
    execute: vi.fn().mockResolvedValue({ rows: [] }),
  },
}));

vi.mock("../../src/services/embeddings.service.js", () => ({
  embed: vi.fn().mockResolvedValue(new Array(1536).fill(0.1)),
}));

vi.mock("../../src/services/vectorStore.service.js", () => ({
  safeVectorLiteral: vi.fn().mockReturnValue("[0.1,0.1]"),
}));

describe("semanticCache.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ENABLE_SEMANTIC_CACHE = "true";
  });

  describe("cacheGet", () => {
    it("returns hit=false on L1 miss and L2 miss", async () => {
      const result = await cacheGet("What is 2+2?", 1, ["member-a"], "gpt-4o");
      expect(result.hit).toBe(false);
      expect(result.level).toBeNull();
    });

    it("returns hit=false when ENABLE_SEMANTIC_CACHE=false", async () => {
      process.env.ENABLE_SEMANTIC_CACHE = "false";
      const result = await cacheGet("What is 2+2?", 1, ["member-a"], "gpt-4o");
      expect(result.hit).toBe(false);
    });
  });

  describe("cacheSet / cacheGet L1 flow", () => {
    it("stores and retrieves via L1 exact cache", async () => {
      const { default: redis } = await import("../../src/lib/redis.js");
      (redis.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce("Cached response");

      const result = await cacheGet("What is 2+2?", 1, ["member-a"], "gpt-4o");
      expect(result.hit).toBe(true);
      expect(result.level).toBe("L1");
      expect(result.response).toBe("Cached response");
    });
  });

  describe("L3 member cache", () => {
    it("returns null when member is not cached", async () => {
      const entry = await getMemberCache("test query", "member-a", "gpt-4o");
      expect(entry).toBeNull();
    });

    it("stores and retrieves member cache entries", async () => {
      const { default: redis } = await import("../../src/lib/redis.js");
      const mockEntry = {
        memberId: "member-a",
        model: "gpt-4o",
        response: "The answer is 4.",
        usage: { prompt_tokens: 10, completion_tokens: 6 },
      };
      (redis.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(JSON.stringify(mockEntry));

      const result = await getMemberCache("What is 2+2?", "member-a", "gpt-4o");
      expect(result).not.toBeNull();
      expect(result?.response).toBe("The answer is 4.");
    });

    it("skips storing when cache is disabled", async () => {
      process.env.ENABLE_SEMANTIC_CACHE = "false";
      const { default: redis } = await import("../../src/lib/redis.js");
      await setMemberCache("test", {
        memberId: "x", model: "y", response: "z",
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      });
      expect(redis.set).not.toHaveBeenCalled();
    });
  });

  describe("getCacheStats", () => {
    it("returns zeroed stats when Redis has no counters", async () => {
      const stats = await getCacheStats();
      expect(stats.hitRate).toBe(0);
      expect(stats.l1Hits).toBe(0);
      expect(stats.misses).toBe(0);
    });

    it("computes hit rate correctly", async () => {
      const { default: redis } = await import("../../src/lib/redis.js");
      (redis.get as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce("80")  // l1
        .mockResolvedValueOnce("10")  // l2
        .mockResolvedValueOnce("0")   // l3
        .mockResolvedValueOnce("10"); // misses

      const stats = await getCacheStats();
      expect(stats.hitRate).toBeCloseTo(0.9, 2);
    });

    it("computes hitRate as 0 when total is 0 (no division by zero)", async () => {
      // All redis.get calls return null (zeroed counters)
      const stats = await getCacheStats();
      expect(stats.hitRate).toBe(0);
      expect(stats.l1Hits).toBe(0);
      expect(stats.l2Hits).toBe(0);
      expect(stats.l3Hits).toBe(0);
      expect(stats.misses).toBe(0);
    });

    it("returns zeroed stats when Redis throws", async () => {
      const { default: redis } = await import("../../src/lib/redis.js");
      (redis.get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("redis down"));

      const stats = await getCacheStats();
      expect(stats.hitRate).toBe(0);
      expect(stats.l1Hits).toBe(0);
    });
  });

  describe("cacheGet — L2 semantic hit path", () => {
    it("returns L2 hit when the db returns a row with similarity above threshold", async () => {
      const { default: redis } = await import("../../src/lib/redis.js");
      const { db } = await import("../../src/lib/drizzle.js");

      // L1 miss
      (redis.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
      // L2 hit: similarity 0.95 ≥ 0.92 threshold
      (db.execute as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ rows: [{ response: "L2 cached answer", similarity: 0.95 }] })
        .mockResolvedValueOnce({ rows: [] }); // fire-and-forget hitCount UPDATE

      const result = await cacheGet("What is semantic search?", 1, ["member-a"], "gpt-4o");

      expect(result.hit).toBe(true);
      expect(result.level).toBe("L2");
      expect(result.response).toBe("L2 cached answer");
      expect(result.similarity).toBe(0.95);
    });

    it("promotes an L2 hit to L1 by calling redis.set", async () => {
      const { default: redis } = await import("../../src/lib/redis.js");
      const { db } = await import("../../src/lib/drizzle.js");

      (redis.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
      (db.execute as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ rows: [{ response: "promoted response", similarity: 0.93 }] })
        .mockResolvedValueOnce({ rows: [] });

      await cacheGet("a semantic query", 1, ["member-a"], "gpt-4o");

      expect(redis.set).toHaveBeenCalledWith(
        expect.stringMatching(/^sc:l1:/),
        "promoted response",
        expect.objectContaining({ EX: expect.any(Number) }),
      );
    });

    it("increments l2_hits counter after an L2 hit", async () => {
      const { default: redis } = await import("../../src/lib/redis.js");
      const { db } = await import("../../src/lib/drizzle.js");

      (redis.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
      (db.execute as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ rows: [{ response: "resp", similarity: 0.94 }] })
        .mockResolvedValueOnce({ rows: [] });

      await cacheGet("l2 trigger", 1, ["m"], "model");

      expect(redis.incr).toHaveBeenCalledWith("sc:stats:l2_hits");
    });

    it("returns miss when L1 misses and L2 returns no rows", async () => {
      const { default: redis } = await import("../../src/lib/redis.js");
      const { db } = await import("../../src/lib/drizzle.js");

      (redis.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
      (db.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: [] });

      const result = await cacheGet("unseen query", 1, ["m"], "model");
      expect(result.hit).toBe(false);
      expect(result.level).toBeNull();
    });

    it("increments misses counter after a full miss", async () => {
      const { default: redis } = await import("../../src/lib/redis.js");
      const { db } = await import("../../src/lib/drizzle.js");

      (redis.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
      (db.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: [] });

      await cacheGet("miss query", 1, ["m"], "model");

      expect(redis.incr).toHaveBeenCalledWith("sc:stats:misses");
    });
  });

  describe("cacheSet", () => {
    it("stores to L1 (redis.set) and L2 (db.execute) in parallel", async () => {
      const { default: redis } = await import("../../src/lib/redis.js");
      const { db } = await import("../../src/lib/drizzle.js");

      await cacheSet("query text", "response text", 1, ["member-a"], "gpt-4o");

      expect(redis.set).toHaveBeenCalledWith(
        expect.stringMatching(/^sc:l1:/),
        "response text",
        expect.objectContaining({ EX: 3600 }),
      );
      expect(db.execute).toHaveBeenCalled();
    });

    it("does nothing when ENABLE_SEMANTIC_CACHE=false", async () => {
      process.env.ENABLE_SEMANTIC_CACHE = "false";
      const { default: redis } = await import("../../src/lib/redis.js");
      const { db } = await import("../../src/lib/drizzle.js");

      await cacheSet("query", "response", 1, ["member-a"], "gpt-4o");

      expect(redis.set).not.toHaveBeenCalled();
      expect(db.execute).not.toHaveBeenCalled();
    });
  });

  describe("flushUserCache", () => {
    it("executes a DELETE query targeting the user's cache entries", async () => {
      const { db } = await import("../../src/lib/drizzle.js");

      await flushUserCache(42);

      expect(db.execute).toHaveBeenCalledTimes(1);
      const sqlArg = (db.execute as ReturnType<typeof vi.fn>).mock.calls[0][0];
      // The SQL should reference the userId 42
      expect(JSON.stringify(sqlArg)).toContain("42");
    });

    it("does not throw when db.execute rejects (swallows the error)", async () => {
      const { db } = await import("../../src/lib/drizzle.js");
      (db.execute as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("db down"));

      await expect(flushUserCache(1)).resolves.not.toThrow();
    });
  });

  describe("query normalisation determinism", () => {
    it("same query with different casing produces the same L1 cache key", async () => {
      const { default: redis } = await import("../../src/lib/redis.js");
      const { db } = await import("../../src/lib/drizzle.js");

      // Both queries should miss — we just want to compare the keys looked up
      (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (db.execute as ReturnType<typeof vi.fn>).mockResolvedValue({ rows: [] });

      await cacheGet("What is AI?", 1, ["member-a"], "gpt-4o");
      await cacheGet("WHAT IS AI?", 1, ["member-a"], "gpt-4o");

      // L1 lookup: first cacheGet → calls[0], second cacheGet → calls[1]
      const key1 = (redis.get as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const key2 = (redis.get as ReturnType<typeof vi.fn>).mock.calls[1][0];
      expect(key1).toBe(key2);
    });

    it("same query with extra whitespace produces the same L1 cache key", async () => {
      const { default: redis } = await import("../../src/lib/redis.js");
      const { db } = await import("../../src/lib/drizzle.js");

      (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (db.execute as ReturnType<typeof vi.fn>).mockResolvedValue({ rows: [] });

      await cacheGet("what is ai?", 1, ["m"], "model");
      await cacheGet("  what   is  ai?  ", 1, ["m"], "model");

      const key1 = (redis.get as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const key2 = (redis.get as ReturnType<typeof vi.fn>).mock.calls[1][0];
      expect(key1).toBe(key2);
    });

    it("configFingerprint is order-independent for council member IDs", async () => {
      const { default: redis } = await import("../../src/lib/redis.js");
      const { db } = await import("../../src/lib/drizzle.js");

      (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (db.execute as ReturnType<typeof vi.fn>).mockResolvedValue({ rows: [] });

      await cacheGet("test query", 1, ["member-b", "member-a"], "gpt-4o");
      await cacheGet("test query", 1, ["member-a", "member-b"], "gpt-4o");

      const key1 = (redis.get as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const key2 = (redis.get as ReturnType<typeof vi.fn>).mock.calls[1][0];
      expect(key1).toBe(key2);
    });

    it("different models produce different L1 cache keys", async () => {
      const { default: redis } = await import("../../src/lib/redis.js");
      const { db } = await import("../../src/lib/drizzle.js");

      (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (db.execute as ReturnType<typeof vi.fn>).mockResolvedValue({ rows: [] });

      await cacheGet("same query", 1, ["m"], "gpt-4o");
      await cacheGet("same query", 1, ["m"], "claude-3");

      const key1 = (redis.get as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const key2 = (redis.get as ReturnType<typeof vi.fn>).mock.calls[1][0];
      expect(key1).not.toBe(key2);
    });

    it("different users produce different L2 query params (userId scoped)", async () => {
      const { default: redis } = await import("../../src/lib/redis.js");
      const { db } = await import("../../src/lib/drizzle.js");

      (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (db.execute as ReturnType<typeof vi.fn>).mockResolvedValue({ rows: [] });

      await cacheGet("same query", 1, ["m"], "model");
      await cacheGet("same query", 2, ["m"], "model");

      const l2Call1 = JSON.stringify((db.execute as ReturnType<typeof vi.fn>).mock.calls[0][0]);
      const l2Call2 = JSON.stringify((db.execute as ReturnType<typeof vi.fn>).mock.calls[1][0]);
      // userId 1 vs userId 2 should appear in different L2 queries
      expect(l2Call1).toContain("1");
      expect(l2Call2).toContain("2");
    });
  });
});
