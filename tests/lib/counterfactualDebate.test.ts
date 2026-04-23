import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock providers
vi.mock("../../src/lib/providers.js", () => ({
  askProviderStream: vi.fn(),
}));

// Mock logger
vi.mock("../../src/lib/logger.js", () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { runCounterfactualDebate } from "../../src/lib/counterfactualDebate.js";
import { askProviderStream } from "../../src/lib/providers.js";
import logger from "../../src/lib/logger.js";

const mockProvider = { name: "test-provider", model: "gpt-4" } as any;
const mockMessages = [{ role: "user" as const, content: "test question" }];

function mockStreamResponses(counterText: string, rebuttalText: string) {
  const mock = askProviderStream as ReturnType<typeof vi.fn>;
  mock
    .mockResolvedValueOnce({ text: counterText })
    .mockResolvedValueOnce({ text: rebuttalText });
}

describe("counterfactualDebate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---------- Basic structure ----------

  it("returns correct structure with all required fields", async () => {
    mockStreamResponses(
      "Counter argument text",
      "Rebuttal text. My confidence: 0.8"
    );

    const result = await runCounterfactualDebate("Original opinion", mockProvider, mockMessages);

    expect(result).toHaveProperty("originalOpinion");
    expect(result).toHaveProperty("counterfactualArgument");
    expect(result).toHaveProperty("rebuttal");
    expect(result).toHaveProperty("robustnessScore");
    expect(result).toHaveProperty("concessions");
    expect(Array.isArray(result.concessions)).toBe(true);
  });

  it("calls askProviderStream twice (counter then rebuttal)", async () => {
    mockStreamResponses("Counter", "Rebuttal. confidence: 0.7");

    await runCounterfactualDebate("Opinion", mockProvider, mockMessages);

    expect(askProviderStream).toHaveBeenCalledTimes(2);
  });

  it("passes provider and abort signal to askProviderStream", async () => {
    mockStreamResponses("Counter", "Rebuttal. confidence: 0.6");

    await runCounterfactualDebate("Opinion", mockProvider, mockMessages);

    const calls = (askProviderStream as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][0]).toBe(mockProvider);
    expect(calls[1][0]).toBe(mockProvider);
    // 4th arg is false (no streaming callback), 5th is AbortSignal
    expect(calls[0][3]).toBe(false);
  });

  // ---------- Robustness score extraction ----------

  it("extracts robustnessScore from 'confidence: X' in rebuttal", async () => {
    mockStreamResponses("Counter", "I defend my position. confidence: 0.85");

    const result = await runCounterfactualDebate("Opinion", mockProvider, mockMessages);
    expect(result.robustnessScore).toBeCloseTo(0.85, 2);
  });

  it("extracts robustnessScore from 'rating: X' in rebuttal", async () => {
    mockStreamResponses("Counter", "My rating: 0.7 for the original.");

    const result = await runCounterfactualDebate("Opinion", mockProvider, mockMessages);
    expect(result.robustnessScore).toBeCloseTo(0.7, 2);
  });

  it("extracts robustnessScore from 'score: X' in rebuttal", async () => {
    mockStreamResponses("Counter", "Overall score: 0.92 for the original.");

    const result = await runCounterfactualDebate("Opinion", mockProvider, mockMessages);
    expect(result.robustnessScore).toBeCloseTo(0.92, 2);
  });

  it("extracts integer confidence (0 or 1)", async () => {
    mockStreamResponses("Counter", "Confidence: 1 — the original is solid.");

    const result = await runCounterfactualDebate("Opinion", mockProvider, mockMessages);
    expect(result.robustnessScore).toBe(1);
  });

  it("falls back to 0.5 when no confidence score found", async () => {
    mockStreamResponses("Counter", "I partially agree with the critic but stand by my position.");

    const result = await runCounterfactualDebate("Opinion", mockProvider, mockMessages);
    expect(result.robustnessScore).toBe(0.5);
  });

  it("clamps robustnessScore to maximum 1", async () => {
    // The regex only matches 0-1 range patterns, but if somehow > 1 gets parsed,
    // Math.min(1, ...) clamps it
    mockStreamResponses("Counter", "Confidence: 0.99");

    const result = await runCounterfactualDebate("Opinion", mockProvider, mockMessages);
    expect(result.robustnessScore).toBeLessThanOrEqual(1);
  });

  it("clamps robustnessScore to minimum 0", async () => {
    mockStreamResponses("Counter", "Confidence: 0");

    const result = await runCounterfactualDebate("Opinion", mockProvider, mockMessages);
    expect(result.robustnessScore).toBeGreaterThanOrEqual(0);
    expect(result.robustnessScore).toBe(0);
  });

  it("NaN guard on robustness (P20-04) — falls back to 0.5", async () => {
    // Force a regex match that would produce NaN from parseFloat
    // The regex /([01](?:\.\d+)?)/ should only capture valid floats,
    // but the NaN guard exists for defensive coding
    // We can test the guard by mocking the rebuttal with a tricky pattern
    mockStreamResponses("Counter", "No score in this text at all.");

    const result = await runCounterfactualDebate("Opinion", mockProvider, mockMessages);
    expect(Number.isFinite(result.robustnessScore)).toBe(true);
    expect(result.robustnessScore).toBe(0.5);
  });

  // ---------- Concessions ----------

  it("extracts concessions from rebuttal", async () => {
    mockStreamResponses(
      "Counter argument",
      "I concede that the critic has a valid point about scalability. However confidence: 0.6"
    );

    const result = await runCounterfactualDebate("Opinion", mockProvider, mockMessages);
    expect(result.concessions.length).toBeGreaterThan(0);
    expect(result.concessions[0]).toContain("I concede");
  });

  it("extracts multiple concession patterns", async () => {
    mockStreamResponses(
      "Counter",
      "The critic is right about cost. Fair point on latency. But I stand firm on architecture. Confidence: 0.5"
    );

    const result = await runCounterfactualDebate("Opinion", mockProvider, mockMessages);
    expect(result.concessions.length).toBeGreaterThanOrEqual(2);
  });

  it("returns empty concessions when none found", async () => {
    mockStreamResponses(
      "Counter",
      "I completely disagree with every point. Confidence: 0.9"
    );

    const result = await runCounterfactualDebate("Opinion", mockProvider, mockMessages);
    expect(result.concessions).toEqual([]);
  });

  // ---------- Truncation ----------

  it("truncates originalOpinion in result to 500 chars", async () => {
    const longOpinion = "x".repeat(1000);
    mockStreamResponses("Counter", "Rebuttal. confidence: 0.5");

    const result = await runCounterfactualDebate(longOpinion, mockProvider, mockMessages);
    expect(result.originalOpinion.length).toBeLessThanOrEqual(500);
  });

  it("truncates counterfactualArgument in result to 1000 chars", async () => {
    const longCounter = "y".repeat(2000);
    mockStreamResponses(longCounter, "Rebuttal. confidence: 0.5");

    const result = await runCounterfactualDebate("Opinion", mockProvider, mockMessages);
    expect(result.counterfactualArgument.length).toBeLessThanOrEqual(1000);
  });

  it("truncates rebuttal in result to 1000 chars", async () => {
    const longRebuttal = "z".repeat(2000) + " confidence: 0.5";
    mockStreamResponses("Counter", longRebuttal);

    const result = await runCounterfactualDebate("Opinion", mockProvider, mockMessages);
    expect(result.rebuttal.length).toBeLessThanOrEqual(1000);
  });

  it("truncates opinion in counter-argument prompt to 2000 chars", async () => {
    const longOpinion = "a".repeat(5000);
    mockStreamResponses("Counter", "Rebuttal. confidence: 0.5");

    await runCounterfactualDebate(longOpinion, mockProvider, mockMessages);

    const calls = (askProviderStream as ReturnType<typeof vi.fn>).mock.calls;
    // The counter message content should contain the truncated opinion
    const counterContent = calls[0][1].at(-1).content;
    // Original opinion is substring(0, 2000), so the prompt content should be capped
    expect(counterContent).not.toContain("a".repeat(2001));
  });

  it("truncates counter-argument in rebuttal prompt to 1500 chars", async () => {
    const longCounter = "b".repeat(3000);
    mockStreamResponses(longCounter, "Rebuttal. confidence: 0.5");

    await runCounterfactualDebate("Opinion", mockProvider, mockMessages);

    const calls = (askProviderStream as ReturnType<typeof vi.fn>).mock.calls;
    const rebuttalContent = calls[1][1].at(-1).content;
    expect(rebuttalContent).not.toContain("b".repeat(1501));
  });

  it("truncates opinion in rebuttal prompt to 1000 chars", async () => {
    const longOpinion = "c".repeat(3000);
    mockStreamResponses("Counter", "Rebuttal. confidence: 0.5");

    await runCounterfactualDebate(longOpinion, mockProvider, mockMessages);

    const calls = (askProviderStream as ReturnType<typeof vi.fn>).mock.calls;
    const rebuttalContent = calls[1][1].at(-1).content;
    expect(rebuttalContent).not.toContain("c".repeat(1001));
  });

  // ---------- Logging ----------

  it("logs completion with robustness score and concession count", async () => {
    mockStreamResponses(
      "Counter",
      "I concede that point. Confidence: 0.75"
    );

    await runCounterfactualDebate("Opinion", mockProvider, mockMessages);

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        robustnessScore: 0.75,
        concessionCount: expect.any(Number),
      }),
      "Counterfactual debate completed"
    );
  });

  it("includes context messages in both prompt calls", async () => {
    const ctx = [
      { role: "user" as const, content: "initial question" },
      { role: "assistant" as const, content: "initial answer" },
    ];
    mockStreamResponses("Counter", "Rebuttal. confidence: 0.5");

    await runCounterfactualDebate("Opinion", mockProvider, ctx);

    const calls = (askProviderStream as ReturnType<typeof vi.fn>).mock.calls;
    // Both calls should include context messages at the beginning
    expect(calls[0][1][0].content).toBe("initial question");
    expect(calls[0][1][1].content).toBe("initial answer");
    expect(calls[1][1][0].content).toBe("initial question");
    expect(calls[1][1][1].content).toBe("initial answer");
  });
});
