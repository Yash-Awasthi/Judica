import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockExecute = vi.fn();

vi.mock("../../src/lib/drizzle.js", () => ({
  db: { execute: (...args: any[]) => mockExecute(...args) },
}));

vi.mock("drizzle-orm", () => {
  // Return a tagged-template function that captures its arguments for assertions
  const sqlTag = (strings: TemplateStringsArray, ...values: any[]) => ({
    _tag: "sql",
    strings: Array.from(strings),
    values,
  });
  sqlTag.raw = (s: string) => ({ _tag: "sql.raw", value: s });
  return { sql: sqlTag };
});

const mockEmbed = vi.fn();
vi.mock("../../src/services/embeddings.service.js", () => ({
  embed: (...args: any[]) => mockEmbed(...args),
}));

vi.mock("../../src/lib/logger.js", () => ({
  default: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockRouteAndCollect = vi.fn();
vi.mock("../../src/router/index.js", () => ({
  routeAndCollect: (...args: any[]) => mockRouteAndCollect(...args),
}));

// ── Import SUT after mocks ──────────────────────────────────────────────────

import {
  storeChunk,
  searchSimilar,
  keywordSearch,
  hybridSearch,
  deleteKBChunks,
  deleteDocChunks,
  safeVectorLiteral,
  enrichWithParentContext,
  hydeSearch,
  enhancedHybridSearch,
} from "../../src/services/vectorStore.service.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

const FAKE_EMBEDDING = [0.1, 0.2, 0.3];

function makeChunk(overrides: Partial<{ id: string; content: string; sourceName: string | null; sourceUrl: string | null; score: number }> = {}) {
  return {
    id: overrides.id ?? "chunk-1",
    content: overrides.content ?? "some content",
    sourceName: overrides.sourceName ?? "doc.pdf",
    sourceUrl: overrides.sourceUrl ?? null,
    score: overrides.score ?? 0.9,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("vectorStore.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEmbed.mockResolvedValue(FAKE_EMBEDDING);
    mockRouteAndCollect.mockResolvedValue({ text: "Hypothetical document answer." });
  });

  // ── storeChunk ──────────────────────────────────────────────────────────

  describe("storeChunk", () => {
    it("embeds the content and inserts a row, returning the generated id", async () => {
      mockExecute.mockResolvedValue({ rows: [{ id: "uuid-abc" }] });

      const id = await storeChunk(1, "kb-1", "hello world", 0, "file.txt", "https://example.com");

      expect(mockEmbed).toHaveBeenCalledWith("hello world");
      expect(mockExecute).toHaveBeenCalledTimes(1);
      expect(id).toBe("uuid-abc");

      // Verify the SQL template received the correct bound values
      const sqlObj = mockExecute.mock.calls[0][0];
      expect(sqlObj.values).toContain(1);          // userId
      expect(sqlObj.values).toContain("kb-1");     // kbId
      expect(sqlObj.values).toContain("hello world"); // content
      expect(sqlObj.values).toContain(0);           // chunkIndex
    });

    it("passes null for optional sourceName and sourceUrl when omitted", async () => {
      mockExecute.mockResolvedValue({ rows: [{ id: "uuid-def" }] });

      await storeChunk(2, null, "text", 3);

      const sqlObj = mockExecute.mock.calls[0][0];
      // sourceName and sourceUrl should resolve to null
      expect(sqlObj.values).toContain(null);
    });

    it("builds the correct vector string from the embedding", async () => {
      mockEmbed.mockResolvedValue([0.5, -0.3, 0.7]);
      mockExecute.mockResolvedValue({ rows: [{ id: "uuid-vec" }] });

      await storeChunk(1, "kb-1", "data", 0);

      const sqlObj = mockExecute.mock.calls[0][0];
      expect(sqlObj.values).toContain("[0.5,-0.3,0.7]");
    });

    it("propagates errors from embed()", async () => {
      mockEmbed.mockRejectedValue(new Error("embed failed"));

      await expect(storeChunk(1, "kb-1", "x", 0)).rejects.toThrow("embed failed");
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it("propagates errors from db.execute()", async () => {
      mockExecute.mockRejectedValue(new Error("db error"));

      await expect(storeChunk(1, "kb-1", "x", 0)).rejects.toThrow("db error");
    });
  });

  // ── searchSimilar ───────────────────────────────────────────────────────

  describe("searchSimilar", () => {
    it("embeds the query and returns scored chunks", async () => {
      const rows = [makeChunk({ id: "a", score: 0.95 }), makeChunk({ id: "b", score: 0.8 })];
      mockExecute.mockResolvedValue({ rows });

      const results = await searchSimilar(1, "find me");

      expect(mockEmbed).toHaveBeenCalledWith("find me");
      expect(results).toEqual(rows);
    });

    it("uses the default limit of 5", async () => {
      mockExecute.mockResolvedValue({ rows: [] });
      await searchSimilar(1, "q");

      const sqlObj = mockExecute.mock.calls[0][0];
      expect(sqlObj.values).toContain(5);
    });

    it("respects a custom limit", async () => {
      mockExecute.mockResolvedValue({ rows: [] });
      await searchSimilar(1, "q", null, 20);

      const sqlObj = mockExecute.mock.calls[0][0];
      expect(sqlObj.values).toContain(20);
    });

    it("filters by kbId when provided", async () => {
      mockExecute.mockResolvedValue({ rows: [] });
      await searchSimilar(1, "q", "kb-42");

      const sqlObj = mockExecute.mock.calls[0][0];
      // kbId ends up inside a nested sql fragment from the kbCondition
      const flat = JSON.stringify(sqlObj.values);
      expect(flat).toContain("kb-42");
    });

    it("does not include kbId filter when kbId is undefined", async () => {
      mockExecute.mockResolvedValue({ rows: [] });
      await searchSimilar(1, "q");

      const sqlObj = mockExecute.mock.calls[0][0];
      // userId, vectorStr, limit -- no kbId
      const nonSqlValues = sqlObj.values.filter((v: any) => typeof v === "string" && v !== `[${FAKE_EMBEDDING.join(",")}]`);
      expect(nonSqlValues).not.toContain("kb-42");
    });
  });

  // ── keywordSearch ───────────────────────────────────────────────────────

  describe("keywordSearch", () => {
    it("does NOT call embed() -- purely text-based search", async () => {
      mockExecute.mockResolvedValue({ rows: [] });
      await keywordSearch(1, "keyword query");

      expect(mockEmbed).not.toHaveBeenCalled();
    });

    it("returns matching rows with ts_rank scores", async () => {
      const rows = [makeChunk({ id: "kw-1", score: 3.2 })];
      mockExecute.mockResolvedValue({ rows });

      const results = await keywordSearch(1, "keyword query");
      expect(results).toEqual(rows);
    });

    it("uses the default limit of 10", async () => {
      mockExecute.mockResolvedValue({ rows: [] });
      await keywordSearch(1, "q");

      const sqlObj = mockExecute.mock.calls[0][0];
      expect(sqlObj.values).toContain(10);
    });

    it("respects a custom limit", async () => {
      mockExecute.mockResolvedValue({ rows: [] });
      await keywordSearch(1, "q", null, 25);

      const sqlObj = mockExecute.mock.calls[0][0];
      expect(sqlObj.values).toContain(25);
    });

    it("filters by kbId when provided", async () => {
      mockExecute.mockResolvedValue({ rows: [] });
      await keywordSearch(1, "q", "kb-99");

      const sqlObj = mockExecute.mock.calls[0][0];
      const flat = JSON.stringify(sqlObj.values);
      expect(flat).toContain("kb-99");
    });

    it("passes the query for both ts_rank and @@ matching", async () => {
      mockExecute.mockResolvedValue({ rows: [] });
      await keywordSearch(1, "machine learning");

      const sqlObj = mockExecute.mock.calls[0][0];
      // The query string appears twice in the SQL template values (ts_rank + @@ filter)
      const queryOccurrences = sqlObj.values.filter((v: any) => v === "machine learning");
      expect(queryOccurrences.length).toBe(2);
    });
  });

  // ── hybridSearch ────────────────────────────────────────────────────────

  describe("hybridSearch", () => {
    const K = 60; // RRF constant from source

    it("calls both searchSimilar and keywordSearch", async () => {
      mockExecute.mockResolvedValue({ rows: [] });

      await hybridSearch(1, "hybrid query");

      // embed called once (by searchSimilar path) and db.execute called twice
      expect(mockEmbed).toHaveBeenCalledTimes(1);
      expect(mockExecute).toHaveBeenCalledTimes(2);
    });

    it("requests limit*2 from each sub-search", async () => {
      mockExecute.mockResolvedValue({ rows: [] });
      await hybridSearch(1, "q", null, 3);

      // Both sub-searches should use limit=6 (3*2)
      const calls = mockExecute.mock.calls;
      expect(calls[0][0].values).toContain(6);
      expect(calls[1][0].values).toContain(6);
    });

    it("merges results using Reciprocal Rank Fusion", async () => {
      // First call = searchSimilar, second = keywordSearch
      const vectorRows = [makeChunk({ id: "v1" }), makeChunk({ id: "v2" })];
      const kwRows = [makeChunk({ id: "v2" }), makeChunk({ id: "kw1" })];
      mockExecute
        .mockResolvedValueOnce({ rows: vectorRows })
        .mockResolvedValueOnce({ rows: kwRows });

      const results = await hybridSearch(1, "test", null, 5);

      // v2 appears in both lists so it should have the highest RRF score
      expect(results[0].id).toBe("v2");
      // All three unique ids should be present
      const ids = results.map((r) => r.id);
      expect(ids).toContain("v1");
      expect(ids).toContain("v2");
      expect(ids).toContain("kw1");
    });

    it("computes correct RRF scores for overlapping results", async () => {
      // Overlapping chunk at rank 0 in vector, rank 1 in keyword
      const vectorRows = [makeChunk({ id: "overlap" })];
      const kwRows = [makeChunk({ id: "other" }), makeChunk({ id: "overlap" })];
      mockExecute
        .mockResolvedValueOnce({ rows: vectorRows })
        .mockResolvedValueOnce({ rows: kwRows });

      const results = await hybridSearch(1, "q", null, 10);

      const overlap = results.find((r) => r.id === "overlap")!;
      const expectedScore = 1 / (0 + 1 + K) + 1 / (1 + 1 + K); // rank 0 vector + rank 1 keyword
      expect(overlap.score).toBeCloseTo(expectedScore, 10);
    });

    it("computes correct RRF score for a non-overlapping result", async () => {
      const vectorRows = [makeChunk({ id: "only-vec" })];
      const kwRows = [makeChunk({ id: "only-kw" })];
      mockExecute
        .mockResolvedValueOnce({ rows: vectorRows })
        .mockResolvedValueOnce({ rows: kwRows });

      const results = await hybridSearch(1, "q", null, 10);

      // Both appear once at rank 0 in their respective list
      const expectedSingle = 1 / (0 + 1 + K);
      for (const r of results) {
        expect(r.score).toBeCloseTo(expectedSingle, 10);
      }
    });

    it("returns at most `limit` results", async () => {
      const vectorRows = Array.from({ length: 6 }, (_, i) => makeChunk({ id: `v-${i}` }));
      const kwRows = Array.from({ length: 6 }, (_, i) => makeChunk({ id: `kw-${i}` }));
      mockExecute
        .mockResolvedValueOnce({ rows: vectorRows })
        .mockResolvedValueOnce({ rows: kwRows });

      const results = await hybridSearch(1, "q", null, 3);
      expect(results).toHaveLength(3);
    });

    it("sorts results by descending RRF score", async () => {
      // Create 3 vector results and 3 keyword results, with only the last vector
      // result overlapping with the first keyword result (highest combined score)
      const vectorRows = [
        makeChunk({ id: "a" }),
        makeChunk({ id: "b" }),
        makeChunk({ id: "shared" }),
      ];
      const kwRows = [
        makeChunk({ id: "shared" }),
        makeChunk({ id: "c" }),
        makeChunk({ id: "d" }),
      ];
      mockExecute
        .mockResolvedValueOnce({ rows: vectorRows })
        .mockResolvedValueOnce({ rows: kwRows });

      const results = await hybridSearch(1, "q", null, 10);

      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
      }
    });

    it("returns empty array when both sub-searches return nothing", async () => {
      mockExecute.mockResolvedValue({ rows: [] });

      const results = await hybridSearch(1, "q");
      expect(results).toEqual([]);
    });

    it("passes kbId to both sub-searches", async () => {
      mockExecute.mockResolvedValue({ rows: [] });
      await hybridSearch(1, "q", "kb-hybrid");

      const calls = mockExecute.mock.calls;
      expect(JSON.stringify(calls[0][0].values)).toContain("kb-hybrid");
      expect(JSON.stringify(calls[1][0].values)).toContain("kb-hybrid");
    });

    it("uses default limit of 5", async () => {
      mockExecute.mockResolvedValue({ rows: [] });
      await hybridSearch(1, "q");

      // Sub-searches should use 5*2 = 10
      const calls = mockExecute.mock.calls;
      expect(calls[0][0].values).toContain(10);
      expect(calls[1][0].values).toContain(10);
    });
  });

  // ── deleteKBChunks ──────────────────────────────────────────────────────

  describe("deleteKBChunks", () => {
    it("deletes all chunks for a knowledge base and returns the count", async () => {
      mockExecute.mockResolvedValue({ rowCount: 7 });

      const count = await deleteKBChunks("kb-del");

      expect(count).toBe(7);
      const sqlObj = mockExecute.mock.calls[0][0];
      expect(sqlObj.values).toContain("kb-del");
    });

    it("returns 0 when rowCount is null", async () => {
      mockExecute.mockResolvedValue({ rowCount: null });

      const count = await deleteKBChunks("kb-empty");
      expect(count).toBe(0);
    });

    it("returns 0 when no rows matched", async () => {
      mockExecute.mockResolvedValue({ rowCount: 0 });

      const count = await deleteKBChunks("kb-none");
      expect(count).toBe(0);
    });
  });

  // ── deleteDocChunks ─────────────────────────────────────────────────────

  describe("deleteDocChunks", () => {
    it("deletes chunks for a specific document within a KB", async () => {
      mockExecute.mockResolvedValue({ rowCount: 3 });

      const count = await deleteDocChunks("kb-1", "report.pdf");

      expect(count).toBe(3);
      const sqlObj = mockExecute.mock.calls[0][0];
      expect(sqlObj.values).toContain("kb-1");
      expect(sqlObj.values).toContain("report.pdf");
    });

    it("returns 0 when rowCount is null", async () => {
      mockExecute.mockResolvedValue({ rowCount: null });

      const count = await deleteDocChunks("kb-1", "missing.pdf");
      expect(count).toBe(0);
    });

    it("returns 0 when no rows matched", async () => {
      mockExecute.mockResolvedValue({ rowCount: 0 });

      const count = await deleteDocChunks("kb-1", "gone.pdf");
      expect(count).toBe(0);
    });

    it("propagates db errors", async () => {
      mockExecute.mockRejectedValue(new Error("connection lost"));

      await expect(deleteDocChunks("kb-1", "x.pdf")).rejects.toThrow("connection lost");
    });
  });

  // P6-11: safeVectorLiteral injection tests — malformed embeddings should be rejected
  describe("safeVectorLiteral", () => {
    it("accepts valid finite number arrays", () => {
      expect(safeVectorLiteral([0.1, -0.5, 0.9])).toBe("[0.1,-0.5,0.9]");
    });

    it("rejects NaN values", () => {
      expect(() => safeVectorLiteral([0.1, NaN, 0.3])).toThrow(/Invalid vector component at index 1/);
    });

    it("rejects Infinity values", () => {
      expect(() => safeVectorLiteral([Infinity, 0.1, 0.2])).toThrow(/Invalid vector component at index 0/);
    });

    it("rejects -Infinity values", () => {
      expect(() => safeVectorLiteral([0.1, -Infinity, 0.2])).toThrow(/Invalid vector component at index 1/);
    });

    it("rejects non-number values in array", () => {
      expect(() => safeVectorLiteral([0.1, "0.2" as any, 0.3])).toThrow(/Invalid vector component/);
    });

    it("handles empty arrays", () => {
      expect(safeVectorLiteral([])).toBe("[]");
    });

    it("produces valid SQL-safe vector string (no injection)", () => {
      const vec = [0.1, 0.2, 0.3, 0.4, 0.5];
      const result = safeVectorLiteral(vec);
      // Should not contain any SQL-injectable characters
      expect(result).not.toMatch(/[;'"\\]/);
      expect(result).toMatch(/^\[[\d.,-]+\]$/);
    });

    it("rejects vectors exceeding 4096 dimensions", () => {
      const bigVec = Array.from({ length: 4097 }, () => 0.1);
      expect(() => safeVectorLiteral(bigVec)).toThrow(/exceeds maximum 4096/);
    });
  });

  // ── enrichWithParentContext ─────────────────────────────────────────────────

  describe("enrichWithParentContext", () => {
    it("returns chunks unchanged when input is empty", async () => {
      const result = await enrichWithParentContext([]);
      expect(result).toEqual([]);
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it("returns chunks unchanged when none have parentChunkId", async () => {
      // First execute: returns rows with no parentChunkId
      mockExecute.mockResolvedValueOnce({ rows: [] }); // parentInfo query returns no rows with parentChunkId

      const chunks = [makeChunk({ id: "c1" }), makeChunk({ id: "c2" })];
      const result = await enrichWithParentContext(chunks);

      expect(result).toEqual(chunks);
    });

    it("prepends parent context to child chunks", async () => {
      const chunks = [makeChunk({ id: "child-1", content: "Child content." })];

      // First execute: parentInfo rows (id → parentChunkId mapping)
      mockExecute.mockResolvedValueOnce({
        rows: [{ id: "child-1", parentChunkId: "parent-1" }],
      });

      // Second execute: parent content
      mockExecute.mockResolvedValueOnce({
        rows: [{ id: "parent-1", content: "Parent context." }],
      });

      const result = await enrichWithParentContext(chunks);

      expect(result[0].content).toContain("[PARENT CONTEXT]");
      expect(result[0].content).toContain("Parent context.");
      expect(result[0].content).toContain("Child content.");
    });

    it("leaves chunks unmodified when parent content is not found", async () => {
      const chunks = [makeChunk({ id: "child-1", content: "Child." })];

      mockExecute.mockResolvedValueOnce({
        rows: [{ id: "child-1", parentChunkId: "parent-missing" }],
      });

      // Parent not found in second query
      mockExecute.mockResolvedValueOnce({ rows: [] });

      const result = await enrichWithParentContext(chunks);
      expect(result[0].content).toBe("Child.");
    });

    it("passes ids to the first query and parentIds to the second", async () => {
      const chunks = [makeChunk({ id: "c1" })];

      mockExecute.mockResolvedValueOnce({ rows: [{ id: "c1", parentChunkId: "p1" }] });
      mockExecute.mockResolvedValueOnce({ rows: [{ id: "p1", content: "Parent." }] });

      await enrichWithParentContext(chunks);

      expect(mockExecute).toHaveBeenCalledTimes(2);
      // First call should include "c1" for fetching parentChunkId info
      const firstCall = JSON.stringify(mockExecute.mock.calls[0][0]);
      expect(firstCall).toContain("c1");
      // Second call should include "p1" for fetching parent content
      const secondCall = JSON.stringify(mockExecute.mock.calls[1][0]);
      expect(secondCall).toContain("p1");
    });
  });

  // ── hydeSearch ─────────────────────────────────────────────────────────────

  describe("hydeSearch", () => {
    it("generates a hypothetical document and embeds it before querying", async () => {
      mockRouteAndCollect.mockResolvedValue({ text: "Hypothetical answer text." });
      mockExecute.mockResolvedValue({ rows: [] });

      await hydeSearch(1, "What is the capital of France?");

      // routeAndCollect called to generate hypothetical doc
      expect(mockRouteAndCollect).toHaveBeenCalledTimes(1);
      // embed called with the hypothetical text, NOT the raw query
      expect(mockEmbed).toHaveBeenCalledWith("Hypothetical answer text.");
    });

    it("falls back to raw query embedding when routeAndCollect fails", async () => {
      mockRouteAndCollect.mockRejectedValue(new Error("LLM unavailable"));
      mockExecute.mockResolvedValue({ rows: [] });

      await hydeSearch(1, "my query");

      // Falls back to raw query
      expect(mockEmbed).toHaveBeenCalledWith("my query");
    });

    it("returns rows from the db query", async () => {
      const rows = [makeChunk({ id: "hyde-1", score: 0.88 })];
      mockRouteAndCollect.mockResolvedValue({ text: "Hypothetical." });
      mockExecute.mockResolvedValue({ rows });

      const result = await hydeSearch(1, "query");
      expect(result).toEqual(rows);
    });

    it("clamps limit to MAX_SEARCH_LIMIT (100)", async () => {
      mockRouteAndCollect.mockResolvedValue({ text: "Hypothetical." });
      mockExecute.mockResolvedValue({ rows: [] });

      await hydeSearch(1, "q", null, 999);

      const sqlObj = mockExecute.mock.calls[0][0];
      // Should use clamped limit, not 999
      const limitValue = sqlObj.values.find((v: unknown) => typeof v === "number" && (v as number) <= 100);
      expect(limitValue).toBeDefined();
    });
  });

  // ── enhancedHybridSearch ───────────────────────────────────────────────────

  describe("enhancedHybridSearch", () => {
    it("runs 2 searches (vector + keyword) by default without HyDE", async () => {
      mockExecute.mockResolvedValue({ rows: [] });

      await enhancedHybridSearch(1, "q");

      expect(mockEmbed).toHaveBeenCalledTimes(1); // only vector search calls embed
      expect(mockExecute).toHaveBeenCalledTimes(2);
    });

    it("runs 3 searches when useHyde=true", async () => {
      mockRouteAndCollect.mockResolvedValue({ text: "Hypothetical." });
      mockExecute.mockResolvedValue({ rows: [] });

      await enhancedHybridSearch(1, "q", null, 5, true);

      // searchSimilar + keywordSearch + hydeSearch each call execute once
      expect(mockExecute).toHaveBeenCalledTimes(3);
    });

    it("merges results with RRF and returns top N", async () => {
      const vecRows = [makeChunk({ id: "v1" }), makeChunk({ id: "v2" })];
      const kwRows = [makeChunk({ id: "v2" }), makeChunk({ id: "kw1" })];
      mockExecute
        .mockResolvedValueOnce({ rows: vecRows })
        .mockResolvedValueOnce({ rows: kwRows });

      const result = await enhancedHybridSearch(1, "q", null, 3);

      // v2 overlaps → highest RRF score
      expect(result[0].id).toBe("v2");
      expect(result.length).toBeLessThanOrEqual(3);
    });

    it("returns empty array when all searches yield no results", async () => {
      mockExecute.mockResolvedValue({ rows: [] });

      const result = await enhancedHybridSearch(1, "q");
      expect(result).toEqual([]);
    });

    it("passes kbId to sub-searches", async () => {
      mockExecute.mockResolvedValue({ rows: [] });

      await enhancedHybridSearch(1, "q", "kb-test");

      const allCalls = mockExecute.mock.calls;
      for (const call of allCalls) {
        expect(JSON.stringify(call[0].values)).toContain("kb-test");
      }
    });
  });
});
