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

// Mock db
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockSelectResult: any[] = [];
vi.mock("../../src/lib/drizzle.js", () => ({
  db: {
    insert: () => ({ values: mockInsert }),
    update: () => ({
      set: (data: any) => ({
        where: mockUpdate,
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => mockSelectResult,
        }),
      }),
    }),
  },
}));

// Mock drizzle-orm
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: unknown[]) => ({ type: "eq", args })),
  and: vi.fn((...args: unknown[]) => ({ type: "and", args })),
  sql: Object.assign((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }), { raw: (s: string) => s }),
}));

// Mock council schema
vi.mock("../../src/db/schema/council.js", () => ({
  contradictionRecords: {
    id: "id",
    conversationId: "conversationId",
    userId: "userId",
    status: "status",
  },
}));

// Mock router
const mockRouteAndCollect = vi.fn();
vi.mock("../../src/router/index.js", () => ({
  routeAndCollect: (...args: unknown[]) => mockRouteAndCollect(...args),
}));

import {
  detectContradictions,
  recordContradiction,
  resolveContradiction,
  formatContradictions,
  type Contradiction,
} from "../../src/services/contradictionResolution.service.js";

describe("contradictionResolution.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectResult.length = 0;
  });

  describe("detectContradictions", () => {
    it("should detect contradictions between opinions", async () => {
      mockRouteAndCollect.mockResolvedValue({
        text: JSON.stringify([
          {
            claimA: "Python is interpreted",
            sourceA: "empiricist",
            claimB: "Python is compiled",
            sourceB: "contrarian",
          },
        ]),
      });

      const result = await detectContradictions([
        { name: "empiricist", text: "Python is interpreted" },
        { name: "contrarian", text: "Python is compiled to bytecode" },
      ]);

      expect(result).toHaveLength(1);
      expect(result[0].sourceA).toBe("empiricist");
      expect(result[0].sourceB).toBe("contrarian");
    });

    it("should return empty array for single opinion", async () => {
      const result = await detectContradictions([
        { name: "empiricist", text: "Python is interpreted" },
      ]);
      expect(result).toHaveLength(0);
    });

    it("should handle LLM failure gracefully", async () => {
      mockRouteAndCollect.mockRejectedValue(new Error("LLM error"));

      const result = await detectContradictions([
        { name: "a", text: "claim A" },
        { name: "b", text: "claim B" },
      ]);
      expect(result).toHaveLength(0);
    });

    it("should return empty for no contradictions", async () => {
      mockRouteAndCollect.mockResolvedValue({ text: "[]" });

      const result = await detectContradictions([
        { name: "a", text: "X is true" },
        { name: "b", text: "X is also true" },
      ]);
      expect(result).toHaveLength(0);
    });
  });

  describe("recordContradiction", () => {
    it("should insert a new contradiction record", async () => {
      mockInsert.mockResolvedValue(undefined);

      const id = await recordContradiction(1, "conv-1", {
        claimA: "Earth is flat",
        sourceA: "contrarian",
        claimB: "Earth is round",
        sourceB: "empiricist",
      });

      expect(id).toMatch(/^contra_/);
      expect(mockInsert).toHaveBeenCalled();
    });
  });

  describe("formatContradictions", () => {
    it("should return empty string for no contradictions", () => {
      expect(formatContradictions([])).toBe("");
    });

    it("should format open contradictions", () => {
      const contradictions: Contradiction[] = [
        {
          id: "c1",
          claimA: "X is true",
          sourceA: "agent-A",
          claimB: "X is false",
          sourceB: "agent-B",
          resolution: null,
          resolvedBy: null,
          status: "open",
          confidence: null,
          versions: [],
        },
      ];

      const formatted = formatContradictions(contradictions);
      expect(formatted).toContain("[CONTRADICTIONS DETECTED]");
      expect(formatted).toContain("Unresolved");
      expect(formatted).toContain("agent-A");
      expect(formatted).toContain("X is true");
    });

    it("should format resolved contradictions with version count", () => {
      const contradictions: Contradiction[] = [
        {
          id: "c1",
          claimA: "A",
          sourceA: "agent-A",
          claimB: "B",
          sourceB: "agent-B",
          resolution: "A is correct",
          resolvedBy: "master",
          status: "resolved",
          confidence: 0.95,
          versions: [
            { resolution: "B was correct", resolvedBy: "agent-A", confidence: 0.6, timestamp: "2026-01-01", reason: "initial" },
            { resolution: "A is correct", resolvedBy: "master", confidence: 0.95, timestamp: "2026-01-02", reason: "new evidence" },
          ],
        },
      ];

      const formatted = formatContradictions(contradictions);
      expect(formatted).toContain("Resolved by master");
      expect(formatted).toContain("2 resolution versions");
    });
  });

  // P6-07: Performance test — detect contradictions at n=14 archetypes (max council size)
  describe("performance at n=14 archetypes", () => {
    it("should handle 14 opinions without timeout", async () => {
      const opinions = Array.from({ length: 14 }, (_, i) => ({
        name: `archetype-${i}`,
        text: `Opinion ${i}: The answer is ${i % 2 === 0 ? "yes" : "no"} because of reason ${i}`,
      }));

      mockRouteAndCollect.mockResolvedValue({
        text: JSON.stringify([
          { claimA: "yes", sourceA: "archetype-0", claimB: "no", sourceB: "archetype-1" },
        ]),
      });

      const start = Date.now();
      const result = await detectContradictions(opinions);
      const elapsed = Date.now() - start;

      expect(result).toHaveLength(1);
      // Should complete in under 5 seconds even with 14 archetypes (91 pairs)
      expect(elapsed).toBeLessThan(5000);
    });
  });
});
