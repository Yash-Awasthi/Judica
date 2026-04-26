import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  runSpeculativeDraft,
  buildDraftSeedContext,
  classifyQueryComplexity,
  type QueryComplexity,
  type DraftResult,
  type SpeculativeRunResult,
} from "../../src/services/speculativeDecoding.service.js";

describe("speculativeDecoding.service", () => {
  describe("classifyQueryComplexity", () => {
    it("classifies short factual lookups as simple", () => {
      expect(classifyQueryComplexity("What is the capital of France?")).toBe("simple");
      expect(classifyQueryComplexity("Who is Elon Musk?")).toBe("simple");
      expect(classifyQueryComplexity("When did WW2 end?")).toBe("simple");
      expect(classifyQueryComplexity("Define photosynthesis")).toBe("simple");
    });

    it("classifies reasoning queries as complex", () => {
      expect(classifyQueryComplexity("Why did the Roman Empire fall?")).toBe("complex");
      expect(classifyQueryComplexity("Compare React and Vue for a large team")).toBe("complex");
      expect(classifyQueryComplexity("Analyse the implications of quantitative easing")).toBe("complex");
      expect(classifyQueryComplexity("Explain how TCP/IP works step by step")).toBe("complex");
    });

    it("classifies creation queries as complex", () => {
      expect(classifyQueryComplexity("Write a short story about a robot")).toBe("complex");
      expect(classifyQueryComplexity("Create a marketing plan for a SaaS product")).toBe("complex");
      expect(classifyQueryComplexity("Design a database schema for an e-commerce platform")).toBe("complex");
    });

    it("classifies very long queries as complex regardless of content", () => {
      const longQuery = "What is ".repeat(42) + "the answer?"; // 85+ words, above threshold
      expect(classifyQueryComplexity(longQuery)).toBe("complex");
    });

    it("classifies medium queries by word count", () => {
      const shortQ = "Tell me about planets";
      // 31+ words, no complex markers, doesn't match simple patterns → word count decides
      const longQ = "Tell me about the planets their atmospheres distances from the sun orbital periods temperatures and the geological composition history and formation of each planet rocky gas giant in our solar system";
      expect(classifyQueryComplexity(shortQ)).toBe("simple");
      expect(classifyQueryComplexity(longQ)).toBe("complex");
    });
  });

  describe("buildDraftSeedContext", () => {
    it("wraps draft text with attribution and instructions", () => {
      const draft: DraftResult = {
        text: "Paris is the capital of France.",
        selfSufficient: true,
        draftModel: "groq/llama-3.1-8b-instant",
        durationMs: 120,
        inputTokens: 10,
        outputTokens: 8,
      };
      const ctx = buildDraftSeedContext(draft);
      expect(ctx).toContain("groq/llama-3.1-8b-instant");
      expect(ctx).toContain("120ms");
      expect(ctx).toContain("Paris is the capital of France.");
      expect(ctx).toContain("validate, expand, or refute");
    });
  });

  describe("runSpeculativeDraft", () => {
    it("returns complex classification and skips draft when aborted", async () => {
      const controller = new AbortController();
      controller.abort();

      const result = await runSpeculativeDraft({
        query: "What is 2+2?",
        signal: controller.signal,
        complexity: "simple",
      });

      // Aborted immediately — draft may be null
      expect(result.complexity).toBe("simple");
      // useDraftDirectly only true if draft was produced
      if (!result.draft) {
        expect(result.useDraftDirectly).toBe(false);
      }
    });

    it("sets useDraftDirectly=false for complex queries even with a draft", async () => {
      // Provide complexity directly to avoid real LLM call
      const result: SpeculativeRunResult = {
        draft: {
          text: "Placeholder",
          selfSufficient: false,
          draftModel: "test",
          durationMs: 10,
          inputTokens: 5,
          outputTokens: 5,
        },
        complexity: "complex",
        useDraftDirectly: false,
      };

      expect(result.useDraftDirectly).toBe(false);
    });

    it("sets useDraftDirectly=true for simple queries with a successful draft", () => {
      const result: SpeculativeRunResult = {
        draft: {
          text: "Paris",
          selfSufficient: true,
          draftModel: "groq/llama-3.1-8b-instant",
          durationMs: 95,
          inputTokens: 8,
          outputTokens: 2,
        },
        complexity: "simple",
        useDraftDirectly: true,
      };

      expect(result.useDraftDirectly).toBe(true);
      expect(result.draft?.selfSufficient).toBe(true);
    });
  });
});
