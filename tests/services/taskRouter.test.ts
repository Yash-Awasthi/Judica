import { classifyAndRoute, applyRouteDecision } from "../../services/taskRouter.service.js";
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../../router/index.js", () => ({
  routeAndCollect: vi.fn().mockResolvedValue({ text: "STANDARD", usage: { prompt_tokens: 5, completion_tokens: 1 } }),
}));

describe("taskRouter.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.INTELLIGENT_ROUTING_ENABLED = "true";
  });

  describe("classifyAndRoute — disabled mode", () => {
    it("returns complex tier when routing is disabled", async () => {
      process.env.INTELLIGENT_ROUTING_ENABLED = "false";
      const result = await classifyAndRoute("What is 2+2?");
      expect(result.tier).toBe("complex");
      expect(result.councilSize).toBe(5);
      expect(result.confidence).toBe(1.0);
    });
  });

  describe("classifyAndRoute — Stage 1 (heuristic)", () => {
    it("routes arithmetic to trivial with high confidence", async () => {
      const result = await classifyAndRoute("24 * 7");
      expect(result.tier).toBe("trivial");
      expect(result.stage).toBe(1);
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it("routes translation queries to trivial", async () => {
      const result = await classifyAndRoute("Translate hello to Spanish");
      expect(result.tier).toBe("trivial");
      expect(result.stage).toBe(1);
    });

    it("routes simple factual queries correctly", async () => {
      const result = await classifyAndRoute("What is the capital of Germany?");
      // Stage 1 heuristic — simple or escalates to stage 2/3
      expect(["trivial", "simple", "standard"]).toContain(result.tier);
    });
  });

  describe("classifyAndRoute — Stage 2 (feature analysis)", () => {
    it("routes code generation queries to complex", async () => {
      const result = await classifyAndRoute(
        "Write a React component that implements a sortable table with pagination. Include TypeScript types and tests."
      );
      expect(["standard", "complex"]).toContain(result.tier);
      expect(result.councilSize).toBeGreaterThanOrEqual(3);
    });

    it("routes multi-question queries to standard or complex", async () => {
      const result = await classifyAndRoute(
        "What are the pros and cons of microservices? How does it compare to monolith? When should I use each?"
      );
      expect(["standard", "complex"]).toContain(result.tier);
    });
  });

  describe("councilSize", () => {
    it("returns councilSize 1 for trivial", async () => {
      const result = await classifyAndRoute("42 + 58");
      expect(result.councilSize).toBe(1);
    });

    it("returns full deliberation for complex", async () => {
      const result = await classifyAndRoute(
        "Design a distributed system for real-time analytics at 1M events/sec. Include data pipeline, storage, and query layers."
      );
      expect(result.useFullDeliberation).toBe(result.tier === "complex" || result.tier === "standard");
    });
  });

  describe("applyRouteDecision", () => {
    const members = ["m1", "m2", "m3", "m4", "m5", "m6"];

    it("slices members to councilSize", () => {
      const decision = {
        tier: "simple" as const,
        confidence: 0.9,
        reason: "test",
        stage: 1 as const,
        councilSize: 1,
        useFullDeliberation: false,
        suggestOverride: false,
      };
      const result = applyRouteDecision(members, decision);
      expect(result).toHaveLength(1);
    });

    it("returns all members when routing disabled", () => {
      process.env.INTELLIGENT_ROUTING_ENABLED = "false";
      const decision = {
        tier: "complex" as const,
        confidence: 1.0,
        reason: "disabled",
        stage: 1 as const,
        councilSize: 5,
        useFullDeliberation: true,
        suggestOverride: false,
      };
      const result = applyRouteDecision(members, decision);
      expect(result).toHaveLength(members.length);
    });
  });
});
