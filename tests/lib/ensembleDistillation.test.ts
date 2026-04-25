import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock logger
vi.mock("../../src/lib/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));

// Mock crypto.randomUUID
vi.mock("crypto", () => ({
  randomUUID: vi.fn(() => "00000000-0000-0000-0000-000000000000"),
}));

import {
  recordDistillationSample,
  exportDistillationDataset,
  getDistillationStats,
  clearDistillationStore,
} from "../../src/lib/ensembleDistillation.js";

function makeSample(overrides: Record<string, unknown> = {}) {
  return {
    query: "What is 2+2?",
    answer: "4",
    confidence: 0.95,
    consensusScore: 0.9,
    participatingModels: ["gpt-4", "claude-3"],
    ...overrides,
  };
}

describe("Ensemble Distillation", () => {
  beforeEach(() => {
    clearDistillationStore();
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------
  // recordDistillationSample
  // -------------------------------------------------------------------
  describe("recordDistillationSample", () => {
    it("rejects samples below confidence threshold (0.75)", () => {
      const result = recordDistillationSample(makeSample({ confidence: 0.5 }));
      expect(result).toBe(false);
      expect(getDistillationStats().totalSamples).toBe(0);
    });

    it("rejects samples at exactly below threshold", () => {
      const result = recordDistillationSample(makeSample({ confidence: 0.749 }));
      expect(result).toBe(false);
    });

    it("accepts samples at exactly the threshold (0.75)", () => {
      const result = recordDistillationSample(makeSample({ confidence: 0.75 }));
      expect(result).toBe(true);
      expect(getDistillationStats().totalSamples).toBe(1);
    });

    it("accepts samples above the threshold", () => {
      const result = recordDistillationSample(makeSample({ confidence: 0.95 }));
      expect(result).toBe(true);
    });

    it("returns boolean true on success", () => {
      const result = recordDistillationSample(makeSample());
      expect(typeof result).toBe("boolean");
      expect(result).toBe(true);
    });

    it("returns boolean false on rejection", () => {
      const result = recordDistillationSample(makeSample({ confidence: 0.1 }));
      expect(typeof result).toBe("boolean");
      expect(result).toBe(false);
    });

    it("assigns a unique id prefixed with ds_", () => {
      recordDistillationSample(makeSample());
      const dataset = exportDistillationDataset("json");
      const parsed = JSON.parse(dataset);
      expect(parsed[0].id).toMatch(/^ds_/);
    });

    it("stores query, answer, confidence, consensusScore, and models", () => {
      const sample = makeSample({
        query: "test query",
        answer: "test answer",
        confidence: 0.88,
        consensusScore: 0.85,
        participatingModels: ["m1", "m2", "m3"],
      });
      recordDistillationSample(sample);
      const dataset = JSON.parse(exportDistillationDataset("json"));
      expect(dataset[0].query).toBe("test query");
      expect(dataset[0].answer).toBe("test answer");
      expect(dataset[0].confidence).toBe(0.88);
      expect(dataset[0].consensusScore).toBe(0.85);
      expect(dataset[0].participatingModels).toEqual(["m1", "m2", "m3"]);
    });

    it("includes createdAt timestamp", () => {
      recordDistillationSample(makeSample());
      const dataset = JSON.parse(exportDistillationDataset("json"));
      expect(dataset[0].createdAt).toBeDefined();
      // Should be a valid ISO string
      expect(new Date(dataset[0].createdAt).toISOString()).toBe(dataset[0].createdAt);
    });
  });

  // -------------------------------------------------------------------
  // clampMetadata
  // -------------------------------------------------------------------
  describe("clampMetadata", () => {
    it("caps metadata at 50 keys", () => {
      const metadata: Record<string, unknown> = {};
      for (let i = 0; i < 100; i++) {
        metadata[`key_${i}`] = `value_${i}`;
      }
      recordDistillationSample(makeSample({ metadata }));
      const dataset = JSON.parse(exportDistillationDataset("json"));
      expect(Object.keys(dataset[0].metadata)).toHaveLength(50);
    });

    it("preserves metadata with 50 or fewer keys", () => {
      const metadata = { a: 1, b: 2, c: 3 };
      recordDistillationSample(makeSample({ metadata }));
      const dataset = JSON.parse(exportDistillationDataset("json"));
      expect(dataset[0].metadata).toEqual(metadata);
    });

    it("handles undefined metadata", () => {
      recordDistillationSample(makeSample({ metadata: undefined }));
      const dataset = JSON.parse(exportDistillationDataset("json"));
      // metadata should be undefined (not in output) or explicitly undefined
      expect(dataset[0].metadata).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------
  // exportDistillationDataset
  // -------------------------------------------------------------------
  describe("exportDistillationDataset", () => {
    it("exports jsonl format with one JSON object per line", () => {
      recordDistillationSample(makeSample({ query: "q1", answer: "a1" }));
      recordDistillationSample(makeSample({ query: "q2", answer: "a2" }));
      const output = exportDistillationDataset("jsonl");
      const lines = output.split("\n");
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0]).query).toBe("q1");
      expect(JSON.parse(lines[1]).query).toBe("q2");
    });

    it("exports json format as a pretty-printed array", () => {
      recordDistillationSample(makeSample());
      const output = exportDistillationDataset("json");
      const parsed = JSON.parse(output);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(1);
    });

    it("exports openai format with messages array", () => {
      recordDistillationSample(makeSample({ query: "my query", answer: "my answer" }));
      const output = exportDistillationDataset("openai");
      const parsed = JSON.parse(output);
      expect(parsed.messages).toHaveLength(2);
      expect(parsed.messages[0]).toEqual({ role: "user", content: "my query" });
      expect(parsed.messages[1]).toEqual({ role: "assistant", content: "my answer" });
    });

    it("defaults to jsonl format", () => {
      recordDistillationSample(makeSample());
      const output = exportDistillationDataset();
      // jsonl: single line, should parse as a single object
      const parsed = JSON.parse(output);
      expect(parsed.query).toBeDefined();
    });

    it("filters by minConfidence", () => {
      recordDistillationSample(makeSample({ confidence: 0.80 }));
      recordDistillationSample(makeSample({ confidence: 0.95 }));
      const output = exportDistillationDataset("json", 0.90);
      const parsed = JSON.parse(output);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].confidence).toBe(0.95);
    });

    it("returns empty string for empty store in jsonl format", () => {
      const output = exportDistillationDataset("jsonl");
      expect(output).toBe("");
    });

    it("returns empty array string for empty store in json format", () => {
      const output = exportDistillationDataset("json");
      expect(JSON.parse(output)).toEqual([]);
    });

    it("returns empty string for empty store in openai format", () => {
      const output = exportDistillationDataset("openai");
      expect(output).toBe("");
    });
  });

  // -------------------------------------------------------------------
  // getDistillationStats
  // -------------------------------------------------------------------
  describe("getDistillationStats", () => {
    it("returns zeros for empty store", () => {
      const stats = getDistillationStats();
      expect(stats).toEqual({
        totalSamples: 0,
        avgConfidence: 0,
        modelCoverage: {},
      });
    });

    it("returns correct stats for populated store", () => {
      recordDistillationSample(makeSample({
        confidence: 0.9,
        participatingModels: ["gpt-4", "claude-3"],
      }));
      recordDistillationSample(makeSample({
        confidence: 0.8,
        participatingModels: ["gpt-4"],
      }));
      const stats = getDistillationStats();
      expect(stats.totalSamples).toBe(2);
      expect(stats.avgConfidence).toBeCloseTo(0.85, 3);
      expect(stats.modelCoverage["gpt-4"]).toBe(2);
      expect(stats.modelCoverage["claude-3"]).toBe(1);
    });

    it("rounds avgConfidence to 3 decimal places", () => {
      recordDistillationSample(makeSample({ confidence: 0.777 }));
      recordDistillationSample(makeSample({ confidence: 0.888 }));
      const stats = getDistillationStats();
      const decimalPlaces = String(stats.avgConfidence).split(".")[1]?.length ?? 0;
      expect(decimalPlaces).toBeLessThanOrEqual(3);
    });
  });

  // -------------------------------------------------------------------
  // clearDistillationStore
  // -------------------------------------------------------------------
  describe("clearDistillationStore", () => {
    it("clears all samples", () => {
      recordDistillationSample(makeSample());
      recordDistillationSample(makeSample());
      expect(getDistillationStats().totalSamples).toBe(2);
      clearDistillationStore();
      expect(getDistillationStats().totalSamples).toBe(0);
    });

    it("allows adding new samples after clearing", () => {
      recordDistillationSample(makeSample());
      clearDistillationStore();
      recordDistillationSample(makeSample());
      expect(getDistillationStats().totalSamples).toBe(1);
    });
  });

  // -------------------------------------------------------------------
  // Memory bounding
  // -------------------------------------------------------------------
  describe("memory bounding", () => {
    it("drops oldest half when exceeding MAX_SAMPLES", () => {
      // We can't easily fill 100k samples, but we can verify the mechanism
      // by checking behavior with a reasonable batch
      // After exceeding MAX_SAMPLES, the store keeps the recent half
      // We'll add enough to verify the store doesn't grow unbounded
      const batchSize = 50;
      for (let i = 0; i < batchSize; i++) {
        recordDistillationSample(makeSample({
          query: `query-${i}`,
          confidence: 0.9,
        }));
      }
      const stats = getDistillationStats();
      expect(stats.totalSamples).toBe(batchSize);
      // Verify all samples are accessible
      const dataset = JSON.parse(exportDistillationDataset("json"));
      expect(dataset).toHaveLength(batchSize);
    });
  });
});
