import { describe, it, expect, vi, beforeEach } from "vitest";
import { calculateCost, DEFAULT_COST_CONFIG } from "../../src/lib/cost.js";
import { createStreamResult } from "../../src/adapters/types.js";
import type { AdapterChunk, AdapterUsage } from "../../src/adapters/types.js";

// P11-02: Tests that token counts and costs are correctly accumulated from
// real stream chunks — no mocking of cost calculation or stream consumption.

vi.mock("../../src/lib/drizzle.js", () => ({
  db: {
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockResolvedValue([]),
      limit: vi.fn().mockResolvedValue([]),
      then: (r: (v: unknown[]) => void) => r([]),
    }),
  },
}));

vi.mock("../../src/lib/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe("P11-02: Cost/billing accumulation from real stream chunks", () => {
  describe("calculateCost with known token counts", () => {
    it("should compute exact cost for gpt-4o with known pricing", () => {
      // gpt-4o: input $0.0025/1K, output $0.01/1K
      const cost = calculateCost("openai", "gpt-4o", 1500, 500);
      const expected = (1500 * 0.0025) / 1000 + (500 * 0.01) / 1000;
      expect(cost).toBeCloseTo(expected, 10);
      expect(cost).toBeCloseTo(0.00375 + 0.005, 10);
    });

    it("should compute exact cost for claude-3-5-sonnet with known pricing", () => {
      // claude-3-5-sonnet-20241022: input $0.003/1K, output $0.015/1K
      const cost = calculateCost("anthropic", "claude-3-5-sonnet-20241022", 2000, 800);
      const expected = (2000 * 0.003) / 1000 + (800 * 0.015) / 1000;
      expect(cost).toBeCloseTo(expected, 10);
      expect(cost).toBeCloseTo(0.006 + 0.012, 10);
    });

    it("should compute exact cost for gemini-2.0-flash with known pricing", () => {
      // gemini-2.0-flash: input $0.0001/1K, output $0.0004/1K
      const cost = calculateCost("google", "gemini-2.0-flash", 10000, 5000);
      const expected = (10000 * 0.0001) / 1000 + (5000 * 0.0004) / 1000;
      expect(cost).toBeCloseTo(expected, 10);
      expect(cost).toBeCloseTo(0.001 + 0.002, 10);
    });

    it("should accumulate cost linearly with token count", () => {
      const cost1x = calculateCost("openai", "gpt-4o", 100, 100);
      const cost10x = calculateCost("openai", "gpt-4o", 1000, 1000);
      expect(cost10x).toBeCloseTo(cost1x * 10, 10);
    });

    it("should handle zero tokens correctly", () => {
      const cost = calculateCost("openai", "gpt-4o", 0, 0);
      expect(cost).toBe(0);
    });

    it("should handle input-only requests", () => {
      const cost = calculateCost("openai", "gpt-4o", 5000, 0);
      expect(cost).toBeCloseTo((5000 * 0.0025) / 1000, 10);
      expect(cost).toBeCloseTo(0.0125, 10);
    });

    it("should handle output-only scenario", () => {
      const cost = calculateCost("openai", "gpt-4o", 0, 5000);
      expect(cost).toBeCloseTo((5000 * 0.01) / 1000, 10);
      expect(cost).toBeCloseTo(0.05, 10);
    });
  });

  describe("stream chunk accumulation via createStreamResult.collect()", () => {
    it("should correctly accumulate usage from stream with single usage chunk", async () => {
      const knownUsage: AdapterUsage = { prompt_tokens: 350, completion_tokens: 120 };

      async function* gen(): AsyncGenerator<AdapterChunk> {
        yield { type: "text", text: "Hello " };
        yield { type: "text", text: "world" };
        yield { type: "usage", usage: knownUsage };
        yield { type: "done", finish_reason: "stop" };
      }

      const result = createStreamResult(gen());
      const collected = await result.collect();

      expect(collected.usage.prompt_tokens).toBe(350);
      expect(collected.usage.completion_tokens).toBe(120);
      expect(collected.text).toBe("Hello world");

      // Verify cost from these accumulated tokens
      const cost = calculateCost("openai", "gpt-4o", collected.usage.prompt_tokens, collected.usage.completion_tokens);
      const expectedCost = (350 * 0.0025) / 1000 + (120 * 0.01) / 1000;
      expect(cost).toBeCloseTo(expectedCost, 10);
    });

    it("should accumulate text across many chunks and pair with final usage", async () => {
      const chunks = ["The ", "quick ", "brown ", "fox ", "jumps"];
      const knownUsage: AdapterUsage = { prompt_tokens: 50, completion_tokens: 5 };

      async function* gen(): AsyncGenerator<AdapterChunk> {
        for (const c of chunks) {
          yield { type: "text", text: c };
        }
        yield { type: "usage", usage: knownUsage };
        yield { type: "done", finish_reason: "stop" };
      }

      const result = createStreamResult(gen());
      const collected = await result.collect();

      expect(collected.text).toBe("The quick brown fox jumps");
      expect(collected.usage.prompt_tokens).toBe(50);
      expect(collected.usage.completion_tokens).toBe(5);

      const cost = calculateCost("anthropic", "claude-3-5-sonnet-20241022", 50, 5);
      expect(cost).toBeCloseTo((50 * 0.003 + 5 * 0.015) / 1000, 10);
    });

    it("should correctly track cost across stream consumption via iteration", async () => {
      const knownUsage: AdapterUsage = { prompt_tokens: 1000, completion_tokens: 2000 };

      async function* gen(): AsyncGenerator<AdapterChunk> {
        yield { type: "text", text: "response" };
        yield { type: "usage", usage: knownUsage };
        yield { type: "done", finish_reason: "stop" };
      }

      const result = createStreamResult(gen());

      // Consume stream manually (simulating real streaming consumption)
      let accumulatedTokens = { prompt: 0, completion: 0 };
      for await (const chunk of result.stream) {
        if (chunk.type === "usage" && chunk.usage) {
          accumulatedTokens.prompt += chunk.usage.prompt_tokens;
          accumulatedTokens.completion += chunk.usage.completion_tokens;
        }
      }

      expect(accumulatedTokens.prompt).toBe(1000);
      expect(accumulatedTokens.completion).toBe(2000);

      // Verify total cost matches known pricing
      const totalCost = calculateCost("openai", "gpt-4o", accumulatedTokens.prompt, accumulatedTokens.completion);
      const expected = (1000 * 0.0025 + 2000 * 0.01) / 1000;
      expect(totalCost).toBeCloseTo(expected, 10);
      expect(totalCost).toBeCloseTo(0.0225, 10);
    });

    it("should handle stream with tool calls and still accumulate cost correctly", async () => {
      const knownUsage: AdapterUsage = { prompt_tokens: 800, completion_tokens: 150 };

      async function* gen(): AsyncGenerator<AdapterChunk> {
        yield { type: "text", text: "Let me " };
        yield { type: "tool_call", tool_call: { id: "tc_1", name: "search", arguments: '{"q":"test"}' } };
        yield { type: "text", text: "search for that." };
        yield { type: "usage", usage: knownUsage };
        yield { type: "done", finish_reason: "tool_calls" };
      }

      const result = createStreamResult(gen());
      const collected = await result.collect();

      expect(collected.usage.prompt_tokens).toBe(800);
      expect(collected.usage.completion_tokens).toBe(150);
      expect(collected.tool_calls).toHaveLength(1);
      expect(collected.tool_calls[0].name).toBe("search");

      const cost = calculateCost("openai", "gpt-4o", 800, 150);
      expect(cost).toBeCloseTo((800 * 0.0025 + 150 * 0.01) / 1000, 10);
    });

    it("should compute multi-request accumulated cost correctly", () => {
      // Simulate billing for a session with multiple requests
      const requests = [
        { provider: "openai", model: "gpt-4o", input: 500, output: 200 },
        { provider: "openai", model: "gpt-4o", input: 800, output: 350 },
        { provider: "anthropic", model: "claude-3-5-sonnet-20241022", input: 1200, output: 600 },
      ];

      let totalCost = 0;
      for (const req of requests) {
        totalCost += calculateCost(req.provider, req.model, req.input, req.output);
      }

      // Manually compute expected
      const expected =
        (500 * 0.0025 + 200 * 0.01) / 1000 + // gpt-4o request 1
        (800 * 0.0025 + 350 * 0.01) / 1000 + // gpt-4o request 2
        (1200 * 0.003 + 600 * 0.015) / 1000;  // claude request

      expect(totalCost).toBeCloseTo(expected, 10);
      // Verify the actual value is non-trivial
      expect(totalCost).toBeGreaterThan(0.01);
    });
  });

  describe("pricing config integrity", () => {
    it("should have pricing entries for all major providers", () => {
      const providers = new Set(DEFAULT_COST_CONFIG.map(c => c.provider));
      expect(providers.has("openai")).toBe(true);
      expect(providers.has("anthropic")).toBe(true);
      expect(providers.has("google")).toBe(true);
      expect(providers.has("groq")).toBe(true);
    });

    it("should have positive pricing for all configured models", () => {
      for (const entry of DEFAULT_COST_CONFIG) {
        expect(entry.inputTokenPrice).toBeGreaterThan(0);
        expect(entry.outputTokenPrice).toBeGreaterThan(0);
        // Output typically costs more than input
        expect(entry.outputTokenPrice).toBeGreaterThanOrEqual(entry.inputTokenPrice);
      }
    });
  });
});
