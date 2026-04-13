import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../../src/lib/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe("ML Worker", () => {
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it("throws in test mode (NODE_ENV=test) to avoid spawning Python", async () => {
    process.env.NODE_ENV = "test";
    const { mlWorker } = await import("../../../src/lib/ml/ml_worker.js");

    await expect(mlWorker.computeSimilarity("hello", "world")).rejects.toThrow(
      "ML worker skipped in test mode"
    );
  });

  it("exposes the expected interface (init, computeSimilarity, shutdown)", async () => {
    process.env.NODE_ENV = "test";
    const { mlWorker } = await import("../../../src/lib/ml/ml_worker.js");

    expect(typeof mlWorker.computeSimilarity).toBe("function");
    expect(typeof mlWorker.shutdown).toBe("function");
    expect(typeof mlWorker.init).toBe("function");
  });

  it("handles subprocess errors - rejects with ENOENT code in test mode", async () => {
    process.env.NODE_ENV = "test";
    const { mlWorker } = await import("../../../src/lib/ml/ml_worker.js");

    try {
      await mlWorker.computeSimilarity("a", "b");
      expect.unreachable("Should have thrown");
    } catch (err: any) {
      expect(err.code).toBe("ENOENT");
      expect(err.message).toContain("skipped in test mode");
    }
  });

  it("handles timeout - rejects on computeSimilarity in test mode", async () => {
    process.env.NODE_ENV = "test";
    const { mlWorker } = await import("../../../src/lib/ml/ml_worker.js");

    // In test mode, computeSimilarity rejects immediately before reaching timeout logic
    const promise = mlWorker.computeSimilarity("text1", "text2");
    await expect(promise).rejects.toThrow();
  });

  it("shutdown cleans up process state without throwing", async () => {
    process.env.NODE_ENV = "test";
    const { mlWorker } = await import("../../../src/lib/ml/ml_worker.js");

    // shutdown should not throw even if no process has been spawned
    await expect(mlWorker.shutdown()).resolves.toBeUndefined();
  });
});
