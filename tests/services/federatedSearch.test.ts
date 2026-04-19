import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock logger
vi.mock("../../src/lib/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Mock env
vi.mock("../../src/config/env.js", () => ({
  env: {
    DATABASE_URL: "postgresql://test:test@localhost:5432/test",
    JWT_SECRET: "test-jwt-secret-min-16-chars",
    MASTER_ENCRYPTION_KEY: "test-master-encryption-key-min-32-characters-long",
  },
}));

// Mock embeddings
const mockEmbed = vi.fn();
vi.mock("../../src/services/embeddings.service.js", () => ({
  embed: (...args: unknown[]) => mockEmbed(...args),
}));

// Mock db
const mockDbExecute = vi.fn();
vi.mock("../../src/lib/drizzle.js", () => ({
  db: { execute: (...args: unknown[]) => mockDbExecute(...args) },
}));

// Mock drizzle-orm
vi.mock("drizzle-orm", () => ({
  sql: Object.assign((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }), { raw: (s: string) => s }),
}));

// Mock pool
const mockPoolQuery = vi.fn();
vi.mock("../../src/lib/db.js", () => ({
  pool: { query: (...args: unknown[]) => mockPoolQuery(...args) },
}));

// Mock vectorStore hybridSearch
const mockHybridSearch = vi.fn();
vi.mock("../../src/services/vectorStore.service.js", () => ({
  hybridSearch: (...args: unknown[]) => mockHybridSearch(...args),
  safeVectorLiteral: (vec: number[]) => `[${vec.join(",")}]`,
}));

import { federatedSearch, formatFederatedContext, type FederatedResult } from "../../src/services/federatedSearch.service.js";

describe("federatedSearch.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEmbed.mockResolvedValue([0.1, 0.2, 0.3]);
  });

  describe("federatedSearch", () => {
    it("should search KB index and return results", async () => {
      mockHybridSearch.mockResolvedValue([
        { id: "kb-1", content: "KB result", sourceName: "doc.pdf", score: 0.9 },
      ]);
      mockDbExecute.mockResolvedValue({ rows: [] });
      mockPoolQuery.mockResolvedValue({ rows: [] });

      const results = await federatedSearch({
        userId: 1,
        query: "test query",
        indexes: ["kb"],
      });

      expect(results.length).toBe(1);
      expect(results[0].source).toBe("kb");
      expect(mockHybridSearch).toHaveBeenCalled();
    });

    it("should search conversation index and return results", async () => {
      mockDbExecute.mockResolvedValue({
        rows: [
          { id: "chat-1", question: "What is X?", verdict: "X is Y", score: 0.85 },
        ],
      });

      const results = await federatedSearch({
        userId: 1,
        query: "test query",
        indexes: ["conversation"],
      });

      expect(results.length).toBe(1);
      expect(results[0].source).toBe("conversation");
      expect(results[0].content).toContain("What is X?");
    });

    it("should search repo index and return results", async () => {
      mockPoolQuery.mockResolvedValue({
        rows: [
          { id: "cf-1", path: "src/main.ts", language: "typescript", content: "export function main() {}", score: 0.8, repoName: "my-repo" },
        ],
      });

      const results = await federatedSearch({
        userId: 1,
        query: "main function",
        indexes: ["repo"],
      });

      expect(results.length).toBe(1);
      expect(results[0].source).toBe("repo");
      expect(results[0].sourceName).toContain("my-repo");
    });

    it("should merge results from multiple indexes with RRF", async () => {
      mockHybridSearch.mockResolvedValue([
        { id: "kb-1", content: "KB result", sourceName: "doc.pdf", score: 0.9 },
      ]);
      mockDbExecute.mockResolvedValue({
        rows: [
          { id: "chat-1", question: "Related Q", verdict: "Related A", score: 0.85 },
        ],
      });
      mockPoolQuery.mockResolvedValue({
        rows: [
          { id: "cf-1", path: "src/app.ts", language: "typescript", content: "code", score: 0.75, repoName: "repo" },
        ],
      });

      const results = await federatedSearch({
        userId: 1,
        query: "test query",
        indexes: ["kb", "repo", "conversation"],
      });

      expect(results.length).toBe(3);
      // All results should have RRF scores
      for (const r of results) {
        expect(r.score).toBeGreaterThan(0);
      }
    });

    it("should handle failed indexes gracefully", async () => {
      mockHybridSearch.mockResolvedValue([
        { id: "kb-1", content: "KB result", sourceName: "doc.pdf", score: 0.9 },
      ]);
      mockDbExecute.mockRejectedValue(new Error("DB error"));
      mockPoolQuery.mockRejectedValue(new Error("Pool error"));

      const results = await federatedSearch({
        userId: 1,
        query: "test query",
        indexes: ["kb", "repo", "conversation"],
      });

      // Should still return KB results despite other failures
      expect(results.length).toBe(1);
      expect(results[0].source).toBe("kb");
    });

    it("should respect limit parameter", async () => {
      mockHybridSearch.mockResolvedValue(
        Array.from({ length: 20 }, (_, i) => ({
          id: `kb-${i}`,
          content: `Result ${i}`,
          sourceName: "doc.pdf",
          score: 0.9 - i * 0.01,
        }))
      );
      mockDbExecute.mockResolvedValue({ rows: [] });
      mockPoolQuery.mockResolvedValue({ rows: [] });

      const results = await federatedSearch({
        userId: 1,
        query: "test",
        limit: 5,
        indexes: ["kb"],
      });

      expect(results.length).toBe(5);
    });
  });

  describe("formatFederatedContext", () => {
    it("should return empty string for no results", () => {
      expect(formatFederatedContext([])).toBe("");
    });

    it("should group results by source", () => {
      const results: FederatedResult[] = [
        { id: "1", content: "KB content", source: "kb", sourceName: "doc.pdf", score: 0.9 },
        { id: "2", content: "Code content", source: "repo", sourceName: "main.ts", score: 0.8 },
        { id: "3", content: "Q: Hi\nA: Hello", source: "conversation", sourceName: "history", score: 0.7 },
      ];

      const formatted = formatFederatedContext(results);
      expect(formatted).toContain("[KNOWLEDGE BASE]");
      expect(formatted).toContain("[CODE REPOSITORY]");
      expect(formatted).toContain("[CONVERSATION HISTORY]");
      expect(formatted).toContain("KB content");
      expect(formatted).toContain("Code content");
    });

    it("should include council facts when present", () => {
      const results: FederatedResult[] = [
        { id: "1", content: "[claim] Earth is round", source: "fact", sourceName: "empiricist", score: 0.95 },
      ];

      const formatted = formatFederatedContext(results);
      expect(formatted).toContain("[COUNCIL FACTS]");
      expect(formatted).toContain("Earth is round");
    });
  });
});
