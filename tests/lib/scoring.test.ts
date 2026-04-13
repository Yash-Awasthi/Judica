import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
vi.mock("./logger.js", () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock("../../src/lib/ml/ml_worker.js", () => ({
  mlWorker: {
    computeSimilarity: vi.fn().mockResolvedValue(0.9),
  },
}));

vi.mock("../../src/lib/validation.js", () => ({
  validationModule: {
    validate: vi.fn().mockResolvedValue([]),
  },
}));

describe("Scoring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("scoreOpinions", () => {
    it("should score opinions correctly with high agreement", async () => {
      const { scoreOpinions } = await import("../../src/lib/scoring.js");
      const { mlWorker } = await import("../../src/lib/ml/ml_worker.js");
      const { validationModule } = await import("../../src/lib/validation.js");

      // Set up mocks
      (mlWorker.computeSimilarity as any).mockResolvedValue(1.0);
      (validationModule.validate as any).mockResolvedValue([
        { valid: true, confidence_adjustment: 0 }
      ]);

      const opinions = [
        {
          name: "agent1",
          opinion: "Text 1",
          structured: {
            answer: "The answer is 42.",
            reasoning: "Because it is.",
            key_points: ["Point 1"],
            confidence: 1.0
          }
        },
        {
          name: "agent2",
          opinion: "Text 2",
          structured: {
            answer: "The answer is 42.", // High similarity
            reasoning: "Indeed.",
            key_points: ["Point A"],
            confidence: 0.9
          }
        }
      ] as any;

      const anonymizedLabels = new Map([["agent1", "LabelA"], ["agent2", "LabelB"]]);
      const peerReviews = [
        { ranking: ["LabelA", "LabelB"], reviewer: "agent3", critique: "", identified_flaws: [] }
      ] as any;

      const scored = await scoreOpinions(opinions, peerReviews, anonymizedLabels);

      expect(scored).toHaveLength(2);
      expect(scored[0].scores.agreement).toBe(1.0);
      expect(scored[0].scores.peerRanking).toBe(1.0);
      // final = (0.6 * 1.0) + (0.4 * 1.0) = 1.0
      expect(scored[0].scores.final).toBe(1.0);
    });

    it("should apply penalties for grounding and adversarial issues", async () => {
        const { scoreOpinions } = await import("../../src/lib/scoring.js");
        const { mlWorker } = await import("../../src/lib/ml/ml_worker.js");
        (mlWorker.computeSimilarity as any).mockResolvedValue(1.0);

        const opinions = [
          {
            name: "agent1",
            opinion: "Text 1",
            structured: {
              answer: "A",
              reasoning: "R",
              key_points: ["K"],
              confidence: 1.0
            },
            adversarial: { stress_score: 0.5 }, // Penalty = 0.5 * 0.2 = 0.1
            grounding: { grounded: false, unsupported_claims: ["Claim 1", "Claim 2"] } // Penalty = 2 * 0.05 = 0.1
          }
        ] as any;

        const anonymizedLabels = new Map([["agent1", "LabelA"]]);
        const scored = await scoreOpinions(opinions, [], anonymizedLabels);

        // peerRanking = 0.5 (default for no reviews)
        // final = (0.6 * 1.0) + (0.4 * 0.5) - 0.1 (adv) - 0.1 (ground) = 0.6 + 0.2 - 0.2 = 0.6
        expect(scored[0].scores.final).toBeCloseTo(0.6, 2);
    });

    it("should heavily penalize low agreement", async () => {
        const { scoreOpinions } = await import("../../src/lib/scoring.js");
        const { mlWorker } = await import("../../src/lib/ml/ml_worker.js");
        (mlWorker.computeSimilarity as any).mockResolvedValue(0.2); // Low agreement

        const opinions = [
          { name: "a1", opinion: "o1", structured: { answer: "X", confidence: 1.0, reasoning: "R", key_points: ["K"] } },
          { name: "a2", opinion: "o2", structured: { answer: "Y", confidence: 1.0, reasoning: "R", key_points: ["K"] } }
        ] as any;

        const scored = await scoreOpinions(opinions, [], new Map());
        // agreement = 0.2
        // peerRanking = 0.0 (no labels)
        // final = 0.32 * 0.1 = 0.032
        expect(scored[0].scores.final).toBeCloseTo(0.032, 3);
    });
  });

  describe("filterAndRank", () => {
    it("should filter scores below threshold and sort descending", async () => {
      const { filterAndRank } = await import("../../src/lib/scoring.js");
      const scored = [
        { name: "low", scores: { final: 0.2 } },
        { name: "high", scores: { final: 0.8 } },
        { name: "mid", scores: { final: 0.5 } }
      ] as any;

      const filtered = filterAndRank(scored, 0.3);
      expect(filtered).toHaveLength(2);
      expect(filtered[0].name).toBe("high");
      expect(filtered[1].name).toBe("mid");
    });
  });
});
