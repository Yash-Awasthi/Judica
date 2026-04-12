import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------- mocks (hoisted so vi.mock factories can reference them) ----------

const { mockQuery, mockEmbed } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockEmbed: vi.fn(),
}));

vi.mock("../../src/lib/db.js", () => ({
  pool: { query: mockQuery },
}));

vi.mock("../../src/services/embeddings.service.js", () => ({
  embed: mockEmbed,
}));

// ---------- import after mocks ----------

import { searchRepo, type CodeSearchResult } from "../../src/services/repoSearch.service.js";

// ---------- helpers ----------

function fakeEmbedding(len = 3): number[] {
  return Array.from({ length: len }, (_, i) => i * 0.1);
}

function fakeRows(count: number): CodeSearchResult[] {
  return Array.from({ length: count }, (_, i) => ({
    path: `src/file${i}.ts`,
    language: "typescript",
    content: `content of file ${i}`,
    score: 1 - i * 0.05,
  }));
}

// ---------- tests ----------

describe("searchRepo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns search results with default limit", async () => {
    const embedding = fakeEmbedding();
    const rows = fakeRows(3);
    mockEmbed.mockResolvedValue(embedding);
    mockQuery.mockResolvedValue({ rows });

    const results = await searchRepo("repo-1", "find auth logic");

    expect(mockEmbed).toHaveBeenCalledWith("find auth logic");

    const expectedVector = `[${embedding.join(",")}]`;
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("CodeFile"),
      [expectedVector, "repo-1", 10],
    );

    expect(results).toEqual(rows);
    expect(results).toHaveLength(3);
  });

  it("passes a custom limit to the query", async () => {
    mockEmbed.mockResolvedValue(fakeEmbedding());
    mockQuery.mockResolvedValue({ rows: fakeRows(5) });

    const results = await searchRepo("repo-2", "something", 5);

    expect(mockQuery).toHaveBeenCalledWith(
      expect.any(String),
      [expect.any(String), "repo-2", 5],
    );
    expect(results).toHaveLength(5);
  });

  it("returns an empty array when no rows match", async () => {
    mockEmbed.mockResolvedValue(fakeEmbedding());
    mockQuery.mockResolvedValue({ rows: [] });

    const results = await searchRepo("repo-empty", "nonexistent");

    expect(results).toEqual([]);
    expect(results).toHaveLength(0);
  });

  it("constructs the vector string correctly from the embedding", async () => {
    const embedding = [0.25, -0.5, 0.75];
    mockEmbed.mockResolvedValue(embedding);
    mockQuery.mockResolvedValue({ rows: [] });

    await searchRepo("repo-vec", "test");

    const passedVector = mockQuery.mock.calls[0][1][0];
    expect(passedVector).toBe("[0.25,-0.5,0.75]");
  });

  it("propagates errors thrown by embed()", async () => {
    mockEmbed.mockRejectedValue(new Error("embedding service unavailable"));

    await expect(searchRepo("repo-err", "query")).rejects.toThrow(
      "embedding service unavailable",
    );
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("propagates errors thrown by pool.query()", async () => {
    mockEmbed.mockResolvedValue(fakeEmbedding());
    mockQuery.mockRejectedValue(new Error("connection refused"));

    await expect(searchRepo("repo-err", "query")).rejects.toThrow(
      "connection refused",
    );
  });

  it("includes the correct SQL structure in the query", async () => {
    mockEmbed.mockResolvedValue(fakeEmbedding());
    mockQuery.mockResolvedValue({ rows: [] });

    await searchRepo("repo-sql", "test");

    const sql: string = mockQuery.mock.calls[0][0];
    expect(sql).toContain("SELECT");
    expect(sql).toContain('"path"');
    expect(sql).toContain('"language"');
    expect(sql).toContain('"content"');
    expect(sql).toContain('<=>');
    expect(sql).toContain('"repoId"');
    expect(sql).toContain("ORDER BY score DESC");
    expect(sql).toContain("LIMIT");
  });
});
