import {
  cacheGet,
  cacheSet,
  getMemberCache,
  setMemberCache,
  getCacheStats,
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
  });
});
