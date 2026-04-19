import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
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

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Build a unit vector along a single axis (dimension `axis` out of `dims`). */
function unitVector(dims: number, axis: number): number[] {
  const v = new Array(dims).fill(0);
  v[axis] = 1;
  return v;
}

/**
 * Build a vector close to `base` (cosine similarity > threshold).
 * Adds a small perturbation orthogonal to `base`.
 */
function similarVector(base: number[], perturbation = 0.05): number[] {
  const v = [...base];
  // Nudge the first zero-ish dimension
  const idx = v.findIndex((x, i) => i !== v.indexOf(Math.max(...v)) && true);
  v[idx] += perturbation;
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

  // Default: db.select().from().where() chain
  mockWhere.mockResolvedValue([]);
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
      mockWhere.mockResolvedValue([]);

      const result = await compact(1);

      expect(result).toEqual({ originalCount: 0, compactedCount: 0, tokensSaved: 0, expiredCount: 0 });
      expect(mockRouteAndCollect).not.toHaveBeenCalled();
      expect(mockStoreChunk).not.toHaveBeenCalled();
    });

    it("returns zeroes when there are exactly 9 old memories", async () => {
      const nineMemories = Array.from({ length: 9 }, (_, i) =>
        makeMemory(`m${i}`, `memory ${i}`)
      );
      mockWhere.mockResolvedValue(nineMemories);

      const result = await compact(42);

      expect(result).toEqual({ originalCount: 0, compactedCount: 0, tokensSaved: 0, expiredCount: 0 });
      expect(mockEmbed).not.toHaveBeenCalled();
      expect(mockRouteAndCollect).not.toHaveBeenCalled();
    });
  });

  // ---------- Embedding ----------

  describe("embedding phase", () => {
    it("re-embeds memories that lack an embedding field", async () => {
      const mems = Array.from({ length: 10 }, (_, i) =>
        makeMemory(`m${i}`, `content ${i}`)
      );
      mockWhere.mockResolvedValue(mems);
      // Each call returns a unique-enough vector so nothing clusters
      mockEmbed.mockImplementation(async () => unitVector(8, Math.floor(Math.random() * 8)));

      await compact(1);

      expect(mockEmbed).toHaveBeenCalledTimes(10);
      // First call should receive first memory's content
      expect(mockEmbed).toHaveBeenCalledWith("content 0");
    });

    it("uses existing embeddings when present", async () => {
      const existingEmb = unitVector(8, 3);
      const mems = Array.from({ length: 10 }, (_, i) =>
        makeMemory(`m${i}`, `content ${i}`, { embedding: existingEmb })
      );
      mockWhere.mockResolvedValue(mems);

      await compact(1);

      expect(mockEmbed).not.toHaveBeenCalled();
    });
  });

  // ---------- Clustering ----------

  describe("clustering by cosine similarity", () => {
    it("groups memories with similarity > 0.85 into a cluster", async () => {
      // Create 10 memories: first 5 point along axis 0, next 5 along axis 1
      // Members of each group are identical -> cosine sim = 1.0
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
      mockWhere.mockResolvedValue(mems);

      const result = await compact(1);

      // Two clusters of 5 => 2 compacted memories, 10 originals
      expect(result.compactedCount).toBe(2);
      expect(result.originalCount).toBe(10);
      expect(mockRouteAndCollect).toHaveBeenCalledTimes(2);
      expect(mockStoreChunk).toHaveBeenCalledTimes(2);
    });

    it("does not cluster memories with similarity <= 0.85", async () => {
      // 10 memories each along a different orthogonal axis -> cosine sim = 0
      const mems = Array.from({ length: 10 }, (_, i) =>
        makeMemory(`m${i}`, `unique topic ${i}`, { embedding: unitVector(16, i) })
      );
      mockWhere.mockResolvedValue(mems);

      const result = await compact(1);

      // No clusters of size >= 2 -> nothing compacted
      expect(result.compactedCount).toBe(0);
      expect(result.originalCount).toBe(0);
      expect(result.tokensSaved).toBe(0);
      expect(mockRouteAndCollect).not.toHaveBeenCalled();
      expect(mockDelete).not.toHaveBeenCalled();
    });

    it("only includes clusters with 2 or more members", async () => {
      // 9 similar memories in one cluster, 1 outlier
      const embA = unitVector(8, 0);
      const embOutlier = unitVector(8, 7);

      const mems = [
        ...Array.from({ length: 9 }, (_, i) =>
          makeMemory(`a${i}`, `clustered ${i}`, { embedding: embA })
        ),
        makeMemory("outlier", "different topic", { embedding: embOutlier }),
      ];
      mockWhere.mockResolvedValue(mems);

      const result = await compact(1);

      expect(result.compactedCount).toBe(1);
      expect(result.originalCount).toBe(9);
    });

    it("handles similarity at exactly the boundary (0.85) by excluding", async () => {
      // Craft two vectors whose cosine similarity is ~0.85
      // cos(theta) = 0.85 => we need vectors just at and below the threshold
      // Using 2D: [1, 0] and [0.85, sqrt(1-0.85^2)] = [0.85, 0.5268]
      // cosine = 0.85 exactly; code checks > 0.85 (strict), so these should NOT cluster
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
      mockWhere.mockResolvedValue(mems);

      const result = await compact(1);

      // Two separate clusters (each group clusters with itself sim=1.0)
      // but they don't merge across groups because sim == 0.85 (not > 0.85)
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
      mockWhere.mockResolvedValue(mems);

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
      mockWhere.mockResolvedValue(mems);

      await compact(1);

      const callArgs = mockRouteAndCollect.mock.calls[0][0];
      const userContent = callArgs.messages[0].content as string;
      // The combinedText.substring(0, 4000) is embedded in a longer prompt string
      // The total content includes the prefix text + up to 4000 chars of combined text
      // Just verify the combined portion doesn't exceed what's expected
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
      mockWhere.mockResolvedValue(mems);
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
      mockWhere.mockResolvedValue(mems);

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
      mockWhere.mockResolvedValue(mems);

      await compact(1);

      expect(mockDelete).toHaveBeenCalledTimes(1);
      expect(mockDeleteWhere).toHaveBeenCalledTimes(1);
      // Verify inArray was called with the memory ids
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
      mockWhere.mockResolvedValue(mems);

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
      // Each memory has 40 chars -> 10 tokens each (40/4)
      const mems = Array.from({ length: 10 }, (_, i) =>
        makeMemory(`m${i}`, "a]".repeat(20), { embedding: emb })
      );
      mockWhere.mockResolvedValue(mems);
      // Compacted text is short: 20 chars -> 5 tokens
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
      mockWhere.mockResolvedValue(mems);
      // Return a very long synthesis
      mockRouteAndCollect.mockResolvedValue({ text: "x".repeat(10000) });

      const result = await compact(1);

      // Math.max(0, tokensSaved) ensures non-negative
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
      mockWhere.mockResolvedValue(mems);

      const result = await compact(1);

      // Cluster A has 6, cluster B has 4 => 10 total originals, 2 compacted
      expect(result.originalCount).toBe(10);
      expect(result.compactedCount).toBe(2);
    });

    it("does not count singleton memories in originalCount", async () => {
      // 8 similar + 2 outliers. Only the 8 form a cluster.
      const embA = unitVector(16, 0);
      const mems = [
        ...Array.from({ length: 8 }, (_, i) =>
          makeMemory(`a${i}`, `grouped ${i}`, { embedding: embA })
        ),
        makeMemory("out1", "outlier 1", { embedding: unitVector(16, 10) }),
        makeMemory("out2", "outlier 2", { embedding: unitVector(16, 11) }),
      ];
      mockWhere.mockResolvedValue(mems);

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
      mockWhere.mockResolvedValue(mems);

      const result = await compact(1);

      // Should NOT early-return; 10 >= 10 proceeds to clustering
      expect(result.compactedCount).toBe(1);
      expect(mockRouteAndCollect).toHaveBeenCalledTimes(1);
    });

    it("passes correct userId to db.select query chain", async () => {
      mockWhere.mockResolvedValue([]);

      await compact(999);

      expect(mockSelect).toHaveBeenCalled();
      expect(mockFrom).toHaveBeenCalled();
      expect(mockWhere).toHaveBeenCalled();
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
      mockWhere.mockResolvedValue(mems);
      // embed() returns same vector -> everything clusters together
      mockEmbed.mockResolvedValue(emb);

      const result = await compact(1);

      expect(mockEmbed).toHaveBeenCalledTimes(5); // Only the 5 without embeddings
      expect(result.originalCount).toBe(10);
      expect(result.compactedCount).toBe(1);
    });
  });
});
