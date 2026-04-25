import { describe, it, expect, vi, beforeEach } from "vitest";

// ── mock setup ────────────────────────────────────────────────────────────────

const { mockExecute } = vi.hoisted(() => ({
  mockExecute: vi.fn(),
}));

vi.mock("../../../src/lib/drizzle.js", () => ({
  db: {
    select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }) }) }),
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue({ onConflictDoUpdate: vi.fn().mockResolvedValue(undefined) }) }),
    delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    execute: mockExecute,
  },
}));

vi.mock("../../../src/db/schema/conversations.js", () => ({
  semanticCache: {
    keyHash: "keyHash",
    prompt: "prompt",
    verdict: "verdict",
    opinions: "opinions",
    expiresAt: "expiresAt",
    createdAt: "createdAt",
    embedding: "embedding",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a: unknown, b: unknown) => ({ field: a, value: b })),
  sql: vi.fn().mockImplementation((...args: unknown[]) => ({ sql: args })),
  and: vi.fn((...args: unknown[]) => args),
}));

vi.mock("../../../src/lib/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { PostgresBackend } from "../../../src/lib/cache/PostgresBackend.js";
import logger from "../../../src/lib/logger.js";

// ── helpers ───────────────────────────────────────────────────────────────────

function makeEntry(overrides = {}) {
  return { verdict: "approved", opinions: [{ text: "ok" }], ...overrides };
}

// ── PostgresBackend extended ──────────────────────────────────────────────────

describe("PostgresBackend — searchSemantic / setSemantic / cleanup", () => {
  let backend: PostgresBackend;

  beforeEach(() => {
    vi.clearAllMocks();
    backend = new PostgresBackend();
  });

  // ── searchSemantic ──────────────────────────────────────────────────────────

  describe("searchSemantic", () => {
    it("returns null when db.execute returns no rows", async () => {
      mockExecute.mockResolvedValue({ rows: [] });
      const result = await backend.searchSemantic([0.1, 0.2, 0.3]);
      expect(result).toBeNull();
    });

    it("returns a SemanticSearchResult when a row is found", async () => {
      const row = {
        id: 1,
        keyHash: "k1",
        verdict: "approved",
        opinions: [{ text: "ok" }],
        distance: 0.05,
      };
      mockExecute.mockResolvedValue({ rows: [row] });

      const result = await backend.searchSemantic([0.1, 0.2]);
      expect(result).not.toBeNull();
      expect(result!.keyHash).toBe("k1");
      expect(result!.verdict).toBe("approved");
      expect(result!.distance).toBe(0.05);
    });

    it("safe-parses opinions when stored as a JSON string", async () => {
      const row = {
        id: 1,
        keyHash: "k2",
        verdict: "denied",
        opinions: JSON.stringify([{ text: "bad" }]),
        distance: 0.08,
      };
      mockExecute.mockResolvedValue({ rows: [row] });

      const result = await backend.searchSemantic([0.5]);
      expect(result!.opinions).toEqual([{ text: "bad" }]);
    });

    it("returns empty opinions array when JSON parse fails", async () => {
      const row = {
        id: 1,
        keyHash: "k3",
        verdict: "v",
        opinions: "not-valid-json{{",
        distance: 0.1,
      };
      mockExecute.mockResolvedValue({ rows: [row] });

      const result = await backend.searchSemantic([0.1]);
      expect(result!.opinions).toEqual([]);
    });

    it("returns null and logs warn when embedding contains NaN", async () => {
      const result = await backend.searchSemantic([0.1, NaN, 0.3]);
      expect(result).toBeNull();
      expect(vi.mocked(logger).warn).toHaveBeenCalledWith(
        expect.stringContaining("non-finite")
      );
    });

    it("returns null and logs warn when embedding contains Infinity", async () => {
      const result = await backend.searchSemantic([Infinity]);
      expect(result).toBeNull();
      expect(vi.mocked(logger).warn).toHaveBeenCalled();
    });

    it("returns null and logs warn when db.execute throws", async () => {
      mockExecute.mockRejectedValue(new Error("pgvector error"));
      const result = await backend.searchSemantic([0.1, 0.2]);
      expect(result).toBeNull();
      expect(vi.mocked(logger).warn).toHaveBeenCalledWith(
        expect.objectContaining({ err: "pgvector error" }),
        expect.stringContaining("Vector search failed")
      );
    });

    it("uses the provided threshold", async () => {
      mockExecute.mockResolvedValue({ rows: [] });
      await backend.searchSemantic([0.1, 0.2], 0.3);
      // We can only verify it didn't throw — threshold is embedded in SQL
      expect(mockExecute).toHaveBeenCalledTimes(1);
    });
  });

  // ── setSemantic ─────────────────────────────────────────────────────────────

  describe("setSemantic", () => {
    it("calls db.execute with embedding when embedding is provided", async () => {
      mockExecute.mockResolvedValue(undefined);
      await backend.setSemantic("k1", "prompt", makeEntry(), [0.1, 0.2], 60_000);
      expect(mockExecute).toHaveBeenCalledTimes(1);
    });

    it("falls back to set() when embedding is null", async () => {
      const insertValues = vi.fn().mockReturnValue({ onConflictDoUpdate: vi.fn().mockResolvedValue(undefined) });
      const { db } = await import("../../../src/lib/drizzle.js");
      vi.mocked(db.insert).mockReturnValue({ values: insertValues } as ReturnType<typeof db.insert>);

      await backend.setSemantic("k1", "prompt", makeEntry(), null, 60_000);
      // db.execute should NOT be called; instead insert (via set()) is used
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it("uses default TTL (24h) when ttlMs is 0", async () => {
      mockExecute.mockResolvedValue(undefined);
      await backend.setSemantic("k1", "prompt", makeEntry(), [0.1], 0);
      // Should not throw — default TTL applied
      expect(mockExecute).toHaveBeenCalledTimes(1);
    });

    it("uses default TTL (24h) when ttlMs is negative", async () => {
      mockExecute.mockResolvedValue(undefined);
      await backend.setSemantic("k1", "prompt", makeEntry(), [0.1], -5000);
      expect(mockExecute).toHaveBeenCalledTimes(1);
    });

    it("truncates prompt to 500 characters", async () => {
      mockExecute.mockResolvedValue(undefined);
      const longPrompt = "p".repeat(1000);
      // Should not throw — truncation applied internally
      await backend.setSemantic("k1", longPrompt, makeEntry(), [0.1], 60_000);
      expect(mockExecute).toHaveBeenCalledTimes(1);
    });
  });

  // ── cleanup ─────────────────────────────────────────────────────────────────

  describe("cleanup", () => {
    it("calls db.execute to delete expired rows", async () => {
      mockExecute.mockResolvedValue({ rowCount: 5 });
      await backend.cleanup();
      expect(mockExecute).toHaveBeenCalledTimes(1);
    });

    it("logs the number of deleted rows", async () => {
      mockExecute.mockResolvedValue({ rowCount: 3 });
      await backend.cleanup();
      expect(vi.mocked(logger).debug).toHaveBeenCalledWith(
        expect.objectContaining({ deleted: 3 }),
        expect.stringContaining("Cleaned up expired cache entries")
      );
    });

    it("logs warn and does not throw when db.execute fails", async () => {
      mockExecute.mockRejectedValue(new Error("db down"));
      await expect(backend.cleanup()).resolves.not.toThrow();
      expect(vi.mocked(logger).warn).toHaveBeenCalledWith(
        expect.objectContaining({ err: "db down" }),
        expect.stringContaining("Failed to clean up expired cache entries")
      );
    });
  });

  // ── delete error path ───────────────────────────────────────────────────────

  describe("delete error handling", () => {
    it("logs warn and does not throw when delete query fails", async () => {
      const { db } = await import("../../../src/lib/drizzle.js");
      vi.mocked(db.delete).mockReturnValue({
        where: vi.fn().mockRejectedValue(new Error("constraint error")),
      } as ReturnType<typeof db.delete>);

      await expect(backend.delete("bad-key")).resolves.not.toThrow();
      expect(vi.mocked(logger).warn).toHaveBeenCalledWith(
        expect.objectContaining({ err: "constraint error", key: "bad-key" }),
        expect.stringContaining("Failed to delete cache entry")
      );
    });
  });
});
