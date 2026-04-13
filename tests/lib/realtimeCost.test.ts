import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock dependencies
vi.mock("../../src/lib/logger.js", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../../src/lib/cost.js", () => ({
  calculateCost: vi.fn((_p, _m, i, o) => (i + o) * 0.0001),
}));

describe("RealTimeCostTracker", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(async () => {
    const { cleanupCostTrackerInterval } = await import("../../src/lib/realtimeCost.js");
    cleanupCostTrackerInterval();
    vi.useRealTimers();
  });

  it("should track session cost correctly", async () => {
    const { realTimeCostTracker } = await import("../../src/lib/realtimeCost.js");
    
    realTimeCostTracker.startSession(1, "sess1", "conv1");
    
    const entry = realTimeCostTracker.addCostEntry("sess1", 1, "conv1", "openai", "gpt-4", 100, 200);
    
    expect(entry.cost).toBeCloseTo(0.03);
    expect(entry.cumulativeCost).toBeCloseTo(0.03);

    const ledger = realTimeCostTracker.getLedger(1);
    expect(ledger?.currentSession.totalCost).toBeCloseTo(0.03);
    expect(ledger?.currentSession.requestCount).toBe(1);

    realTimeCostTracker.addCostEntry("sess1", 1, "conv1", "openai", "gpt-4", 100, 100);
    expect(ledger?.currentSession.totalCost).toBeCloseTo(0.05);
    expect(ledger?.currentSession.requestCount).toBe(2);
  });

  it("should end session and update totals", async () => {
    const { realTimeCostTracker } = await import("../../src/lib/realtimeCost.js");
    
    realTimeCostTracker.startSession(1, "sess1", "conv1");
    realTimeCostTracker.addCostEntry("sess1", 1, "conv1", "openai", "gpt-4", 100, 100);
    
    const entries = realTimeCostTracker.endSession("sess1");
    expect(entries).toHaveLength(1);
    
    const ledger = realTimeCostTracker.getLedger(1);
    expect(ledger?.dailyTotal).toBeCloseTo(0.02);
    expect(ledger?.monthlyTotal).toBeCloseTo(0.02);
  });

  it("should alert when limits are reached", async () => {
    const { realTimeCostTracker } = await import("../../src/lib/realtimeCost.js");
    const alertSpy = vi.fn();
    
    realTimeCostTracker.startSession(1, "sess1", "conv1");
    realTimeCostTracker.setLimits(1, 0.1, 1.0); // Daily limit 0.1
    realTimeCostTracker.onAlert(1, alertSpy);

    // Add cost that reaches 90% of daily limit (0.09)
    // 900 tokens * 0.0001 = 0.09
    realTimeCostTracker.addCostEntry("sess1", 1, "conv1", "openai", "gpt-4", 450, 450);
    
    expect(alertSpy).toHaveBeenCalledWith(expect.arrayContaining([
        expect.stringContaining("Daily cost limit reached")
    ]));
  });

  it("should cleanup old data", async () => {
    const { realTimeCostTracker } = await import("../../src/lib/realtimeCost.js");
    
    realTimeCostTracker.startSession(1, "sess1", "conv1");
    
    // Advance time by 25 hours (TTL is 24h)
    vi.advanceTimersByTime(25 * 60 * 60 * 1000);
    
    realTimeCostTracker.cleanup();
    
    expect(realTimeCostTracker.getLedger(1)).toBeNull();
  });

  it("should get statistics", async () => {
    const { realTimeCostTracker } = await import("../../src/lib/realtimeCost.js");
    
    realTimeCostTracker.startSession(1, "sess1", "conv1");
    realTimeCostTracker.addCostEntry("sess1", 1, "conv1", "p1", "m1", 100, 100);
    
    const stats = realTimeCostTracker.getStatistics(1);
    expect(stats?.totalCost).toBeCloseTo(0.02);
    expect(stats?.topProviders[0].provider).toBe("p1");
    expect(stats?.costTrend).toHaveLength(1);
  });

  it("should enforce user bounds by removing oldest users", async () => {
    const { realTimeCostTracker } = await import("../../src/lib/realtimeCost.js");
    
    // To test enforceUserBounds, we could either set maxUsers to a small number
    // or just assume the logic works. But we want 100% coverage.
    
    // Accessing private members is tricky in TS/Vitest but we can try casting
    (realTimeCostTracker as any).maxUsers = 2;
    
    realTimeCostTracker.startSession(1, "s1", "c1");
    vi.advanceTimersByTime(1000);
    realTimeCostTracker.startSession(2, "s2", "c2");
    vi.advanceTimersByTime(1000);
    
    // This should trigger cleanup of user 1 (oldest)
    realTimeCostTracker.startSession(3, "s3", "c3");
    
    expect(realTimeCostTracker.getLedger(1)).toBeNull();
    expect(realTimeCostTracker.getLedger(2)).toBeDefined();
    expect(realTimeCostTracker.getLedger(3)).toBeDefined();
  });
});
