import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/lib/drizzle.js", () => ({
  db: {
    insert: vi.fn(() => ({
      values: vi.fn().mockResolvedValue(undefined),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn().mockResolvedValue([]),
        })),
      })),
    })),
  },
}));

vi.mock("../../src/db/schema/users.js", () => ({
  evaluations: {
    userId: "userId",
    timestamp: "timestamp",
    overallScore: "overallScore",
  },
}));

vi.mock("../../src/lib/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../src/lib/metrics.js", () => ({
  computeConsensus: vi.fn().mockResolvedValue(0.75),
  pairwiseSimilarity: vi.fn().mockResolvedValue(0.8),
}));

vi.mock("../../src/lib/schemas.js", () => ({
  AgentOutput: {},
}));

import { evaluateCouncilSession } from "../../src/lib/evaluation.js";
import { db } from "../../src/lib/drizzle.js";
import type { EvaluationResult } from "../../src/lib/evaluation.js";

function makeAgentOutput(overrides: Partial<any> = {}) {
  return {
    answer: "A".repeat(100),
    reasoning: "R".repeat(200),
    key_points: ["point one", "point two", "point three"],
    assumptions: ["assumption one"],
    confidence: 0.7,
    ...overrides,
  };
}

describe("Evaluation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("evaluateCouncilSession", () => {
    it("calculates criteria scores and returns an overall score", async () => {
      const outputs = [
        makeAgentOutput({ confidence: 0.6 }),
        makeAgentOutput({ confidence: 0.8 }),
        makeAgentOutput({ confidence: 0.7 }),
      ];

      const result: EvaluationResult = await evaluateCouncilSession(
        "session-1",
        "conv-1",
        1,
        outputs,
        3000,
        30000
      );

      expect(result.sessionId).toBe("session-1");
      expect(result.conversationId).toBe("conv-1");
      expect(result.userId).toBe(1);
      expect(result.criteria).toBeDefined();
      expect(result.criteria.coherence).toBeGreaterThanOrEqual(0);
      expect(result.criteria.coherence).toBeLessThanOrEqual(1);
      expect(result.criteria.consensus).toBeGreaterThanOrEqual(0);
      expect(result.criteria.consensus).toBeLessThanOrEqual(1);
      expect(result.criteria.diversity).toBeGreaterThanOrEqual(0);
      expect(result.criteria.quality).toBeGreaterThanOrEqual(0);
      expect(result.criteria.efficiency).toBeGreaterThanOrEqual(0);
      expect(result.overallScore).toBeGreaterThanOrEqual(0);
      expect(result.overallScore).toBeLessThanOrEqual(100);
      expect(result.timestamp).toBeInstanceOf(Date);
    });

    it("generates recommendations based on criteria scores", async () => {
      const outputs = [
        makeAgentOutput({ confidence: 0.5 }),
        makeAgentOutput({ confidence: 0.5 }),
      ];

      const result = await evaluateCouncilSession(
        "session-2",
        "conv-2",
        2,
        outputs,
        5000,
        60000
      );

      expect(result.recommendations).toBeInstanceOf(Array);
      expect(result.strengths).toBeInstanceOf(Array);
      expect(result.weaknesses).toBeInstanceOf(Array);
    });

    it("stores evaluation results via db.insert", async () => {
      const outputs = [
        makeAgentOutput(),
        makeAgentOutput({ confidence: 0.9 }),
      ];

      await evaluateCouncilSession("session-3", "conv-3", 3, outputs, 2000, 20000);

      expect(db.insert).toHaveBeenCalled();
    });

    it("handles single agent output with full coherence", async () => {
      const outputs = [makeAgentOutput()];

      const result = await evaluateCouncilSession(
        "session-single",
        "conv-single",
        1,
        outputs,
        1000,
        10000
      );

      expect(result.criteria.coherence).toBe(1);
    });

    it("identifies strengths when criteria scores are high", async () => {
      const outputs = [
        makeAgentOutput({ confidence: 0.85 }),
        makeAgentOutput({ confidence: 0.85 }),
      ];

      const result = await evaluateCouncilSession(
        "session-good",
        "conv-good",
        1,
        outputs,
        2000,
        20000
      );

      expect(typeof result.overallScore).toBe("number");
      expect(result.strengths).toBeInstanceOf(Array);
    });
  });
});
