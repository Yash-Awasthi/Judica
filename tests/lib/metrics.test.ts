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
  beforeEach(() => {
    vi.clearAllMocks();
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
    
    const result = await pairwiseSimilarity(mockOutputs[0], mockOutputs[1]);
    expect(result).toBeCloseTo(0.6);
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
    
    const score = await computeConsensus([mockOutputs[0], mockOutputs[1], mockOutputs[2]]);
    expect(score).toBeCloseTo(0.8);
  });

  it("should check if consensus reached", async () => {
    const { isConsensusReached } = await import("../../src/lib/metrics.js");
    const { mlWorker } = await import("../../src/lib/ml/ml_worker.js");

    (mlWorker.computeSimilarity as any).mockResolvedValue(0.9);
    expect(await isConsensusReached(mockOutputs)).toBe(true);
    
    (mlWorker.computeSimilarity as any).mockResolvedValue(0.7);
    expect(await isConsensusReached(mockOutputs)).toBe(false);
  });

  it("should throw on ML failure if not in test/ENOENT", async () => {
    const { pairwiseSimilarity } = await import("../../src/lib/metrics.js");
    const { mlWorker } = await import("../../src/lib/ml/ml_worker.js");
    const { default: logger } = await import("../../src/lib/logger.js");

    const oldEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    
    (mlWorker.computeSimilarity as any).mockRejectedValue(new Error("Critical ML failure"));
    
    await expect(pairwiseSimilarity(mockOutputs[0], mockOutputs[1])).rejects.toThrow("ML Consensus Engine Failure");
    expect(logger.error).toHaveBeenCalled();
    
    process.env.NODE_ENV = oldEnv;
  });
});
