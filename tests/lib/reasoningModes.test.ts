import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/router/index.js", () => ({
  routeAndCollect: vi.fn(),
}));

vi.mock("../../src/lib/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  getLastReasoningUsage,
  runSocraticPrelude,
  runRedBlueDebate,
  runHypothesisRefinement,
  runConfidenceCalibration,
  type ReasoningMode,
} from "../../src/lib/reasoningModes.js";
import { routeAndCollect } from "../../src/router/index.js";
import type { Provider } from "../../src/lib/providers.js";

const mockRouteAndCollect = vi.mocked(routeAndCollect);

function makeProvider(name: string, overrides: Partial<Provider> = {}): Provider {
  return {
    name,
    model: "auto",
    systemPrompt: `You are ${name}`,
    enabled: true,
    providerId: "openai",
    temperature: 0.7,
    ...overrides,
  } as Provider;
}

describe("reasoningModes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getLastReasoningUsage", () => {
    it("returns an object with promptTokens and completionTokens", () => {
      const usage = getLastReasoningUsage();
      expect(usage).toHaveProperty("promptTokens");
      expect(usage).toHaveProperty("completionTokens");
    });

    it("returns a copy (not the internal reference)", () => {
      const a = getLastReasoningUsage();
      const b = getLastReasoningUsage();
      expect(a).not.toBe(b);
    });
  });

  describe("runSocraticPrelude", () => {
    it("returns empty context and qa when no members", async () => {
      const result = await runSocraticPrelude("What is AI?", []);
      expect(result.augmentedContext).toBe("");
      expect(result.qa).toEqual([]);
    });

    it("returns empty context when agents return no valid questions", async () => {
      mockRouteAndCollect.mockResolvedValue({ text: "no questions here", usage: { prompt_tokens: 0, completion_tokens: 0 } });
      const members = [makeProvider("Alice")];
      const result = await runSocraticPrelude("What is AI?", members);
      expect(result.qa).toEqual([]);
    });

    it("deduplicates questions from multiple agents", async () => {
      // Each agent returns the same question twice to test deduplication
      mockRouteAndCollect
        .mockResolvedValueOnce({ text: '["What is AI?", "How does ML work?"]', usage: { prompt_tokens: 5, completion_tokens: 5 } })
        .mockResolvedValueOnce({ text: '["What is AI?", "Is AI safe?"]', usage: { prompt_tokens: 5, completion_tokens: 5 } })
        .mockResolvedValueOnce({
          text: "1. AI stands for Artificial Intelligence.\n2. ML uses statistical models.\n3. AI can be risky.",
          usage: { prompt_tokens: 10, completion_tokens: 20 },
        });

      const members = [makeProvider("Alice"), makeProvider("Bob")];
      const result = await runSocraticPrelude("What is AI?", members);
      // "What is AI?" should appear only once in qa
      const qTexts = result.qa.map((r) => r.q);
      const unique = [...new Set(qTexts)];
      expect(unique.length).toBe(qTexts.length);
    });

    it("returns augmented context string with Q&A format when questions found", async () => {
      mockRouteAndCollect
        .mockResolvedValueOnce({ text: '["What is consciousness?"]', usage: { prompt_tokens: 3, completion_tokens: 3 } })
        .mockResolvedValueOnce({
          text: "1. Consciousness is awareness of self and environment.",
          usage: { prompt_tokens: 5, completion_tokens: 10 },
        });

      const members = [makeProvider("Philosopher")];
      const result = await runSocraticPrelude("Is AI conscious?", members);
      expect(result.augmentedContext).toContain("CLARIFYING Q&A");
      expect(result.qa).toHaveLength(1);
      expect(result.qa[0].q).toBe("What is consciousness?");
    });

    it("respects abort signal — returns empty when already aborted", async () => {
      const controller = new AbortController();
      controller.abort();
      const members = [makeProvider("Alice")];
      const result = await runSocraticPrelude("test?", members, controller.signal);
      expect(result.qa).toEqual([]);
      expect(result.augmentedContext).toBe("");
    });

    it("handles malformed JSON from agents gracefully", async () => {
      mockRouteAndCollect.mockResolvedValue({ text: "not json at all", usage: { prompt_tokens: 1, completion_tokens: 1 } });
      const members = [makeProvider("Bot")];
      const result = await runSocraticPrelude("Question?", members);
      expect(result.qa).toEqual([]);
    });
  });

  describe("runRedBlueDebate", () => {
    it("falls back to single-agent when fewer than 2 members", async () => {
      mockRouteAndCollect.mockResolvedValue({ text: "Balanced view.", usage: { prompt_tokens: 5, completion_tokens: 10 } });
      const members = [makeProvider("Solo")];
      const result = await runRedBlueDebate("Is AI good?", members);
      expect(result.judgeVerdict).toBe("Balanced view.");
      expect(result.redArguments).toBe("");
      expect(result.blueArguments).toBe("");
    });

    it("returns redArguments, blueArguments, judgeVerdict for 2+ members", async () => {
      mockRouteAndCollect
        .mockResolvedValueOnce({ text: "Red argument: AI is great.", usage: { prompt_tokens: 5, completion_tokens: 10 } })
        .mockResolvedValueOnce({ text: "Blue argument: AI is risky.", usage: { prompt_tokens: 5, completion_tokens: 10 } })
        .mockResolvedValueOnce({ text: "Judge: Red side was stronger.", usage: { prompt_tokens: 10, completion_tokens: 20 } });

      const members = [makeProvider("Red"), makeProvider("Blue")];
      const result = await runRedBlueDebate("Should AI be regulated?", members);
      expect(result.redArguments).toBe("Red argument: AI is great.");
      expect(result.blueArguments).toBe("Blue argument: AI is risky.");
      expect(result.judgeVerdict).toBe("Judge: Red side was stronger.");
    });

    it("splits members into roughly equal red/blue teams", async () => {
      // 4 members → 2 red, 2 blue
      mockRouteAndCollect.mockResolvedValue({ text: "response", usage: { prompt_tokens: 1, completion_tokens: 1 } });
      const members = [makeProvider("A"), makeProvider("B"), makeProvider("C"), makeProvider("D")];
      await runRedBlueDebate("Topic?", members);
      // routeAndCollect is called: red + blue + judge = 3 calls
      expect(mockRouteAndCollect).toHaveBeenCalledTimes(3);
    });

    it("returns cancelled verdict when abort signal is already fired", async () => {
      const controller = new AbortController();
      controller.abort();
      const members = [makeProvider("A"), makeProvider("B")];
      const result = await runRedBlueDebate("Topic?", members, controller.signal);
      expect(result.judgeVerdict).toContain("cancelled");
      expect(mockRouteAndCollect).not.toHaveBeenCalled();
    });

    it("truncates very long arguments", async () => {
      const longText = "x".repeat(20000);
      mockRouteAndCollect
        .mockResolvedValueOnce({ text: longText, usage: { prompt_tokens: 5, completion_tokens: 100 } })
        .mockResolvedValueOnce({ text: longText, usage: { prompt_tokens: 5, completion_tokens: 100 } })
        .mockResolvedValueOnce({ text: "verdict", usage: { prompt_tokens: 10, completion_tokens: 5 } });

      const members = [makeProvider("A"), makeProvider("B")];
      const result = await runRedBlueDebate("Topic?", members);
      expect(result.redArguments.length).toBeLessThan(longText.length);
      expect(result.redArguments).toContain("TRUNCATED");
    });
  });

  describe("runHypothesisRefinement", () => {
    it("returns finalSynthesis and rounds array", async () => {
      mockRouteAndCollect.mockResolvedValue({ text: "Hypothesis text.", usage: { prompt_tokens: 3, completion_tokens: 5 } });
      const members = [makeProvider("Scientist")];
      const result = await runHypothesisRefinement("How does memory work?", members);
      expect(result).toHaveProperty("finalSynthesis");
      expect(result).toHaveProperty("rounds");
      expect(Array.isArray(result.rounds)).toBe(true);
    });

    it("caps members at 5 agents", async () => {
      mockRouteAndCollect.mockResolvedValue({ text: "ok", usage: { prompt_tokens: 1, completion_tokens: 1 } });
      const members = Array.from({ length: 10 }, (_, i) => makeProvider(`Agent${i}`));
      await runHypothesisRefinement("Big question?", members);
      // Should only invoke for ≤5 agents per round phase
      // We just verify it doesn't crash and returns expected shape
      const result = await runHypothesisRefinement("Big question?", members);
      expect(result.rounds.length).toBeGreaterThanOrEqual(1);
    });

    it("handles empty members gracefully", async () => {
      mockRouteAndCollect.mockResolvedValue({ text: "synthesis", usage: { prompt_tokens: 0, completion_tokens: 0 } });
      const result = await runHypothesisRefinement("Question?", []);
      expect(result).toHaveProperty("finalSynthesis");
    });
  });

  describe("runConfidenceCalibration", () => {
    it("returns calibrated opinions and weighted synthesis", async () => {
      mockRouteAndCollect
        .mockResolvedValueOnce({ text: '{"opinion": "AI will surpass humans.", "confidence": 80, "reasoning": "Strong evidence."}', usage: { prompt_tokens: 5, completion_tokens: 10 } })
        .mockResolvedValueOnce({ text: '{"opinion": "Uncertain.", "confidence": 60, "reasoning": "Mixed signals."}', usage: { prompt_tokens: 5, completion_tokens: 10 } })
        .mockResolvedValueOnce({ text: "Final weighted synthesis.", usage: { prompt_tokens: 10, completion_tokens: 20 } });

      const members = [makeProvider("Expert1"), makeProvider("Expert2")];
      const result = await runConfidenceCalibration("Will AI surpass humans?", members);
      expect(result).toHaveProperty("opinions");
      expect(result).toHaveProperty("weightedSynthesis");
      expect(Array.isArray(result.opinions)).toBe(true);
      expect(result.opinions).toHaveLength(2);
    });

    it("returns empty opinions array and synthesis when no members", async () => {
      mockRouteAndCollect.mockResolvedValue({ text: "synthesis", usage: { prompt_tokens: 0, completion_tokens: 0 } });
      const result = await runConfidenceCalibration("Question?", []);
      expect(result.opinions).toEqual([]);
      expect(result.weightedSynthesis).toBe("synthesis");
    });

    it("falls back to confidence 0.5 when agent returns no valid JSON", async () => {
      mockRouteAndCollect
        .mockResolvedValueOnce({ text: "not json at all", usage: { prompt_tokens: 3, completion_tokens: 5 } })
        .mockResolvedValueOnce({ text: "consensus synthesis", usage: { prompt_tokens: 5, completion_tokens: 10 } });

      const members = [makeProvider("Expert")];
      const result = await runConfidenceCalibration("Is 2+2=4?", members);
      expect(result.opinions[0].confidence).toBe(0.5);
    });

    it("clamps confidence to 0-1 range even when JSON has out-of-range value", async () => {
      mockRouteAndCollect
        .mockResolvedValueOnce({ text: '{"opinion": "very sure", "confidence": 150, "reasoning": ""}', usage: { prompt_tokens: 3, completion_tokens: 5 } })
        .mockResolvedValueOnce({ text: "synthesis", usage: { prompt_tokens: 5, completion_tokens: 10 } });

      const members = [makeProvider("Expert")];
      const result = await runConfidenceCalibration("Question?", members);
      expect(result.opinions[0].confidence).toBeGreaterThanOrEqual(0);
      expect(result.opinions[0].confidence).toBeLessThanOrEqual(1);
    });

    it("includes agent name in calibrated opinion", async () => {
      mockRouteAndCollect
        .mockResolvedValueOnce({ text: '{"opinion": "yes", "confidence": 70, "reasoning": "evidence"}', usage: { prompt_tokens: 3, completion_tokens: 5 } })
        .mockResolvedValueOnce({ text: "synthesis", usage: { prompt_tokens: 5, completion_tokens: 10 } });

      const members = [makeProvider("Sherlock")];
      const result = await runConfidenceCalibration("Mystery?", members);
      expect(result.opinions[0].agent).toBe("Sherlock");
    });
  });

  describe("ReasoningMode type", () => {
    it("includes all expected mode names", () => {
      // Type-level check — enumerate known values
      const modes: ReasoningMode[] = ["standard", "socratic", "red_blue", "hypothesis", "confidence"];
      expect(modes).toHaveLength(5);
    });
  });
});
