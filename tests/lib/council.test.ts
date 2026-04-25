import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock ALL dependencies
vi.mock("../../src/lib/drizzle.js", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn().mockResolvedValue([]),
        })),
      })),
    })),
  },
}));
vi.mock("../../src/db/schema/auth.js", () => ({ councilConfigs: { userId: "userId" } }));
vi.mock("../../src/lib/errorMapper.js", () => ({ mapProviderError: vi.fn((e) => "mapped error") }));
vi.mock("../../src/lib/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../src/lib/scoring.js", () => ({ filterAndRank: vi.fn() }));
vi.mock("../../src/config/archetypes.js", () => ({
  ARCHETYPES: {
    architect: {
      id: "architect",
      name: "Architect",
      thinkingStyle: "T",
      asks: "A",
      blindSpot: "B",
      systemPrompt: "You are the Architect.",
      tools: [],
    },
    researcher: {
      id: "researcher",
      name: "Researcher",
      thinkingStyle: "T",
      asks: "A",
      blindSpot: "B",
      systemPrompt: "You are the Researcher.",
      tools: ["web_search"],
    },
    empiricist: {
      id: "empiricist",
      name: "Empiricist",
      thinkingStyle: "T",
      asks: "A",
      blindSpot: "B",
      systemPrompt: "You are the Empiricist.",
      tools: [],
    },
  },
  SUMMONS: {
    default: ["architect", "researcher", "empiricist"],
    scientific: ["architect", "researcher"],
  },
  UNIVERSAL_PROMPT: "You are a universal council member.",
}));
vi.mock("../../src/lib/deliberationPhases.js", () => ({
  gatherOpinions: vi.fn().mockResolvedValue({ opinions: [], totalTokens: 0 }),
  conductPeerReview: vi.fn().mockResolvedValue({
    reviews: [],
    scored: [],
    totalTokens: 0,
  }),
  evaluateConsensus: vi.fn().mockResolvedValue({
    criticEval: "Critique",
    scorerEval: "Score",
    consensusScore: 0.85,
    totalTokens: 0,
  }),
  synthesizeVerdict: vi.fn().mockResolvedValue({
    verdict: "Final verdict",
    validatorResult: { valid: true },
    totalTokens: 50,
  }),
  conductDebateRound: vi.fn().mockResolvedValue({
    refinedOpinions: [],
    totalTokens: 0,
  }),
}));
vi.mock("../../src/lib/controller.js", () => ({
  createController: vi.fn(() => ({
    decide: vi.fn(() => ({ shouldHalt: false, selectTopK: 0, reason: "" })),
    shouldAcceptRound: vi.fn(() => true),
    reset: vi.fn(),
  })),
}));
vi.mock("../../src/lib/cost.js", () => ({ calculateCost: vi.fn(() => 0) }));
vi.mock("../../src/services/reliability.service.js", () => ({
  updateReliability: vi.fn().mockResolvedValue(undefined),
  getReliabilityScores: vi.fn().mockResolvedValue(new Map()),
}));

describe("Council (extended coverage)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("prepareCouncilMembers", () => {
    it("prepares council members with correct archetypes from summon", async () => {
      const { prepareCouncilMembers } = await import("../../src/lib/council.js");
      const members: any[] = [
        { type: "api", apiKey: "k1", model: "m1" },
        { type: "api", apiKey: "k2", model: "m2" },
      ];

      const prepared = await prepareCouncilMembers(members, "scientific");

      expect(prepared).toHaveLength(2);
      expect(prepared[0].name).toBe("Architect");
      expect(prepared[0].archetype).toBe("architect");
      expect(prepared[1].name).toBe("Researcher");
      expect(prepared[1].archetype).toBe("researcher");
      // Researcher should have web_search tool
      expect(prepared[1].tools).toContain("web_search");
    });

    it("returns empty array for empty members", async () => {
      const { prepareCouncilMembers } = await import("../../src/lib/council.js");
      const prepared = await prepareCouncilMembers([]);
      expect(prepared).toEqual([]);
    });

    it("uses universal prompt for single member", async () => {
      const { prepareCouncilMembers } = await import("../../src/lib/council.js");
      const members: any[] = [{ type: "api", apiKey: "key", model: "m1" }];

      const prepared = await prepareCouncilMembers(members);

      expect(prepared).toHaveLength(1);
      expect(prepared[0].systemPrompt).toBe("You are a universal council member.");
      expect(prepared[0].name).toBe("Council Member");
    });

    it("falls back to default summon for unknown summon key", async () => {
      const { prepareCouncilMembers } = await import("../../src/lib/council.js");
      const members: any[] = [
        { type: "api", apiKey: "k1", model: "m1" },
        { type: "api", apiKey: "k2", model: "m2" },
        { type: "api", apiKey: "k3", model: "m3" },
      ];

      const prepared = await prepareCouncilMembers(members, "nonexistent-summon");

      expect(prepared).toHaveLength(3);
      // Default summon: architect, researcher, empiricist
      expect(prepared[0].archetype).toBe("architect");
      expect(prepared[1].archetype).toBe("researcher");
      expect(prepared[2].archetype).toBe("empiricist");
    });

    it("adds diversity prompt to members after the first", async () => {
      const { prepareCouncilMembers } = await import("../../src/lib/council.js");
      const members: any[] = [
        { type: "api", apiKey: "k1", model: "m1" },
        { type: "api", apiKey: "k2", model: "m2" },
      ];

      const prepared = await prepareCouncilMembers(members);

      // Second member should have diversity instruction
      expect(prepared[1].systemPrompt).toContain("distinct perspective");
      // First member should NOT
      expect(prepared[0].systemPrompt).not.toContain("distinct perspective");
    });

    it("includes JSON instruction in all multi-member system prompts", async () => {
      const { prepareCouncilMembers } = await import("../../src/lib/council.js");
      const members: any[] = [
        { type: "api", apiKey: "k1", model: "m1" },
        { type: "api", apiKey: "k2", model: "m2" },
      ];

      const prepared = await prepareCouncilMembers(members);

      for (const member of prepared) {
        expect(member.systemPrompt).toContain("CRITICAL: You MUST respond with a valid JSON");
      }
    });
  });

  describe("deliberate", () => {
    it("conducts deliberation rounds and yields events", async () => {
      const { deliberate } = await import("../../src/lib/council.js");
      const { gatherOpinions, synthesizeVerdict } = await import(
        "../../src/lib/deliberationPhases.js"
      );

      vi.mocked(gatherOpinions).mockResolvedValue({
        opinions: [
          { name: "A1", opinion: "Response 1", structured: { answer: "R1" } },
          { name: "A2", opinion: "Response 2", structured: { answer: "R2" } },
        ],
        totalTokens: 100,
      });

      vi.mocked(synthesizeVerdict).mockResolvedValue({
        verdict: "Synthesized verdict",
        validatorResult: { valid: true } as any,
        totalTokens: 50,
      });

      const members = [{}, {}] as any;
      const gen = deliberate(members, {} as any, [{ role: "user", content: "test" }], 1);
      const events: any[] = [];
      for await (const event of gen) {
        events.push(event);
      }

      expect(events.some((e) => e.type === "status")).toBe(true);
      expect(events.some((e) => e.type === "opinion")).toBe(true);
      expect(events.some((e) => e.type === "done")).toBe(true);

      const doneEvent = events.find((e) => e.type === "done");
      expect(doneEvent.verdict).toBe("Synthesized verdict");
    });

    it("handles consensus reached early and halts", async () => {
      const { deliberate } = await import("../../src/lib/council.js");
      const { gatherOpinions, evaluateConsensus, conductPeerReview } = await import(
        "../../src/lib/deliberationPhases.js"
      );
      const { createController } = await import("../../src/lib/controller.js");

      const mockController = {
        decide: vi.fn(() => ({ shouldHalt: true, reason: "Consensus reached at 95%" })),
        shouldAcceptRound: vi.fn(() => true),
        reset: vi.fn(),
      };
      vi.mocked(createController).mockReturnValue(mockController as any);

      vi.mocked(gatherOpinions).mockResolvedValue({
        opinions: [
          { name: "A1", opinion: "O1", structured: {} },
          { name: "A2", opinion: "O2", structured: {} },
        ],
        totalTokens: 100,
      });

      vi.mocked(conductPeerReview).mockResolvedValue({
        reviews: [],
        scored: [],
        totalTokens: 10,
      });

      vi.mocked(evaluateConsensus).mockResolvedValue({
        criticEval: "Good",
        scorerEval: "9/10",
        consensusScore: 0.95,
        totalTokens: 20,
      });

      const gen = deliberate([{}, {}] as any, {} as any, [], 3);
      const events: any[] = [];
      for await (const event of gen) {
        events.push(event);
      }

      // Should have a halt status message
      const haltEvent = events.find(
        (e) => e.type === "status" && e.message.includes("Halting")
      );
      expect(haltEvent).toBeDefined();
    });

    it("handles max rounds by continuing through all rounds", async () => {
      const { deliberate } = await import("../../src/lib/council.js");
      const { gatherOpinions, evaluateConsensus, conductPeerReview } = await import(
        "../../src/lib/deliberationPhases.js"
      );
      const { createController } = await import("../../src/lib/controller.js");

      const mockController = {
        decide: vi.fn(() => ({ shouldHalt: false, reason: "" })),
        shouldAcceptRound: vi.fn(() => true),
        reset: vi.fn(),
      };
      vi.mocked(createController).mockReturnValue(mockController as any);

      vi.mocked(gatherOpinions).mockResolvedValue({
        opinions: [
          { name: "A1", opinion: "O1", structured: {} },
          { name: "A2", opinion: "O2", structured: {} },
        ],
        totalTokens: 50,
      });

      vi.mocked(conductPeerReview).mockResolvedValue({
        reviews: [],
        scored: [],
        totalTokens: 10,
      });

      vi.mocked(evaluateConsensus).mockResolvedValue({
        criticEval: "Needs work",
        scorerEval: "5/10",
        consensusScore: 0.4,
        totalTokens: 20,
      });

      const maxRounds = 2;
      const gen = deliberate([{}, {}] as any, {} as any, [], maxRounds);
      const events: any[] = [];
      for await (const event of gen) {
        events.push(event);
      }

      // Should have gone through multiple rounds
      const statusEvents = events.filter((e) => e.type === "status");
      expect(statusEvents.length).toBeGreaterThanOrEqual(2);

      // gatherOpinions should be called for each round
      expect(gatherOpinions).toHaveBeenCalledTimes(maxRounds);
    });

    it("aborts if quorum not met", async () => {
      const { deliberate } = await import("../../src/lib/council.js");
      const { gatherOpinions } = await import("../../src/lib/deliberationPhases.js");

      vi.mocked(gatherOpinions).mockResolvedValue({
        opinions: [],
        totalTokens: 0,
      });

      const gen = deliberate([{}, {}, {}] as any, {} as any, [], 1);
      const events: any[] = [];
      for await (const event of gen) {
        events.push(event);
      }

      const quorumFail = events.find(
        (e) => e.type === "status" && e.message.includes("Quorum not met")
      );
      expect(quorumFail).toBeDefined();
    });
  });

  describe("askCouncil", () => {
    it("returns final verdict, opinions, and metrics", async () => {
      const { askCouncil } = await import("../../src/lib/council.js");
      const { gatherOpinions, synthesizeVerdict } = await import(
        "../../src/lib/deliberationPhases.js"
      );

      vi.mocked(gatherOpinions).mockResolvedValue({
        opinions: [
          { name: "Agent1", opinion: "My opinion", structured: {} },
          { name: "Agent2", opinion: "Another opinion", structured: {} },
        ],
        totalTokens: 100,
      });

      vi.mocked(synthesizeVerdict).mockResolvedValue({
        verdict: "Council verdict",
        validatorResult: {} as any,
        totalTokens: 50,
      });

      const result = await askCouncil(
        [{}, {}] as any,
        {} as any,
        [{ role: "user", content: "question" }]
      );

      expect(result.verdict).toBe("Council verdict");
      expect(result.opinions).toBeDefined();
      expect(result.metrics).toBeDefined();
      expect(result.metrics.totalTokens).toBeGreaterThan(0);
    });
  });

  describe("streamCouncil", () => {
    it("sends error event on stream failure", async () => {
      const { streamCouncil } = await import("../../src/lib/council.js");
      const { gatherOpinions } = await import("../../src/lib/deliberationPhases.js");

      vi.mocked(gatherOpinions).mockRejectedValue(new Error("Network failure"));

      const onEvent = vi.fn();
      await streamCouncil([{}] as any, {} as any, [], onEvent);

      expect(onEvent).toHaveBeenCalledWith("error", expect.objectContaining({ message: expect.any(String) }));
    });
  });
});
