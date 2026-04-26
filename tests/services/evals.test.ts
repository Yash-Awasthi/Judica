/**
 * Phase 8.11 — Evals Framework Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { runEvalSuite } from "../../src/services/evals.service.js";
import type { EvalCase } from "../../src/services/evals.service.js";

// Mock routeAndCollect used by the LLM judge
vi.mock("../../src/router/index.js", () => ({
  routeAndCollect: vi.fn(),
}));

import { routeAndCollect } from "../../src/router/index.js";
const mockRouteAndCollect = vi.mocked(routeAndCollect);

const GOOD_JUDGE_RESPONSE = JSON.stringify({
  faithfulness: 5,
  relevance: 5,
  completeness: 4,
  correctness: 5,
  conciseness: 4,
  reasoning: "Response is accurate and well-grounded in context.",
});

const PASS_CASE: EvalCase = {
  id: "case-1",
  question: "What is the capital of France?",
  expectedAnswer: "Paris is the capital of France.",
  context: ["France is a country in Western Europe. Its capital city is Paris."],
};

const FAIL_CASE: EvalCase = {
  id: "case-2",
  question: "What is 2 + 2?",
  expectedAnswer: "4",
  thresholds: { correctness: 5 }, // high threshold to force failure
};

describe("runEvalSuite (Phase 8.11)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("basic suite execution", () => {
    it("returns a report with correct shape", async () => {
      mockRouteAndCollect.mockResolvedValue({
        text: GOOD_JUDGE_RESPONSE,
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      } as any);

      const getResponse = vi.fn().mockResolvedValue("Paris is the capital of France.");
      const report = await runEvalSuite([PASS_CASE], getResponse);

      expect(report.runId).toMatch(/^eval-\d+$/);
      expect(report.totalCases).toBe(1);
      expect(report.results).toHaveLength(1);
      expect(report.durationMs).toBeGreaterThanOrEqual(0);
      expect(typeof report.passRate).toBe("number");
    });

    it("calls getResponse for each case", async () => {
      mockRouteAndCollect.mockResolvedValue({
        text: GOOD_JUDGE_RESPONSE,
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      } as any);

      const getResponse = vi.fn().mockResolvedValue("Some answer");
      const cases: EvalCase[] = [
        { id: "a", question: "Q1", expectedAnswer: "A1" },
        { id: "b", question: "Q2", expectedAnswer: "A2" },
      ];

      await runEvalSuite(cases, getResponse);

      expect(getResponse).toHaveBeenCalledTimes(2);
      expect(getResponse).toHaveBeenCalledWith("Q1", undefined);
      expect(getResponse).toHaveBeenCalledWith("Q2", undefined);
    });

    it("passes context to getResponse when provided", async () => {
      mockRouteAndCollect.mockResolvedValue({
        text: GOOD_JUDGE_RESPONSE,
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      } as any);

      const getResponse = vi.fn().mockResolvedValue("Paris");
      await runEvalSuite([PASS_CASE], getResponse);

      expect(getResponse).toHaveBeenCalledWith(PASS_CASE.question, PASS_CASE.context);
    });
  });

  describe("scoring and pass/fail", () => {
    it("marks case as passed when all scores meet thresholds", async () => {
      mockRouteAndCollect.mockResolvedValue({
        text: GOOD_JUDGE_RESPONSE,
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      } as any);

      const getResponse = vi.fn().mockResolvedValue("Paris is the capital of France.");
      const report = await runEvalSuite([PASS_CASE], getResponse, { defaultThreshold: 3 });

      expect(report.passedCases).toBe(1);
      expect(report.failedCases).toBe(0);
      expect(report.passRate).toBe(1);
      expect(report.results[0].passed).toBe(true);
      expect(report.results[0].failedDimensions).toEqual([]);
    });

    it("marks case as failed when score is below threshold", async () => {
      // Judge returns low scores
      mockRouteAndCollect.mockResolvedValue({
        text: JSON.stringify({
          faithfulness: 2,
          relevance: 2,
          completeness: 2,
          correctness: 2,
          conciseness: 2,
          reasoning: "Poor response",
        }),
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      } as any);

      const getResponse = vi.fn().mockResolvedValue("I don't know.");
      const report = await runEvalSuite([PASS_CASE], getResponse, { defaultThreshold: 3 });

      expect(report.failedCases).toBe(1);
      expect(report.passRate).toBe(0);
      expect(report.results[0].passed).toBe(false);
      expect(report.results[0].failedDimensions.length).toBeGreaterThan(0);
    });

    it("respects per-case custom thresholds", async () => {
      // Score correctness=4 but case requires 5 → should fail correctness
      mockRouteAndCollect.mockResolvedValue({
        text: JSON.stringify({
          faithfulness: 5,
          relevance: 5,
          completeness: 5,
          correctness: 4,
          conciseness: 5,
          reasoning: "Almost correct",
        }),
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      } as any);

      const getResponse = vi.fn().mockResolvedValue("4");
      const report = await runEvalSuite([FAIL_CASE], getResponse);

      expect(report.results[0].failedDimensions).toContain("correctness");
    });
  });

  describe("keyword fallback scoring", () => {
    it("falls back to keyword scoring when judge returns invalid JSON", async () => {
      mockRouteAndCollect.mockResolvedValue({
        text: "not valid json at all",
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      } as any);

      const getResponse = vi.fn().mockResolvedValue("Paris is the capital of France.");
      const report = await runEvalSuite([PASS_CASE], getResponse);

      // Should still produce a result (not throw)
      expect(report.results).toHaveLength(1);
      expect(report.results[0].reasoning).toContain("JSON parse failed");
    });

    it("falls back to keyword scoring when judge throws", async () => {
      mockRouteAndCollect.mockRejectedValue(new Error("LLM unavailable"));

      const getResponse = vi.fn().mockResolvedValue("Paris");
      const report = await runEvalSuite([PASS_CASE], getResponse);

      expect(report.results).toHaveLength(1);
      expect(report.results[0].reasoning).toContain("keyword fallback");
    });
  });

  describe("aggregation", () => {
    it("computes averageScores across all results", async () => {
      mockRouteAndCollect.mockResolvedValue({
        text: GOOD_JUDGE_RESPONSE,
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      } as any);

      const cases: EvalCase[] = [
        { id: "a", question: "Q1", expectedAnswer: "A1" },
        { id: "b", question: "Q2", expectedAnswer: "A2" },
      ];
      const getResponse = vi.fn().mockResolvedValue("Some answer");
      const report = await runEvalSuite(cases, getResponse);

      expect(report.averageScores.faithfulness).toBe(5);
      expect(report.averageScores.relevance).toBe(5);
    });

    it("worstCases is sorted ascending by overallScore (max 3)", async () => {
      const responses = [
        JSON.stringify({ faithfulness: 5, relevance: 5, completeness: 5, correctness: 5, conciseness: 5, reasoning: "A" }),
        JSON.stringify({ faithfulness: 2, relevance: 2, completeness: 2, correctness: 2, conciseness: 2, reasoning: "B" }),
        JSON.stringify({ faithfulness: 3, relevance: 3, completeness: 3, correctness: 3, conciseness: 3, reasoning: "C" }),
        JSON.stringify({ faithfulness: 4, relevance: 4, completeness: 4, correctness: 4, conciseness: 4, reasoning: "D" }),
      ];
      let callIndex = 0;
      mockRouteAndCollect.mockImplementation(async () => ({
        text: responses[callIndex++ % responses.length],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      } as any));

      const cases: EvalCase[] = responses.map((_, i) => ({
        id: `c${i}`,
        question: `Q${i}`,
        expectedAnswer: `A${i}`,
      }));

      const getResponse = vi.fn().mockResolvedValue("answer");
      const report = await runEvalSuite(cases, getResponse);

      expect(report.worstCases.length).toBeLessThanOrEqual(3);
      // worstCases should be sorted ascending
      const scores = report.worstCases.map(r => r.overallScore);
      for (let i = 1; i < scores.length; i++) {
        expect(scores[i]).toBeGreaterThanOrEqual(scores[i - 1]);
      }
    });
  });

  describe("error handling", () => {
    it("records error response when getResponse throws", async () => {
      mockRouteAndCollect.mockResolvedValue({
        text: GOOD_JUDGE_RESPONSE,
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      } as any);

      const getResponse = vi.fn().mockRejectedValue(new Error("Council exploded"));
      const report = await runEvalSuite([PASS_CASE], getResponse);

      // Should not throw — error captured in response string
      expect(report.results).toHaveLength(1);
      expect(report.results[0].response).toContain("[Error generating response:");
    });
  });
});
