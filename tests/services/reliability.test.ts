import { describe, it, expect, vi, beforeEach } from "vitest";
import { db } from "../../src/lib/drizzle.js";
import { modelReliability } from "../../src/db/schema/traces.js";

// ─── Mocks ────────────────────────────────────────────────────────────────────

let mockInsertValues: any;
let mockOnConflictDoUpdate: ReturnType<typeof vi.fn>;
let mockSelectRows: any[];

vi.mock("../../src/lib/drizzle.js", () => {
  const mockOnConflictDoUpdate = vi.fn().mockResolvedValue([]);
  const mockValues = vi.fn(() => ({ onConflictDoUpdate: mockOnConflictDoUpdate }));
  const mockInsert = vi.fn(() => ({ values: mockValues }));

  const mockLimit = vi.fn(async () => []);
  const mockWhere = vi.fn(() => ({ limit: mockLimit }));
  const mockFrom = vi.fn(() => ({ where: mockWhere }));
  const mockSelect = vi.fn(() => ({ from: mockFrom }));

  return {
    db: {
      insert: mockInsert,
      select: mockSelect,
      __mock: { mockLimit, mockWhere, mockFrom, mockOnConflictDoUpdate, mockValues },
    },
  };
});

vi.mock("../../src/lib/logger.js", () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

// Helpers to access inner mocks
function getDbMock() {
  return (db as any).__mock as {
    mockLimit: ReturnType<typeof vi.fn>;
    mockWhere: ReturnType<typeof vi.fn>;
    mockFrom: ReturnType<typeof vi.fn>;
    mockOnConflictDoUpdate: ReturnType<typeof vi.fn>;
    mockValues: ReturnType<typeof vi.fn>;
  };
}

// Import after mocks
import {
  updateReliability,
  getReliabilityScores,
} from "../../src/services/reliability.service.js";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("reliability.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const m = getDbMock();
    // Reset mockLimit to return no existing rows by default
    m.mockLimit.mockResolvedValue([]);
    m.mockOnConflictDoUpdate.mockResolvedValue([]);
  });

  // ─── updateReliability ────────────────────────────────────────────────────

  describe("updateReliability", () => {
    it("should do nothing when conflicts and concessions are both empty", async () => {
      await updateReliability([], [], new Map());
      expect(db.insert).not.toHaveBeenCalled();
      expect(db.select).not.toHaveBeenCalled();
    });

    it("should track conflicts: both models get contradicted incremented", async () => {
      const memberModels = new Map([
        ["agent-1", "gpt-4"],
        ["agent-2", "claude-3"],
      ]);
      const conflicts = [{ agentA: "agent-1", agentB: "agent-2" }];

      await updateReliability(conflicts, [], memberModels);

      // Should upsert for both models
      expect(db.insert).toHaveBeenCalledTimes(2);

      const calls = vi.mocked(getDbMock().mockValues).mock.calls;
      const insertedModels = calls.map((c: any) => c[0].model);
      expect(insertedModels).toContain("gpt-4");
      expect(insertedModels).toContain("claude-3");

      // Each model should have contradicted=1, agreedWith=0
      const gpt4Call = calls.find((c: any) => c[0].model === "gpt-4")![0];
      expect(gpt4Call.contradicted).toBe(1);
      expect(gpt4Call.agreedWith).toBe(0);

      const claudeCall = calls.find((c: any) => c[0].model === "claude-3")![0];
      expect(claudeCall.contradicted).toBe(1);
      expect(claudeCall.agreedWith).toBe(0);
    });

    it("should use modelA/modelB from conflict when provided instead of memberModels", async () => {
      const memberModels = new Map([
        ["agent-1", "fallback-model-a"],
        ["agent-2", "fallback-model-b"],
      ]);
      const conflicts = [
        { agentA: "agent-1", agentB: "agent-2", modelA: "gpt-4", modelB: "claude-3" },
      ];

      await updateReliability(conflicts, [], memberModels);

      const calls = vi.mocked(getDbMock().mockValues).mock.calls;
      const insertedModels = calls.map((c: any) => c[0].model);
      expect(insertedModels).toContain("gpt-4");
      expect(insertedModels).toContain("claude-3");
      expect(insertedModels).not.toContain("fallback-model-a");
      expect(insertedModels).not.toContain("fallback-model-b");
    });

    it("should track concessions: increment agreedWith for conceding agent's model", async () => {
      const memberModels = new Map([
        ["agent-1", "gpt-4"],
        ["agent-2", "claude-3"],
      ]);

      await updateReliability([], ["agent-1"], memberModels);

      expect(db.insert).toHaveBeenCalledTimes(1);
      const calls = vi.mocked(getDbMock().mockValues).mock.calls;
      expect(calls[0][0].model).toBe("gpt-4");
      expect(calls[0][0].agreedWith).toBe(1);
      expect(calls[0][0].contradicted).toBe(0);
    });

    it("should ignore concessions for agents not in memberModels", async () => {
      const memberModels = new Map([["agent-1", "gpt-4"]]);

      await updateReliability([], ["unknown-agent"], memberModels);

      expect(db.insert).not.toHaveBeenCalled();
    });

    it("should combine conflicts and concessions for the same model", async () => {
      const memberModels = new Map([
        ["agent-1", "gpt-4"],
        ["agent-2", "claude-3"],
      ]);
      const conflicts = [{ agentA: "agent-1", agentB: "agent-2" }];
      const concessions = ["agent-1"]; // agent-1 (gpt-4) also concedes

      await updateReliability(conflicts, concessions, memberModels);

      const calls = vi.mocked(getDbMock().mockValues).mock.calls;
      const gpt4Call = calls.find((c: any) => c[0].model === "gpt-4")![0];
      expect(gpt4Call.contradicted).toBe(1);
      expect(gpt4Call.agreedWith).toBe(1);
      expect(gpt4Call.totalResponses).toBe(1);
    });

    it("should accumulate multiple conflicts for the same model", async () => {
      const memberModels = new Map([
        ["agent-1", "gpt-4"],
        ["agent-2", "claude-3"],
        ["agent-3", "gpt-4"], // same model as agent-1
      ]);
      const conflicts = [
        { agentA: "agent-1", agentB: "agent-2" },
        { agentA: "agent-3", agentB: "agent-2" }, // gpt-4 contradicted again
      ];

      await updateReliability(conflicts, [], memberModels);

      const calls = vi.mocked(getDbMock().mockValues).mock.calls;
      // gpt-4 should have contradicted=2 (once for agent-1, once for agent-3)
      const gpt4Call = calls.find((c: any) => c[0].model === "gpt-4")![0];
      expect(gpt4Call.contradicted).toBe(2);

      // claude-3 should have contradicted=2 (both conflicts involve agent-2)
      const claudeCall = calls.find((c: any) => c[0].model === "claude-3")![0];
      expect(claudeCall.contradicted).toBe(2);
    });

    // ─── Score formula ────────────────────────────────────────────────────

    describe("score formula: 70% agreement + 30% error rate", () => {
      it("should compute correct score for fresh model with no prior data", async () => {
        // No existing row -> contradicted=1, agreedWith=0, totalResponses=1, toolErrors=0
        const memberModels = new Map([
          ["a1", "model-x"],
          ["a2", "model-y"],
        ]);
        await updateReliability([{ agentA: "a1", agentB: "a2" }], [], memberModels);

        const calls = vi.mocked(getDbMock().mockValues).mock.calls;
        const modelXCall = calls.find((c: any) => c[0].model === "model-x")![0];

        // agreementScore = 0 / (0 + 1 + 1) = 0
        // errorScore = 1 - 0/(1+1) = 1
        // avgConfidence = 0 * 0.7 + 1 * 0.3 = 0.3
        expect(modelXCall.avgConfidence).toBeCloseTo(0.3, 5);
      });

      it("should compute correct score for fresh model with concession only", async () => {
        const memberModels = new Map([["a1", "model-x"]]);
        await updateReliability([], ["a1"], memberModels);

        const calls = vi.mocked(getDbMock().mockValues).mock.calls;
        const row = calls[0][0];

        // agreedWith=1, contradicted=0, totalResponses=1, toolErrors=0
        // agreementScore = 1 / (1 + 0 + 1) = 0.5
        // errorScore = 1 - 0/(1+1) = 1
        // avgConfidence = 0.5 * 0.7 + 1 * 0.3 = 0.35 + 0.3 = 0.65
        expect(row.avgConfidence).toBeCloseTo(0.65, 5);
      });

      it("should compute correct score incorporating existing data (upsert)", async () => {
        // Simulate an existing row in DB
        const m = getDbMock();
        m.mockLimit.mockResolvedValue([
          {
            model: "model-x",
            totalResponses: 10,
            agreedWith: 5,
            contradicted: 2,
            toolErrors: 1,
            avgConfidence: 0.5,
          },
        ]);

        const memberModels = new Map([["a1", "model-x"]]);
        // One new concession -> agreedWith delta=1
        await updateReliability([], ["a1"], memberModels);

        const calls = vi.mocked(getDbMock().mockValues).mock.calls;
        const row = calls[0][0];

        // totalResponses = 10 + 1 = 11
        // agreedWith = 5 + 1 = 6
        // contradicted = 2 + 0 = 2
        // toolErrors = 1 (unchanged)
        expect(row.totalResponses).toBe(11);
        expect(row.agreedWith).toBe(6);
        expect(row.contradicted).toBe(2);
        expect(row.toolErrors).toBe(1);

        // agreementScore = 6 / (6 + 2 + 1) = 6/9
        // errorScore = 1 - 1/(11+1) = 1 - 1/12 = 11/12
        // avgConfidence = (6/9) * 0.7 + (11/12) * 0.3
        const expected = (6 / 9) * 0.7 + (11 / 12) * 0.3;
        expect(row.avgConfidence).toBeCloseTo(expected, 5);
      });

      it("should preserve existing toolErrors in score calculation", async () => {
        const m = getDbMock();
        m.mockLimit.mockResolvedValue([
          {
            model: "model-x",
            totalResponses: 20,
            agreedWith: 10,
            contradicted: 5,
            toolErrors: 4,
            avgConfidence: 0.5,
          },
        ]);

        const memberModels = new Map([
          ["a1", "model-x"],
          ["a2", "model-y"],
        ]);
        await updateReliability([{ agentA: "a1", agentB: "a2" }], [], memberModels);

        const calls = vi.mocked(getDbMock().mockValues).mock.calls;
        const modelXRow = calls.find((c: any) => c[0].model === "model-x")![0];

        // totalResponses = 20 + 1 = 21
        // agreedWith = 10 + 0 = 10, contradicted = 5 + 1 = 6, toolErrors = 4
        // agreementScore = 10 / (10 + 6 + 1) = 10/17
        // errorScore = 1 - 4/(21+1) = 1 - 4/22 = 18/22
        const expected = (10 / 17) * 0.7 + (18 / 22) * 0.3;
        expect(modelXRow.avgConfidence).toBeCloseTo(expected, 5);
      });
    });

    // ─── Upsert behavior ──────────────────────────────────────────────────

    describe("upsert behavior", () => {
      it("should call insert with onConflictDoUpdate for each model", async () => {
        const memberModels = new Map([["a1", "gpt-4"]]);
        await updateReliability([], ["a1"], memberModels);

        expect(db.insert).toHaveBeenCalledWith(modelReliability);
        expect(getDbMock().mockOnConflictDoUpdate).toHaveBeenCalledWith(
          expect.objectContaining({
            target: modelReliability.model,
            set: expect.objectContaining({
              totalResponses: expect.any(Number),
              agreedWith: expect.any(Number),
              contradicted: expect.any(Number),
              avgConfidence: expect.any(Number),
            }),
          })
        );
      });

      it("should set updatedAt on both insert values and conflict update set", async () => {
        const memberModels = new Map([["a1", "gpt-4"]]);
        await updateReliability([], ["a1"], memberModels);

        const valuesCall = getDbMock().mockValues.mock.calls[0][0];
        expect(valuesCall.updatedAt).toBeInstanceOf(Date);

        const conflictCall = getDbMock().mockOnConflictDoUpdate.mock.calls[0][0];
        expect(conflictCall.set.updatedAt).toBeInstanceOf(Date);
      });

      it("should select existing row before upserting", async () => {
        const memberModels = new Map([["a1", "gpt-4"]]);
        await updateReliability([], ["a1"], memberModels);

        expect(db.select).toHaveBeenCalled();
      });
    });

    // ─── Multiple models ──────────────────────────────────────────────────

    describe("multiple models", () => {
      it("should upsert independently for each distinct model", async () => {
        const memberModels = new Map([
          ["a1", "gpt-4"],
          ["a2", "claude-3"],
          ["a3", "gemini"],
        ]);
        const conflicts = [
          { agentA: "a1", agentB: "a2" },
          { agentA: "a2", agentB: "a3" },
        ];
        const concessions = ["a3"];

        await updateReliability(conflicts, concessions, memberModels);

        // All 3 models should be upserted
        expect(db.insert).toHaveBeenCalledTimes(3);

        const calls = vi.mocked(getDbMock().mockValues).mock.calls;
        const models = calls.map((c: any) => c[0].model);
        expect(models).toContain("gpt-4");
        expect(models).toContain("claude-3");
        expect(models).toContain("gemini");

        // gpt-4: contradicted=1, agreedWith=0
        const gpt4 = calls.find((c: any) => c[0].model === "gpt-4")![0];
        expect(gpt4.contradicted).toBe(1);
        expect(gpt4.agreedWith).toBe(0);

        // claude-3: contradicted=2 (both conflicts), agreedWith=0
        const claude = calls.find((c: any) => c[0].model === "claude-3")![0];
        expect(claude.contradicted).toBe(2);
        expect(claude.agreedWith).toBe(0);

        // gemini: contradicted=1, agreedWith=1
        const gemini = calls.find((c: any) => c[0].model === "gemini")![0];
        expect(gemini.contradicted).toBe(1);
        expect(gemini.agreedWith).toBe(1);
      });
    });

    // ─── Error handling ───────────────────────────────────────────────────

    it("should catch and log errors without throwing", async () => {
      const logger = (await import("../../src/lib/logger.js")).default;
      vi.mocked(db.select).mockImplementationOnce(() => {
        throw new Error("DB down");
      });

      const memberModels = new Map([["a1", "gpt-4"]]);
      // Should not throw
      await expect(
        updateReliability([{ agentA: "a1", agentB: "a1" }], [], memberModels)
      ).resolves.toBeUndefined();

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        "Failed to update model reliability scores"
      );
    });
  });

  // ─── getReliabilityScores ───────────────────────────────────────────────────

  describe("getReliabilityScores", () => {
    it("should return an empty map for empty models array", async () => {
      const result = await getReliabilityScores([]);
      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(0);
      // Should not query DB at all
      expect(db.select).not.toHaveBeenCalled();
    });

    it("should query DB and return scores for requested models", async () => {
      const m = getDbMock();
      // For getReliabilityScores, chain is select().from().where() -> rows
      m.mockFrom.mockReturnValueOnce({
        where: vi.fn().mockResolvedValue([
          { model: "gpt-4", avgConfidence: 0.85, totalResponses: 50 },
          { model: "claude-3", avgConfidence: 0.72, totalResponses: 30 },
        ]),
      });

      const result = await getReliabilityScores(["gpt-4", "claude-3"]);

      expect(result.size).toBe(2);
      expect(result.get("gpt-4")).toEqual({ avgConfidence: 0.85, totalResponses: 50 });
      expect(result.get("claude-3")).toEqual({ avgConfidence: 0.72, totalResponses: 30 });
    });

    it("should return only models found in DB (partial match)", async () => {
      const m = getDbMock();
      m.mockFrom.mockReturnValueOnce({
        where: vi.fn().mockResolvedValue([
          { model: "gpt-4", avgConfidence: 0.85, totalResponses: 50 },
        ]),
      });

      const result = await getReliabilityScores(["gpt-4", "nonexistent-model"]);

      expect(result.size).toBe(1);
      expect(result.has("gpt-4")).toBe(true);
      expect(result.has("nonexistent-model")).toBe(false);
    });

    it("should return empty map when no models are found in DB", async () => {
      const m = getDbMock();
      m.mockFrom.mockReturnValueOnce({
        where: vi.fn().mockResolvedValue([]),
      });

      const result = await getReliabilityScores(["nonexistent"]);

      expect(result.size).toBe(0);
    });
  });
});
