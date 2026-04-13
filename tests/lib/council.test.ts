import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock ALL dependencies
vi.mock("../../src/lib/drizzle.js", () => ({ db: { select: vi.fn() } }));
vi.mock("../../src/db/schema/auth.js", () => ({ councilConfigs: { userId: "userId" } }));
vi.mock("../../src/lib/errorMapper.js", () => ({ mapProviderError: vi.fn(e => "mapped error") }));
vi.mock("../../src/lib/logger.js", () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../../src/lib/scoring.js", () => ({ filterAndRank: vi.fn() }));
vi.mock("../../src/lib/archetypes.js", () => ({
  ARCHETYPES: {
    "architect": { id: "architect", name: "Architect", thinkingStyle: "T", asks: "A", blindSpot: "B", systemPrompt: "S" },
    "researcher": { id: "researcher", name: "Researcher", thinkingStyle: "T", asks: "A", blindSpot: "B", systemPrompt: "S", tools: ["web_search"] }
  },
  SUMMONS: {
    "default": ["architect"],
    "scientific": ["architect", "researcher"]
  },
  UNIVERSAL_PROMPT: "Universal"
}));
vi.mock("../../src/lib/deliberationPhases.js", () => ({
  gatherOpinions: vi.fn().mockResolvedValue({ opinions: [], totalTokens: 0 }),
  conductPeerReview: vi.fn().mockResolvedValue({ reviews: [], scored: [], totalTokens: 0 }),
  evaluateConsensus: vi.fn().mockResolvedValue({ criticEval: "C", scorerEval: "S", consensusScore: 0.5, totalTokens: 0 }),
  synthesizeVerdict: vi.fn().mockResolvedValue({ verdict: "V", validatorResult: {}, totalTokens: 0 }),
  conductDebateRound: vi.fn().mockResolvedValue({ refinedOpinions: [], totalTokens: 0 }),
}));
vi.mock("../../src/lib/controller.js", () => ({
  createController: vi.fn(() => ({
    decide: vi.fn(() => ({ shouldHalt: false, selectTopK: 0 })),
    shouldAcceptRound: vi.fn(() => true),
    reset: vi.fn(),
  }))
}));
vi.mock("../../src/lib/cost.js", () => ({ calculateCost: vi.fn(() => 0) }));
vi.mock("../../src/services/reliability.service.js", () => ({
  updateReliability: vi.fn().mockResolvedValue(undefined),
  getReliabilityScores: vi.fn().mockResolvedValue(new Map()),
}));

describe("Council Utility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("prepareCouncilMembers", () => {
    it("should prepare members with archetypes", async () => {
      const { prepareCouncilMembers } = await import("../../src/lib/council.js");
      const members: any[] = [{ type: "api", apiKey: "key", model: "m1" }, { type: "api", apiKey: "key", model: "m2" }];
      
      const prepared = await prepareCouncilMembers(members, "scientific");
      expect(prepared).toHaveLength(2);
      expect(prepared[0].systemPrompt).toContain("JSON");
      expect(prepared[0].archetype).toBeDefined();
    });

    it("should handle single member with universal prompt", async () => {
        const { prepareCouncilMembers } = await import("../../src/lib/council.js");
        const members: any[] = [{ type: "api", apiKey: "key", model: "m1" }];
        const prepared = await prepareCouncilMembers(members);
        expect(prepared[0].name).toBe("Council Member");
    });
  });

  describe("deliberate", () => {
    it("should yield events through deliberation phases", async () => {
      const { deliberate } = await import("../../src/lib/council.js");
      const { gatherOpinions, synthesizeVerdict } = await import("../../src/lib/deliberationPhases.js");

      vi.mocked(gatherOpinions).mockResolvedValue({
        opinions: [
          { name: "A1", opinion: "Op1", structured: { answer: "Op1" } },
          { name: "A2", opinion: "Op2", structured: { answer: "Op2" } }
        ],
        totalTokens: 100
      });

      vi.mocked(synthesizeVerdict).mockResolvedValue({
        verdict: "The final verdict",
        validatorResult: {} as any,
        totalTokens: 50
      });

      const gen = deliberate([] as any, {} as any, [], 1);
      const events = [];
      for await (const event of gen) {
        events.push(event);
      }

      expect(events.some(e => e.type === "status")).toBe(true);
      expect(events.some(e => e.type === "opinion")).toBe(true);
      expect(events.some(e => e.type === "done")).toBe(true);
    });

    it("should stop if quorum not met", async () => {
        const { deliberate } = await import("../../src/lib/council.js");
        const { gatherOpinions } = await import("../../src/lib/deliberationPhases.js");
        vi.mocked(gatherOpinions).mockResolvedValue({ opinions: [], totalTokens: 0 });

        const gen = deliberate([{}] as any, {} as any, [], 1);
        const events = [];
        for await (const event of gen) { events.push(event); }
        expect(events.some(e => e.type === "status" && e.message.includes("Quorum not met"))).toBe(true);
    });
  });

  describe("askCouncil", () => {
    it("should return final verdict and metrics", async () => {
      const { askCouncil } = await import("../../src/lib/council.js");
      const result = await askCouncil([] as any, {} as any, []);
      expect(result.verdict).toBe("The final verdict");
      expect(result.metrics).toBeDefined();
    });
  });

  describe("streamCouncil", () => {
    it("should call onEvent for each event type", async () => {
      const { streamCouncil } = await import("../../src/lib/council.js");
      const onEvent = vi.fn();
      
      const { gatherOpinions } = await import("../../src/lib/deliberationPhases.js");
      vi.mocked(gatherOpinions).mockResolvedValue({
        opinions: [
          { name: "A1", opinion: "O1", structured: {} },
          { name: "A2", opinion: "O2", structured: {} }
        ],
        totalTokens: 10
      });

      const members = [
        { name: "A1", archetype: "arch" },
        { name: "A2", archetype: "arch" }
      ];

      await streamCouncil(members as any, {} as any, [], onEvent);
      expect(onEvent).toHaveBeenCalledWith("status", expect.anything());
      expect(onEvent).toHaveBeenCalledWith("opinion", expect.anything());
      expect(onEvent).toHaveBeenCalledWith("done", expect.anything());
    });

    it("should handle errors through onEvent", async () => {
        const { streamCouncil } = await import("../../src/lib/council.js");
        const { gatherOpinions } = await import("../../src/lib/deliberationPhases.js");
        vi.mocked(gatherOpinions).mockRejectedValue(new Error("Stream fail"));
        
        const onEvent = vi.fn();
        await streamCouncil([{}] as any, {} as any, [], onEvent);
        expect(onEvent).toHaveBeenCalledWith("error", expect.anything());
    });
  });
});
