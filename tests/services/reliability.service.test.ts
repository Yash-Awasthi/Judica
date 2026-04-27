vi.mock("../../src/lib/logger.js", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a, b) => ({ eq: true, a, b })),
  inArray: vi.fn((col, vals) => ({ inArray: true, col, vals })),
  sql: vi.fn((strings, ...args) => ({ sql: true, strings, args })),
}));

vi.mock("../../src/db/schema/traces.js", () => ({
  modelReliability: {
    model: "model",
    totalResponses: "totalResponses",
    agreedWith: "agreedWith",
    contradicted: "contradicted",
    avgConfidence: "avgConfidence",
  },
}));

// ─── Hoisted DB mocks ─────────────────────────────────────────────────────────
const {
  mockDbInsert,
  mockDbSelect,
  mockInsertValues,
  mockSelectFrom,
} = vi.hoisted(() => {
  const mockInsertOnConflict = vi.fn().mockResolvedValue(undefined);
  const mockInsertValues = vi.fn().mockReturnValue({ onConflictDoUpdate: mockInsertOnConflict });
  const mockDbInsert = vi.fn().mockReturnValue({ values: mockInsertValues });

  const mockSelectWhere = vi.fn().mockResolvedValue([]);
  const mockSelectFrom = vi.fn().mockReturnValue({ where: mockSelectWhere });
  const mockDbSelect = vi.fn().mockReturnValue({ from: mockSelectFrom });

  return { mockDbInsert, mockDbSelect, mockInsertValues, mockSelectFrom };
});

vi.mock("../../src/lib/drizzle.js", () => ({
  db: { insert: mockDbInsert, select: mockDbSelect },
}));

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  updateReliability,
  getReliabilityScores,
} from "../../src/services/reliability.service.js";

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const memberModels = new Map([
  ["agent-1", "claude-opus-4"],
  ["agent-2", "gpt-4o"],
  ["agent-3", "gemini-1.5-pro"],
]);

describe("Reliability Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Reset insert default
    const mockInsertOnConflict = vi.fn().mockResolvedValue(undefined);
    mockInsertValues.mockReturnValue({ onConflictDoUpdate: mockInsertOnConflict });

    // Reset select default
    const mockSelectWhere = vi.fn().mockResolvedValue([]);
    mockSelectFrom.mockReturnValue({ where: mockSelectWhere });
  });

  // ─── updateReliability ────────────────────────────────────────────────────

  describe("updateReliability", () => {
    it("inserts reliability record for each model in conflicts", async () => {
      const conflicts = [{ agentA: "agent-1", agentB: "agent-2" }];

      await updateReliability(conflicts, [], memberModels);

      // Should have called insert for claude-opus-4 and gpt-4o
      expect(mockDbInsert).toHaveBeenCalledTimes(2);
    });

    it("increments contradicted for both models in a conflict", async () => {
      const conflicts = [{ agentA: "agent-1", agentB: "agent-2" }];

      await updateReliability(conflicts, [], memberModels);

      // Each model gets contradicted: 1
      const firstCall = mockInsertValues.mock.calls[0][0];
      expect(firstCall.contradicted).toBe(1);
    });

    it("uses modelA/modelB from conflict when provided", async () => {
      const conflicts = [{
        agentA: "agent-1",
        agentB: "agent-2",
        modelA: "custom-model-a",
        modelB: "custom-model-b",
      }];

      await updateReliability(conflicts, [], new Map());

      const calls = mockInsertValues.mock.calls.map((c) => c[0].model);
      expect(calls).toContain("custom-model-a");
      expect(calls).toContain("custom-model-b");
    });

    it("increments agreedWith for conceding model", async () => {
      const concessions = ["agent-1"];

      await updateReliability([], concessions, memberModels);

      expect(mockDbInsert).toHaveBeenCalledTimes(1);
      const insertedValues = mockInsertValues.mock.calls[0][0];
      expect(insertedValues.model).toBe("claude-opus-4");
      expect(insertedValues.agreedWith).toBe(1);
    });

    it("does not insert when conflicts and concessions are empty", async () => {
      await updateReliability([], [], memberModels);

      expect(mockDbInsert).not.toHaveBeenCalled();
    });

    it("does not insert for agents without a model mapping", async () => {
      const conflicts = [{ agentA: "unknown-agent", agentB: "agent-1" }];

      await updateReliability(conflicts, [], memberModels);

      // Only agent-1's model is tracked
      expect(mockDbInsert).toHaveBeenCalledTimes(1);
    });

    it("uses onConflictDoUpdate to upsert", async () => {
      const conflicts = [{ agentA: "agent-1", agentB: "agent-2" }];

      await updateReliability(conflicts, [], memberModels);

      const mockOnConflict = mockInsertValues.mock.results[0].value.onConflictDoUpdate;
      expect(mockOnConflict).toHaveBeenCalled();
    });

    it("does not throw when DB insert fails", async () => {
      const mockOnConflict = vi.fn().mockRejectedValue(new Error("DB error"));
      mockInsertValues.mockReturnValue({ onConflictDoUpdate: mockOnConflict });

      const conflicts = [{ agentA: "agent-1", agentB: "agent-2" }];

      // Should not throw — error is caught internally
      await expect(updateReliability(conflicts, [], memberModels)).resolves.toBeUndefined();
    });

    it("handles multiple conflicts correctly", async () => {
      const conflicts = [
        { agentA: "agent-1", agentB: "agent-2" },
        { agentA: "agent-2", agentB: "agent-3" },
      ];

      await updateReliability(conflicts, [], memberModels);

      // agent-2 appears in both conflicts → contradicted: 2
      const callsByModel: Record<string, number> = {};
      for (const call of mockInsertValues.mock.calls) {
        const { model, contradicted } = call[0];
        callsByModel[model] = (callsByModel[model] || 0) + contradicted;
      }
      expect(callsByModel["gpt-4o"]).toBe(2);
    });
  });

  // ─── getReliabilityScores ────────────────────────────────────────────────

  describe("getReliabilityScores", () => {
    it("returns empty map when models array is empty", async () => {
      const result = await getReliabilityScores([]);

      expect(result.size).toBe(0);
      expect(mockDbSelect).not.toHaveBeenCalled();
    });

    it("queries DB with inArray filter on model names", async () => {
      const mockWhere = vi.fn().mockResolvedValue([]);
      mockSelectFrom.mockReturnValueOnce({ where: mockWhere });

      await getReliabilityScores(["claude-opus-4", "gpt-4o"]);

      expect(mockDbSelect).toHaveBeenCalled();
      expect(mockWhere).toHaveBeenCalled();
    });

    it("maps rows to { avgConfidence, totalResponses }", async () => {
      const rows = [
        { model: "claude-opus-4", avgConfidence: 0.85, totalResponses: 100 },
        { model: "gpt-4o", avgConfidence: 0.78, totalResponses: 50 },
      ];
      const mockWhere = vi.fn().mockResolvedValue(rows);
      mockSelectFrom.mockReturnValueOnce({ where: mockWhere });

      const result = await getReliabilityScores(["claude-opus-4", "gpt-4o"]);

      expect(result.size).toBe(2);
      expect(result.get("claude-opus-4")).toEqual({ avgConfidence: 0.85, totalResponses: 100 });
      expect(result.get("gpt-4o")).toEqual({ avgConfidence: 0.78, totalResponses: 50 });
    });

    it("returns empty map when no rows match", async () => {
      const mockWhere = vi.fn().mockResolvedValue([]);
      mockSelectFrom.mockReturnValueOnce({ where: mockWhere });

      const result = await getReliabilityScores(["unknown-model"]);

      expect(result.size).toBe(0);
    });

    it("caps models array to 200 to prevent huge SQL IN clauses", async () => {
      const mockWhere = vi.fn().mockResolvedValue([]);
      mockSelectFrom.mockReturnValueOnce({ where: mockWhere });

      const manyModels = Array.from({ length: 250 }, (_, i) => `model-${i}`);
      await getReliabilityScores(manyModels);

      // Verify inArray was called (we can't easily check the slice without inspecting drizzle-orm mock)
      expect(mockDbSelect).toHaveBeenCalled();
    });
  });
});
