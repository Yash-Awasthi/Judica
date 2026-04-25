import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock logger
vi.mock("./logger.js", () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

describe("Router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("classifyQuery", () => {
    it("should classify factual queries", async () => {
      const { classifyQuery } = await import("../../src/lib/router.js");
      const result = classifyQuery("What is the population of Tokyo?");
      expect(result.type).toBe("factual");
      expect(result.fallback).toBe(false);
      expect(result.archetypes).toContain("empiricist");
    });

    it("should classify technical queries", async () => {
        const { classifyQuery } = await import("../../src/lib/router.js");
        const result = classifyQuery("How to implement a binary search tree in Rust?");
        expect(result.type).toBe("technical");
        expect(result.archetypes).toContain("architect");
    });

    it("should use fallback for low confidence queries", async () => {
        const { classifyQuery } = await import("../../src/lib/router.js");
        // A very short/vague query might have low confidence
        const result = classifyQuery("hello");
        expect(result.fallback).toBe(true);
        expect(result.archetypes).toEqual(["strategist", "architect", "empiricist", "outsider"]);
    });

    it("should classify ethical queries", async () => {
        const { classifyQuery } = await import("../../src/lib/router.js");
        const result = classifyQuery("is it ethical to use AI for homework?");
        expect(result.type).toBe("ethical");
        expect(result.archetypes).toContain("ethicist");
    });

    it("should classify creative queries", async () => {
        const { classifyQuery } = await import("../../src/lib/router.js");
        const result = classifyQuery("Write a poem about a lonely robot.");
        expect(result.type).toBe("creative");
        expect(result.archetypes).toContain("creator");
    });

    it("should classify strategic queries", async () => {
        const { classifyQuery } = await import("../../src/lib/router.js");
        const result = classifyQuery("What are the next steps for my business expansion roadmap?");
        expect(result.type).toBe("strategic");
        expect(result.archetypes).toContain("strategist");
    });
  });

  describe("formatRouterMetadata", () => {
    it("should format metadata correctly", async () => {
        const { formatRouterMetadata } = await import("../../src/lib/router.js");
        const mockResult = {
            type: "factual",
            confidence: 0.9,
            archetypes: ["a1"],
            reasoning: "r1",
            fallback: false
        } as any;
        const meta = formatRouterMetadata(mockResult);
        expect(meta.routerType).toBe("factual");
        expect(meta.routerConfidence).toBe(0.9);
    });
  });

  describe("getAutoArchetypes", () => {
    it("should return archetypes and result", async () => {
        const { getAutoArchetypes } = await import("../../src/lib/router.js");
        const { archetypes, result } = getAutoArchetypes("Tell me a fact.");
        expect(archetypes).toBeDefined();
        expect(result).toBeDefined();
    });
  });
});
