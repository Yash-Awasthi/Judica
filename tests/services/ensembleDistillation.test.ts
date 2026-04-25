import { describe, it, expect } from "vitest";

import {
  filterForTraining,
  toJSONL,
  toAlpacaFormat,
  computeDatasetMetrics,
} from "../../src/services/ensembleDistillation.service.js";
import type {
  TrainingSample,
  DistillationConfig,
} from "../../src/services/ensembleDistillation.service.js";

// ── helpers ──────────────────────────────────────────────────────────────────

let sampleCounter = 0;

function makeSample(overrides: Partial<TrainingSample> = {}): TrainingSample {
  return {
    id: `sample-${++sampleCounter}`,
    question: "What is AI?",
    context: "An introduction to artificial intelligence.",
    response: "AI is the simulation of human intelligence in machines.",
    confidence: 0.9,
    archetypeContributions: { expert: 0.6, analyst: 0.4 },
    quality: "high",
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

// ── filterForTraining ─────────────────────────────────────────────────────────

describe("filterForTraining", () => {
  it("returns empty array for empty input", () => {
    expect(filterForTraining([])).toEqual([]);
  });

  it("filters out samples below minConfidence", () => {
    const samples = [
      makeSample({ confidence: 0.9, quality: "high" }),
      makeSample({ confidence: 0.5, quality: "high" }),
    ];
    const result = filterForTraining(samples, { minConfidence: 0.8, minAgreement: 0, maxSamples: 100, includeReasoning: true, format: "jsonl" });
    expect(result).toHaveLength(1);
    expect(result[0].confidence).toBe(0.9);
  });

  it("filters out low-quality samples", () => {
    const samples = [
      makeSample({ confidence: 0.9, quality: "high" }),
      makeSample({ confidence: 0.9, quality: "low" }),
      makeSample({ confidence: 0.9, quality: "medium" }),
    ];
    const result = filterForTraining(samples);
    // only high and medium pass
    expect(result.every((s) => s.quality !== "low")).toBe(true);
    expect(result).toHaveLength(2);
  });

  it("sorts results by confidence descending", () => {
    const samples = [
      makeSample({ confidence: 0.7, quality: "high" }),
      makeSample({ confidence: 0.95, quality: "high" }),
      makeSample({ confidence: 0.82, quality: "high" }),
    ];
    const result = filterForTraining(samples, { minConfidence: 0, minAgreement: 0, maxSamples: 100, includeReasoning: true, format: "jsonl" });
    expect(result[0].confidence).toBe(0.95);
    expect(result[1].confidence).toBe(0.82);
    expect(result[2].confidence).toBe(0.7);
  });

  it("caps results at maxSamples", () => {
    const samples = Array.from({ length: 20 }, () => makeSample({ confidence: 0.9, quality: "high" }));
    const result = filterForTraining(samples, { minConfidence: 0, minAgreement: 0, maxSamples: 5, includeReasoning: true, format: "jsonl" });
    expect(result).toHaveLength(5);
  });

  it("enforces ABSOLUTE_MAX_SAMPLES hard cap of 50,000", () => {
    const samples = Array.from({ length: 100 }, () => makeSample({ confidence: 0.9, quality: "high" }));
    const bigConfig: DistillationConfig = {
      minConfidence: 0,
      minAgreement: 0,
      maxSamples: 999_999, // exceeds hard cap
      includeReasoning: true,
      format: "jsonl",
    };
    const result = filterForTraining(samples, bigConfig);
    // All 100 fit under the hard cap, but the call doesn't crash
    expect(result.length).toBeLessThanOrEqual(50_000);
    expect(result).toHaveLength(100);
  });

  it("uses default config when none provided", () => {
    const samples = [
      makeSample({ confidence: 0.95, quality: "high" }),
      makeSample({ confidence: 0.5, quality: "high" }), // below default minConfidence 0.8
    ];
    const result = filterForTraining(samples);
    expect(result).toHaveLength(1);
    expect(result[0].confidence).toBe(0.95);
  });
});

// ── toJSONL ───────────────────────────────────────────────────────────────────

describe("toJSONL", () => {
  it("returns empty string for empty samples", () => {
    expect(toJSONL([])).toBe("");
  });

  it("produces one JSON line per sample", () => {
    const samples = [makeSample(), makeSample()];
    const output = toJSONL(samples);
    const lines = output.split("\n");
    expect(lines).toHaveLength(2);
  });

  it("each line is valid JSON", () => {
    const samples = [makeSample()];
    const output = toJSONL(samples);
    expect(() => JSON.parse(output)).not.toThrow();
  });

  it("includes user and assistant messages in messages array", () => {
    const sample = makeSample({ question: "Q?", response: "A." });
    const output = toJSONL([sample]);
    const parsed = JSON.parse(output);
    expect(parsed.messages).toContainEqual({ role: "user", content: "Q?" });
    expect(parsed.messages).toContainEqual({ role: "assistant", content: "A." });
  });

  it("includes context as system message when includeReasoning=true", () => {
    const sample = makeSample({ context: "Some context." });
    const output = toJSONL([sample], true);
    const parsed = JSON.parse(output);
    expect(parsed.messages).toContainEqual(
      expect.objectContaining({ role: "system", content: expect.stringContaining("Some context.") })
    );
  });

  it("omits context system message when includeReasoning=false", () => {
    const sample = makeSample({ context: "Some context." });
    const output = toJSONL([sample], false);
    const parsed = JSON.parse(output);
    const systemMsg = parsed.messages.find((m: { role: string }) => m.role === "system");
    expect(systemMsg).toBeUndefined();
  });

  it("omits context when sample has no context even with includeReasoning=true", () => {
    const sample = makeSample({ context: undefined });
    const output = toJSONL([sample], true);
    const parsed = JSON.parse(output);
    const systemMsg = parsed.messages.find((m: { role: string }) => m.role === "system");
    expect(systemMsg).toBeUndefined();
  });
});

// ── toAlpacaFormat ────────────────────────────────────────────────────────────

describe("toAlpacaFormat", () => {
  it("returns valid JSON array", () => {
    const samples = [makeSample()];
    const output = toAlpacaFormat(samples);
    expect(() => JSON.parse(output)).not.toThrow();
    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
  });

  it("maps question to instruction field", () => {
    const sample = makeSample({ question: "What is X?" });
    const parsed = JSON.parse(toAlpacaFormat([sample]));
    expect(parsed[0].instruction).toBe("What is X?");
  });

  it("maps response to output field", () => {
    const sample = makeSample({ response: "X is Y." });
    const parsed = JSON.parse(toAlpacaFormat([sample]));
    expect(parsed[0].output).toBe("X is Y.");
  });

  it("maps context to input field", () => {
    const sample = makeSample({ context: "Background info." });
    const parsed = JSON.parse(toAlpacaFormat([sample]));
    expect(parsed[0].input).toBe("Background info.");
  });

  it("uses empty string for input when context is undefined", () => {
    const sample = makeSample({ context: undefined });
    const parsed = JSON.parse(toAlpacaFormat([sample]));
    expect(parsed[0].input).toBe("");
  });

  it("returns empty array for empty samples", () => {
    const parsed = JSON.parse(toAlpacaFormat([]));
    expect(parsed).toEqual([]);
  });
});

// ── computeDatasetMetrics ─────────────────────────────────────────────────────

describe("computeDatasetMetrics", () => {
  it("returns zero-metrics for empty array", () => {
    const metrics = computeDatasetMetrics([]);
    expect(metrics.totalSamples).toBe(0);
    expect(metrics.avgConfidence).toBe(0);
    expect(metrics.qualityDistribution).toEqual({});
    expect(metrics.avgResponseLength).toBe(0);
  });

  it("counts total samples correctly", () => {
    const samples = [makeSample(), makeSample(), makeSample()];
    const metrics = computeDatasetMetrics(samples);
    expect(metrics.totalSamples).toBe(3);
  });

  it("computes average confidence rounded to 2 decimal places", () => {
    const samples = [
      makeSample({ confidence: 0.9 }),
      makeSample({ confidence: 0.7 }),
    ];
    const metrics = computeDatasetMetrics(samples);
    expect(metrics.avgConfidence).toBe(0.8);
  });

  it("rounds avgConfidence to 2 decimal places", () => {
    const samples = [
      makeSample({ confidence: 1 / 3 }),
      makeSample({ confidence: 1 / 3 }),
      makeSample({ confidence: 1 / 3 }),
    ];
    const metrics = computeDatasetMetrics(samples);
    expect(metrics.avgConfidence).toBe(0.33);
  });

  it("computes quality distribution correctly", () => {
    const samples = [
      makeSample({ quality: "high" }),
      makeSample({ quality: "high" }),
      makeSample({ quality: "medium" }),
      makeSample({ quality: "low" }),
    ];
    const metrics = computeDatasetMetrics(samples);
    expect(metrics.qualityDistribution).toEqual({ high: 2, medium: 1, low: 1 });
  });

  it("computes average response length correctly", () => {
    const r1 = "AAAA"; // 4 chars
    const r2 = "BBBBBB"; // 6 chars
    const samples = [
      makeSample({ response: r1 }),
      makeSample({ response: r2 }),
    ];
    const metrics = computeDatasetMetrics(samples);
    expect(metrics.avgResponseLength).toBe(5); // (4+6)/2
  });

  it("rounds avgResponseLength to integer", () => {
    const samples = [
      makeSample({ response: "A" }),  // 1
      makeSample({ response: "BB" }), // 2
    ];
    const metrics = computeDatasetMetrics(samples);
    expect(Number.isInteger(metrics.avgResponseLength)).toBe(true);
    expect(metrics.avgResponseLength).toBe(2); // Math.round(1.5) = 2
  });
});
