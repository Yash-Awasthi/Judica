import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock ALL dependencies
vi.mock("../../src/lib/providers.js", () => ({
  askProvider: vi.fn(),
  askProviderStream: vi.fn(),
}));

vi.mock("../../src/lib/logger.js", () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../src/lib/errorMapper.js", () => ({
  mapProviderError: vi.fn(e => e.message),
}));

vi.mock("../../src/lib/schemas.js", () => ({
  parseAgentOutput: vi.fn(text => {
    try { return JSON.parse(text); } catch { return null; }
  }),
}));

vi.mock("../../src/lib/adversarial.js", () => ({
  adversarialModule: { challenge: vi.fn().mockResolvedValue({ issues: [] }) },
}));

vi.mock("../../src/lib/grounding.js", () => ({
  groundingModule: { verify: vi.fn().mockResolvedValue({ issues: [] }) },
}));

vi.mock("../../src/lib/metrics.js", () => ({
  computeConsensus: vi.fn().mockResolvedValue(0.5),
}));

vi.mock("../../src/config/fallbacks.js", () => ({
  getFallbackProvider: vi.fn(),
}));

vi.mock("../../src/lib/scoring.js", () => ({
  scoreOpinions: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../src/lib/validation.js", () => ({
  validationModule: { validateText: vi.fn().mockResolvedValue([]) },
}));

describe("Deliberation Phases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("gatherOpinions", () => {
    it("should gather opinions from members", async () => {
      const { gatherOpinions } = await import("../../src/lib/deliberationPhases.js");
      const { askProviderStream } = await import("../../src/lib/providers.js");

      vi.mocked(askProviderStream).mockResolvedValue({
        text: JSON.stringify({ answer: "Hello" }),
        usage: { totalTokens: 10 }
      } as any);

      const members: any[] = [{ name: "M1" }];
      const result = await gatherOpinions({
        members,
        currentMessages: [],
        round: 1
      });

      expect(result.opinions).toHaveLength(1);
      expect(result.totalTokens).toBe(10);
      expect(result.opinions[0].name).toBe("M1");
    });

    it("should retry if JSON is invalid", async () => {
      const { gatherOpinions } = await import("../../src/lib/deliberationPhases.js");
      const { askProviderStream } = await import("../../src/lib/providers.js");

      vi.mocked(askProviderStream)
        .mockResolvedValueOnce({ text: "not json", usage: { totalTokens: 5 } } as any)
        .mockResolvedValueOnce({ text: JSON.stringify({ answer: "Fixed" }), usage: { totalTokens: 5 } } as any);

      const result = await gatherOpinions({ members: [{ name: "M1" }] as any, currentMessages: [], round: 1 });
      expect(result.opinions[0].structured?.answer).toBe("Fixed");
      expect(askProviderStream).toHaveBeenCalledTimes(2);
    });

    it("should use fallback if primary fails", async () => {
      const { gatherOpinions } = await import("../../src/lib/deliberationPhases.js");
      const { askProviderStream } = await import("../../src/lib/providers.js");
      const { getFallbackProvider } = await import("../../src/config/fallbacks.js");

      vi.mocked(askProviderStream).mockRejectedValueOnce(new Error("Fail")).mockResolvedValueOnce({
        text: JSON.stringify({ answer: "Fallback" }),
        usage: { totalTokens: 10 }
      } as any);
      vi.mocked(getFallbackProvider).mockReturnValue({ name: "Fallback" } as any);

      const result = await gatherOpinions({ members: [{ name: "M1" }] as any, currentMessages: [], round: 1 });
      expect(result.opinions[0].isFallback).toBe(true);
      expect(result.opinions[0].structured?.answer).toBe("Fallback");
    });

    it("should throw if no valid responses after all attempts", async () => {
      const { gatherOpinions } = await import("../../src/lib/deliberationPhases.js");
      const { askProviderStream } = await import("../../src/lib/providers.js");
      vi.mocked(askProviderStream).mockRejectedValue(new Error("Epic Fail"));

      await expect(gatherOpinions({ members: [{ name: "M1" }] as any, currentMessages: [], round: 1 }))
        .rejects.toThrow("No council members provided valid responses");
    });
  });

  describe("conductPeerReview", () => {
    it("should review and score opinions", async () => {
      const { conductPeerReview } = await import("../../src/lib/deliberationPhases.js");
      const { askProvider } = await import("../../src/lib/providers.js");

      vi.mocked(askProvider).mockResolvedValue({
        text: JSON.stringify({ ranking: ["Response A"], critique: "Good", identified_flaws: [] }),
        usage: { totalTokens: 20 }
      } as any);

      const result = await conductPeerReview({
        members: [{ name: "R1" }] as any,
        opinions: [{ name: "M1", opinion: "Op", structured: { answer: "Op" } }] as any,
        currentMessages: [],
        round: 1,
        validatorProvider: {} as any
      });

      expect(result.reviews).toHaveLength(1);
      expect(result.reviews[0].reviewer).toBe("R1");
      expect(result.totalTokens).toBe(20);
    });
  });

  describe("evaluateConsensus", () => {
    it("should evaluate consensus and recommend halting", async () => {
      const { evaluateConsensus } = await import("../../src/lib/deliberationPhases.js");
      const { askProvider } = await import("../../src/lib/providers.js");
      const { computeConsensus } = await import("../../src/lib/metrics.js");

      vi.mocked(askProvider).mockResolvedValue({ text: "Eval", usage: { totalTokens: 5 } } as any);
      vi.mocked(computeConsensus).mockResolvedValue(0.9);

      const result = await evaluateConsensus({
        master: {} as any,
        opinions: [{ structured: {} }] as any,
        currentMessages: [],
        round: 1
      });

      expect(result.shouldHalt).toBe(true);
      expect(result.consensusScore).toBe(0.9);
      expect(result.totalTokens).toBe(10); // 2 calls to master
    });
  });

  describe("synthesizeVerdict", () => {
    it("should synthesize and validate verdict", async () => {
      const { synthesizeVerdict } = await import("../../src/lib/deliberationPhases.js");
      const { askProvider, askProviderStream } = await import("../../src/lib/providers.js");

      vi.mocked(askProviderStream).mockImplementation(async (p, m, onChunk) => {
        onChunk("Final Verdict");
        return { text: "Final Verdict", usage: { totalTokens: 30 } } as any;
      });

      vi.mocked(askProvider).mockResolvedValue({
        text: JSON.stringify({ valid: true, issues: [], confidence: 0.9, summary: "OK" }),
        usage: { totalTokens: 10 }
      } as any);

      const result = await synthesizeVerdict({
        master: {} as any,
        currentMessages: []
      });

      expect(result.verdict).toBe("Final Verdict");
      expect(result.validatorResult.valid).toBe(true);
      expect(result.totalTokens).toBe(40);
    });
  });

  describe("conductDebateRound", () => {
    it("should refine opinions through debate", async () => {
      const { conductDebateRound } = await import("../../src/lib/deliberationPhases.js");
      const { askProviderStream } = await import("../../src/lib/providers.js");

      vi.mocked(askProviderStream).mockResolvedValue({
        text: JSON.stringify({ answer: "Refined" }),
        usage: { totalTokens: 15 }
      } as any);

      const result = await conductDebateRound({
        members: [{ name: "M1" }] as any,
        opinions: [{ name: "M1", opinion: "Original", structured: { answer: "Original" } }] as any
      });

      expect(result.refinedOpinions).toHaveLength(1);
      expect(result.refinedOpinions[0].opinion).toContain("Refined");
      expect(result.totalTokens).toBe(15);
    });
  });
});
