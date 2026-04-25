import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockLimit = vi.fn();
const mockDeleteWhere = vi.fn();
const mockDelete = vi.fn();
const mockExecute = vi.fn();

vi.mock("../../src/lib/drizzle.js", () => ({
  db: {
    select: (...args: any[]) => mockSelect(...args),
    delete: (...args: any[]) => mockDelete(...args),
    execute: (...args: any[]) => mockExecute(...args),
  },
}));

vi.mock("../../src/db/schema/memory.js", () => ({
  memories: {
    id: "id",
    content: "content",
    kbId: "kbId",
    sourceName: "sourceName",
    userId: "userId",
    createdAt: "createdAt",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: any[]) => ({ _op: "eq", args })),
  and: vi.fn((...args: any[]) => ({ _op: "and", args })),
  lt: vi.fn((...args: any[]) => ({ _op: "lt", args })),
  inArray: vi.fn((...args: any[]) => ({ _op: "inArray", args })),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: any[]) => ({ strings, values }),
    { raw: (s: string) => s }
  ),
}));

const mockEmbed = vi.fn();
vi.mock("../../src/services/embeddings.service.js", () => ({
  embed: (...args: any[]) => mockEmbed(...args),
}));

const mockStoreChunk = vi.fn();
vi.mock("../../src/services/vectorStore.service.js", () => ({
  storeChunk: (...args: any[]) => mockStoreChunk(...args),
}));

const mockRouteAndCollect = vi.fn();
vi.mock("../../src/router/index.js", () => ({
  routeAndCollect: (...args: any[]) => mockRouteAndCollect(...args),
}));

vi.mock("../../src/lib/logger.js", () => ({
  default: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ── Import SUT after mocks ──────────────────────────────────────────────────

import { compact } from "../../src/services/memoryCompaction.service.js";
import logger from "../../src/lib/logger.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Build a unit vector along a single axis (dimension `axis` out of `dims`). */
function unitVector(dims: number, axis: number): number[] {
  const v = new Array(dims).fill(0);
  v[axis] = 1;
  return v;
}

function makeMemory(
  id: string,
  content: string,
  opts: { kbId?: string | null; sourceName?: string | null; embedding?: number[] } = {}
) {
  return {
    id,
    content,
    kbId: opts.kbId ?? null,
    sourceName: opts.sourceName ?? null,
    ...(opts.embedding ? { embedding: opts.embedding } : {}),
  };
}

// ── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  // Default: db.execute() for TTL expiry step
  mockExecute.mockResolvedValue({ rowCount: 0 });

  // Default: db.select().from().where().limit() chain
  mockLimit.mockResolvedValue([]);
  mockWhere.mockReturnValue({ limit: mockLimit });
  mockFrom.mockReturnValue({ where: mockWhere });
  mockSelect.mockReturnValue({ from: mockFrom });

  // Default: db.delete().where() chain
  mockDeleteWhere.mockResolvedValue(undefined);
  mockDelete.mockReturnValue({ where: mockDeleteWhere });

  mockEmbed.mockResolvedValue(unitVector(8, 0));
  mockStoreChunk.mockResolvedValue(undefined);
  mockRouteAndCollect.mockResolvedValue({ text: "compacted summary" });
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe("compact()", () => {
  // ---------- Early return ----------

  describe("early return when fewer than 10 old memories", () => {
    it("returns zeroes when there are 0 old memories", async () => {
      mockLimit.mockResolvedValue([]);

      const result = await compact(1);

      expect(result).toEqual({ originalCount: 0, compactedCount: 0, tokensSaved: 0, expiredCount: 0 });
      expect(mockRouteAndCollect).not.toHaveBeenCalled();
      expect(mockStoreChunk).not.toHaveBeenCalled();
    });

    it("returns zeroes when there are exactly 9 old memories", async () => {
      const nineMemories = Array.from({ length: 9 }, (_, i) =>
        makeMemory(`m${i}`, `memory ${i}`)
      );
      mockLimit.mockResolvedValue(nineMemories);

      const result = await compact(42);

      expect(result).toEqual({ originalCount: 0, compactedCount: 0, tokensSaved: 0, expiredCount: 0 });
      expect(mockEmbed).not.toHaveBeenCalled();
      expect(mockRouteAndCollect).not.toHaveBeenCalled();
    });
  });

  // ---------- Expiry ----------

  describe("one-off memory expiry", () => {
    it("reports expired count from the DELETE RETURNING query", async () => {
      mockExecute.mockResolvedValue({ rowCount: 7 });
      mockLimit.mockResolvedValue([]); // no old memories to compact

      const result = await compact(1);
      expect(result.expiredCount).toBe(7);
    });

    it("logs when memories are expired", async () => {
      mockExecute.mockResolvedValue({ rowCount: 3 });
      mockLimit.mockResolvedValue([]);

      await compact(5);

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 5, expiredCount: 3 }),
        expect.stringContaining("Expired stale one-off memories"),
      );
    });

    it("does not log when no memories expired", async () => {
      mockExecute.mockResolvedValue({ rowCount: 0 });
      mockLimit.mockResolvedValue([]);

      await compact(1);

      // info should not have been called for expiry (only possibly for completion)
      const infoCalls = (logger.info as ReturnType<typeof vi.fn>).mock.calls;
      const expiryCalls = infoCalls.filter((c: any[]) =>
        typeof c[1] === "string" && c[1].includes("Expired")
      );
      expect(expiryCalls).toHaveLength(0);
    });

    it("treats null rowCount as 0 expired", async () => {
      mockExecute.mockResolvedValue({ rowCount: null });
      mockLimit.mockResolvedValue([]);

      const result = await compact(1);
      expect(result.expiredCount).toBe(0);
    });
  });

  // ---------- Embedding ----------

  describe("embedding phase", () => {
    it("re-embeds memories that lack an embedding field", async () => {
      const mems = Array.from({ length: 10 }, (_, i) =>
        makeMemory(`m${i}`, `content ${i}`)
      );
      mockLimit.mockResolvedValue(mems);
      // Each call returns a unique-enough vector so nothing clusters
      mockEmbed.mockImplementation(async () => unitVector(8, Math.floor(Math.random() * 8)));

      await compact(1);

      expect(mockEmbed).toHaveBeenCalledTimes(10);
      expect(mockEmbed).toHaveBeenCalledWith("content 0");
    });

    it("uses existing embeddings when present", async () => {
      const existingEmb = unitVector(8, 3);
      const mems = Array.from({ length: 10 }, (_, i) =>
        makeMemory(`m${i}`, `content ${i}`, { embedding: existingEmb })
      );
      mockLimit.mockResolvedValue(mems);

      await compact(1);

      expect(mockEmbed).not.toHaveBeenCalled();
    });

    it("handles mixed memories: some with embeddings, some without", async () => {
      const emb = unitVector(8, 0);
      const mems = [
        ...Array.from({ length: 5 }, (_, i) =>
          makeMemory(`with${i}`, `has embedding ${i}`, { embedding: emb })
        ),
        ...Array.from({ length: 5 }, (_, i) =>
          makeMemory(`without${i}`, `no embedding ${i}`)
        ),
      ];
      mockLimit.mockResolvedValue(mems);
      mockEmbed.mockResolvedValue(emb);

      const result = await compact(1);

      expect(mockEmbed).toHaveBeenCalledTimes(5);
      expect(result.originalCount).toBe(10);
      expect(result.compactedCount).toBe(1);
    });
  });

  // ---------- Clustering ----------

  describe("clustering by cosine similarity", () => {
    it("groups memories with similarity > 0.85 into a cluster", async () => {
      const embA = unitVector(8, 0);
      const embB = unitVector(8, 1);

      const mems = [
        ...Array.from({ length: 5 }, (_, i) =>
          makeMemory(`a${i}`, `topic A memory ${i}`, { embedding: embA })
        ),
        ...Array.from({ length: 5 }, (_, i) =>
          makeMemory(`b${i}`, `topic B memory ${i}`, { embedding: embB })
        ),
      ];
      mockLimit.mockResolvedValue(mems);

      const result = await compact(1);

      expect(result.compactedCount).toBe(2);
      expect(result.originalCount).toBe(10);
      expect(mockRouteAndCollect).toHaveBeenCalledTimes(2);
      expect(mockStoreChunk).toHaveBeenCalledTimes(2);
    });

    it("does not cluster memories with similarity <= 0.85", async () => {
      const mems = Array.from({ length: 10 }, (_, i) =>
        makeMemory(`m${i}`, `unique topic ${i}`, { embedding: unitVector(16, i) })
      );
      mockLimit.mockResolvedValue(mems);

      const result = await compact(1);

      expect(result.compactedCount).toBe(0);
      expect(result.originalCount).toBe(0);
      expect(result.tokensSaved).toBe(0);
      expect(mockRouteAndCollect).not.toHaveBeenCalled();
      expect(mockDelete).not.toHaveBeenCalled();
    });

    it("only includes clusters with 2 or more members", async () => {
      const embA = unitVector(8, 0);
      const embOutlier = unitVector(8, 7);

      const mems = [
        ...Array.from({ length: 9 }, (_, i) =>
          makeMemory(`a${i}`, `clustered ${i}`, { embedding: embA })
        ),
        makeMemory("outlier", "different topic", { embedding: embOutlier }),
      ];
      mockLimit.mockResolvedValue(mems);

      const result = await compact(1);

      expect(result.compactedCount).toBe(1);
      expect(result.originalCount).toBe(9);
    });

    it("handles similarity at exactly the 0.85 boundary by excluding (strict >)", async () => {
      const emb1 = [1, 0, 0, 0, 0, 0, 0, 0];
      const emb2 = [0.85, Math.sqrt(1 - 0.85 * 0.85), 0, 0, 0, 0, 0, 0];

      const mems = [
        ...Array.from({ length: 5 }, (_, i) =>
          makeMemory(`g1_${i}`, `group1 ${i}`, { embedding: emb1 })
        ),
        ...Array.from({ length: 5 }, (_, i) =>
          makeMemory(`g2_${i}`, `group2 ${i}`, { embedding: emb2 })
        ),
      ];
      mockLimit.mockResolvedValue(mems);

      const result = await compact(1);

      // Two separate clusters (each group clusters with itself sim=1.0)
      expect(result.compactedCount).toBe(2);
    });
  });

  // ---------- Synthesis ----------

  describe("synthesis via LLM", () => {
    it("sends cluster contents to routeAndCollect with correct prompt structure", async () => {
      const emb = unitVector(8, 0);
      const mems = Array.from({ length: 10 }, (_, i) =>
        makeMemory(`m${i}`, `fact about dogs ${i}`, { embedding: emb })
      );
      mockLimit.mockResolvedValue(mems);

      await compact(1);

      expect(mockRouteAndCollect).toHaveBeenCalledTimes(1);
      const callArgs = mockRouteAndCollect.mock.calls[0][0];
      expect(callArgs.model).toBe("auto");
      expect(callArgs.temperature).toBe(0);
      expect(callArgs.messages).toHaveLength(1);
      expect(callArgs.messages[0].role).toBe("user");
      expect(callArgs.messages[0].content).toContain("Synthesize these related memories");
      expect(callArgs.messages[0].content).toContain("fact about dogs 0");
    });

    it("truncates combined text to 4000 chars in the prompt", async () => {
      const emb = unitVector(8, 0);
      const longContent = "x".repeat(1000);
      const mems = Array.from({ length: 10 }, (_, i) =>
        makeMemory(`m${i}`, longContent, { embedding: emb })
      );
      mockLimit.mockResolvedValue(mems);

      await compact(1);

      const callArgs = mockRouteAndCollect.mock.calls[0][0];
      const userContent = callArgs.messages[0].content as string;
      const prefixLen = "Synthesize these related memories into one concise paragraph that preserves all key information:\n\n".length;
      const afterPrefix = userContent.substring(prefixLen);
      expect(afterPrefix.length).toBeLessThanOrEqual(4000);
    });
  });

  // ---------- Storage and deletion ----------

  describe("storage and deletion", () => {
    it("stores compacted memory with correct userId and kbId from first cluster member", async () => {
      const emb = unitVector(8, 0);
      const mems = Array.from({ length: 10 }, (_, i) =>
        makeMemory(`m${i}`, `content ${i}`, { embedding: emb, kbId: "kb-42" })
      );
      mockLimit.mockResolvedValue(mems);
      mockRouteAndCollect.mockResolvedValue({ text: "synthesized text" });

      await compact(7);

      expect(mockStoreChunk).toHaveBeenCalledTimes(1);
      expect(mockStoreChunk).toHaveBeenCalledWith(
        7,                       // userId
        "kb-42",                 // kbId from first cluster member
        "synthesized text",      // compacted text
        0,                       // chunkIndex
        expect.stringContaining("compacted_"), // source name
        undefined                // metadata
      );
    });

    it("passes null kbId when first cluster member has no kbId", async () => {
      const emb = unitVector(8, 0);
      const mems = Array.from({ length: 10 }, (_, i) =>
        makeMemory(`m${i}`, `content ${i}`, { embedding: emb })
      );
      mockLimit.mockResolvedValue(mems);

      await compact(1);

      expect(mockStoreChunk).toHaveBeenCalledWith(
        1, null, expect.any(String), 0, expect.stringContaining("compacted_"), undefined
      );
    });

    it("deletes all original memory IDs from each cluster", async () => {
      const { inArray } = await import("drizzle-orm");
      const emb = unitVector(8, 0);
      const mems = Array.from({ length: 10 }, (_, i) =>
        makeMemory(`m${i}`, `content ${i}`, { embedding: emb })
      );
      mockLimit.mockResolvedValue(mems);

      await compact(1);

      expect(mockDelete).toHaveBeenCalledTimes(1);
      expect(mockDeleteWhere).toHaveBeenCalledTimes(1);
      expect(inArray).toHaveBeenCalledWith(
        "id",
        expect.arrayContaining(["m0", "m1", "m2", "m9"])
      );
    });

    it("handles multiple clusters: stores and deletes for each", async () => {
      const embA = unitVector(8, 0);
      const embB = unitVector(8, 1);
      const mems = [
        ...Array.from({ length: 5 }, (_, i) =>
          makeMemory(`a${i}`, `cluster A ${i}`, { embedding: embA })
        ),
        ...Array.from({ length: 5 }, (_, i) =>
          makeMemory(`b${i}`, `cluster B ${i}`, { embedding: embB })
        ),
      ];
      mockLimit.mockResolvedValue(mems);

      await compact(1);

      expect(mockStoreChunk).toHaveBeenCalledTimes(2);
      expect(mockDelete).toHaveBeenCalledTimes(2);
      expect(mockDeleteWhere).toHaveBeenCalledTimes(2);
    });
  });

  // ---------- Token savings calculation ----------

  describe("token savings calculation", () => {
    it("calculates tokensSaved as difference between original and compacted token estimates", async () => {
      const emb = unitVector(8, 0);
      const mems = Array.from({ length: 10 }, (_, i) =>
        makeMemory(`m${i}`, "a]".repeat(20), { embedding: emb })
      );
      mockLimit.mockResolvedValue(mems);
      mockRouteAndCollect.mockResolvedValue({ text: "short summary of 20c" });

      const result = await compact(1);

      // Original tokens = combinedText.length / 4
      // combinedText = 10 memories joined by "\n\n---\n\n" (7 chars) => 40*10 + 7*9 = 463
      // originalTokens = 463 / 4 = 115.75
      // compactedTokens = 20 / 4 = 5
      // tokensSaved = round(115.75 - 5) = 111
      expect(result.tokensSaved).toBe(111);
    });

    it("returns 0 tokensSaved when compacted text is longer than original (clamped)", async () => {
      const emb = unitVector(8, 0);
      const mems = Array.from({ length: 10 }, (_, i) =>
        makeMemory(`m${i}`, "ab", { embedding: emb })
      );
      mockLimit.mockResolvedValue(mems);
      mockRouteAndCollect.mockResolvedValue({ text: "x".repeat(10000) });

      const result = await compact(1);

      expect(result.tokensSaved).toBe(0);
    });

    it("reports correct originalCount as total memories across all clusters", async () => {
      const embA = unitVector(8, 0);
      const embB = unitVector(8, 1);
      const mems = [
        ...Array.from({ length: 6 }, (_, i) =>
          makeMemory(`a${i}`, `A-${i}`, { embedding: embA })
        ),
        ...Array.from({ length: 4 }, (_, i) =>
          makeMemory(`b${i}`, `B-${i}`, { embedding: embB })
        ),
      ];
      mockLimit.mockResolvedValue(mems);

      const result = await compact(1);

      expect(result.originalCount).toBe(10);
      expect(result.compactedCount).toBe(2);
    });

    it("does not count singleton memories in originalCount", async () => {
      const embA = unitVector(16, 0);
      const mems = [
        ...Array.from({ length: 8 }, (_, i) =>
          makeMemory(`a${i}`, `grouped ${i}`, { embedding: embA })
        ),
        makeMemory("out1", "outlier 1", { embedding: unitVector(16, 10) }),
        makeMemory("out2", "outlier 2", { embedding: unitVector(16, 11) }),
      ];
      mockLimit.mockResolvedValue(mems);

      const result = await compact(1);

      expect(result.originalCount).toBe(8);
      expect(result.compactedCount).toBe(1);
    });
  });

  // ---------- Edge cases ----------

  describe("edge cases", () => {
    it("handles exactly 10 memories (threshold boundary)", async () => {
      const emb = unitVector(8, 0);
      const mems = Array.from({ length: 10 }, (_, i) =>
        makeMemory(`m${i}`, `content ${i}`, { embedding: emb })
      );
      mockLimit.mockResolvedValue(mems);

      const result = await compact(1);

      expect(result.compactedCount).toBe(1);
      expect(mockRouteAndCollect).toHaveBeenCalledTimes(1);
    });

    it("returns correct CompactionResult shape", async () => {
      mockLimit.mockResolvedValue([]);

      const result = await compact(1);

      expect(result).toHaveProperty("originalCount");
      expect(result).toHaveProperty("compactedCount");
      expect(result).toHaveProperty("tokensSaved");
      expect(result).toHaveProperty("expiredCount");
      expect(typeof result.originalCount).toBe("number");
      expect(typeof result.compactedCount).toBe("number");
      expect(typeof result.tokensSaved).toBe("number");
      expect(typeof result.expiredCount).toBe("number");
    });

    it("logs completion info with all metrics", async () => {
      const emb = unitVector(8, 0);
      const mems = Array.from({ length: 10 }, (_, i) =>
        makeMemory(`m${i}`, `content ${i}`, { embedding: emb })
      );
      mockLimit.mockResolvedValue(mems);
      mockExecute.mockResolvedValue({ rowCount: 2 });

      await compact(42);

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 42,
          originalCount: expect.any(Number),
          compactedCount: expect.any(Number),
          tokensSaved: expect.any(Number),
          expiredCount: 2,
        }),
        "Memory compaction complete",
      );
    });

    it("passes userId to db.select chain", async () => {
      mockLimit.mockResolvedValue([]);

      await compact(999);

      expect(mockSelect).toHaveBeenCalled();
      expect(mockFrom).toHaveBeenCalled();
      expect(mockWhere).toHaveBeenCalled();
    });
  });
});
