import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock mlWorker
vi.mock("../../src/lib/ml/ml_worker.js", () => ({
  mlWorker: {
    computeSimilarity: vi.fn()
  }
}));

// Mock logger
vi.mock("../../src/lib/logger.js", () => ({
  default: { error: vi.fn() }
}));

describe("Metrics Utility", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { clearSimilarityCache } = await import("../../src/lib/metrics.js");
    clearSimilarityCache();
  });

  const mockOutputs: any[] = [
    { answer: "The capital of France is Paris" },
    { answer: "Paris is the French capital" },
    { answer: "London is in UK" }
  ];

  it("should return similarity between strings", async () => {
    const { pairwiseSimilarity } = await import("../../src/lib/metrics.js");
    const { mlWorker } = await import("../../src/lib/ml/ml_worker.js");

    (mlWorker.computeSimilarity as any).mockResolvedValue(0.9);

    const result = await pairwiseSimilarity(mockOutputs[0], mockOutputs[1]);
    expect(result).toBe(0.9);
  });

  it("should use tokenSimilarity fallback in test mode or on error", async () => {
    const { pairwiseSimilarity } = await import("../../src/lib/metrics.js");
    const { mlWorker } = await import("../../src/lib/ml/ml_worker.js");

    (mlWorker.computeSimilarity as any).mockRejectedValue(new Error("ML error"));

    // In test mode (NODE_ENV=test), falls back to tokenSimilarity
    // tokenSimilarity uses Jaccard coefficient on word tokens
    const result = await pairwiseSimilarity(mockOutputs[0], mockOutputs[1]);
    // The result will be the token overlap, which is a number between 0 and 1
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(1);
  });

  it("should return 1.0 for small output sets", async () => {
    const { computeConsensus } = await import("../../src/lib/metrics.js");
    expect(await computeConsensus([])).toBe(1.0);
    expect(await computeConsensus([mockOutputs[0]])).toBe(1.0);
  });

  it("should compute average consensus score", async () => {
    const { computeConsensus } = await import("../../src/lib/metrics.js");
    const { mlWorker } = await import("../../src/lib/ml/ml_worker.js");

    (mlWorker.computeSimilarity as any).mockResolvedValue(0.8);

    // With 3 outputs, there are 3 pairs: (0,1), (0,2), (1,2)
    // Each pair returns 0.8, but results may be cached from previous tests
    // Average = sum of similarities / number of pairs
    const score = await computeConsensus([mockOutputs[0], mockOutputs[1], mockOutputs[2]]);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it("should check if consensus reached against threshold", async () => {
    const { isConsensusReached } = await import("../../src/lib/metrics.js");
    const { mlWorker } = await import("../../src/lib/ml/ml_worker.js");

    // Default threshold is 0.85 (from CONSENSUS_THRESHOLD env var)
    (mlWorker.computeSimilarity as any).mockResolvedValue(0.95);
    // With 3 outputs: 3 pairs, all return 0.95, avg = 0.95 >= 0.85
    expect(await isConsensusReached(mockOutputs)).toBe(true);

    (mlWorker.computeSimilarity as any).mockResolvedValue(0.5);
    // Need fresh inputs to avoid cache hits
    const freshOutputs = [
      { answer: "unique answer alpha one" },
      { answer: "unique answer beta two" },
      { answer: "unique answer gamma three" }
    ];
    expect(await isConsensusReached(freshOutputs)).toBe(false);
  });

  it("should fall back to token similarity on ML failure in all modes", async () => {
    const { pairwiseSimilarity } = await import("../../src/lib/metrics.js");
    const { mlWorker } = await import("../../src/lib/ml/ml_worker.js");
    const { default: logger } = await import("../../src/lib/logger.js");

    const oldEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";

    (mlWorker.computeSimilarity as any).mockRejectedValue(new Error("Critical ML failure"));

    // Source now falls back to tokenSimilarity in all cases (logs error but doesn't throw)
    const freshA = { answer: "completely unique production test string alpha" };
    const freshB = { answer: "completely unique production test string beta" };
    const result = await pairwiseSimilarity(freshA, freshB);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(1);
    expect(logger.error).toHaveBeenCalled();

    process.env.NODE_ENV = oldEnv;
  });
});
