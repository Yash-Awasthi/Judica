import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock dependencies
vi.mock("../../src/lib/logger.js", () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock("../../src/lib/drizzle.js", () => ({
  db: {
    delete: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue({ rowCount: 5 }),
  },
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    lt: vi.fn(),
  };
});

vi.mock("../../src/lib/redis.js", () => ({
  default: {
    keys: vi.fn().mockResolvedValue(["cache:1", "cache:2"]),
    pttl: vi.fn((key) => {
      if (key === "cache:1") return Promise.resolve(100);
      return Promise.resolve(-1); // cache:2 should be deleted
    }),
    del: vi.fn().mockResolvedValue(1),
  },
}));

describe("Sweeper", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("should start sweepers and run periodically", async () => {
        const { startSweepers, stopSweepers } = await import("../../src/lib/sweeper.js");
        const { db } = await import("../../src/lib/drizzle.js");
        
        startSweepers();
        // It should run once immediately and then on interval
        // advance timer by exactly one sweep interval rather than all timers
        await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
        
        expect(db.delete).toHaveBeenCalled();
        
        stopSweepers();
    });

    it("should prevent starting sweepers multiple times", async () => {
        const { startSweepers, stopSweepers } = await import("../../src/lib/sweeper.js");
        const logger = (await import("../../src/lib/logger.js")).default;
        
        startSweepers();
        startSweepers(); // Second time should warn
        
        expect(logger.warn).toHaveBeenCalledWith("Sweepers already running");
        
        stopSweepers();
    });

    it("should stop sweepers cleanly", async () => {
        const { startSweepers, stopSweepers } = await import("../../src/lib/sweeper.js");
        const logger = (await import("../../src/lib/logger.js")).default;
        
        startSweepers();
        stopSweepers();
        
        expect(logger.info).toHaveBeenCalledWith("Sweepers stopped");
        
        // Calling stop again should do nothing
        logger.info.mockClear();
        stopSweepers();
        expect(logger.info).not.toHaveBeenCalled();
    });

    it("should run manual sweep", async () => {
        const { runManualSweep } = await import("../../src/lib/sweeper.js");
        const { db } = await import("../../src/lib/drizzle.js");
        const redis = (await import("../../src/lib/redis.js")).default;
        
        await runManualSweep();
        
        // Ensure all db and redis operations were called
        expect(db.delete).toHaveBeenCalled();
        expect(redis.keys).toHaveBeenCalledWith("cache:*");
        expect(redis.del).toHaveBeenCalledWith("cache:2");
    });
    
    it("should handle sweep errors gracefully", async () => {
        const { db } = await import("../../src/lib/drizzle.js");
        const redis = (await import("../../src/lib/redis.js")).default;

        (db.where as any).mockRejectedValueOnce(new Error("DB Error"));
        (redis.keys as any).mockRejectedValueOnce(new Error("Redis Error"));

        const { runManualSweep } = await import("../../src/lib/sweeper.js");

        await expect(runManualSweep()).resolves.not.toThrow();

        const logger = (await import("../../src/lib/logger.js")).default;
        expect(logger.error).toHaveBeenCalled();
    });

    // P5-12: Additional sweeper coverage
    it("should skip Redis keys with positive TTL", async () => {
        const redis = (await import("../../src/lib/redis.js")).default;
        // Both keys have positive TTL — neither should be deleted
        (redis.pttl as any).mockResolvedValue(5000);

        const { runManualSweep } = await import("../../src/lib/sweeper.js");
        (redis.del as any).mockClear();

        await runManualSweep();

        expect(redis.del).not.toHaveBeenCalled();
    });

    it("should log sweep duration", async () => {
        const logger = (await import("../../src/lib/logger.js")).default;
        const { runManualSweep } = await import("../../src/lib/sweeper.js");

        await runManualSweep();

        const durationCall = (logger.info as any).mock.calls.find(
            (call: any[]) => call[0]?.duration !== undefined
        );
        expect(durationCall).toBeTruthy();
        expect(durationCall[0].totalSwept).toBeGreaterThanOrEqual(0);
    });
});
