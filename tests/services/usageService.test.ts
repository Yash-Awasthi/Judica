import { describe, it, expect, vi, beforeEach } from "vitest";
import { updateDailyUsage, getDailyUsage, getUsageStats } from "../../src/services/usageService.js";
import { db } from "../../src/lib/drizzle.js";
import { dailyUsage } from "../../src/db/schema/users.js";

vi.mock("../../src/lib/drizzle.js", () => ({
  db: {
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoUpdate: vi.fn().mockResolvedValue([])
      }))
    })),
    select: vi.fn(),
  }
}));

vi.mock("../../src/lib/logger.js", () => ({
  default: { error: vi.fn() }
}));

describe("Usage Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("updateDailyUsage", () => {
    it("should skip update if cache hit", async () => {
      await updateDailyUsage({ userId: 1, tokensUsed: 100, isCacheHit: true });
      expect(db.insert).not.toHaveBeenCalled();
    });

    it("should update usage on cache miss with tokens", async () => {
      await updateDailyUsage({ userId: 1, tokensUsed: 100, isCacheHit: false });
      expect(db.insert).toHaveBeenCalledWith(dailyUsage);
    });

    it("should throw and log if DB call fails", async () => {
      vi.mocked(db.insert).mockImplementationOnce(() => { throw new Error("DB Error"); });
      await expect(updateDailyUsage({ userId: 1, tokensUsed: 100, isCacheHit: false }))
        .rejects.toThrow("DB Error");
    });
  });

  describe("getDailyUsage", () => {
    it("should fetch usage with date filters", async () => {
      vi.mocked(db.select).mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockResolvedValue([{ userId: 1, tokens: 100 }])
      } as any);

      const result = await getDailyUsage(1, new Date("2024-01-01"), new Date("2024-01-02"));
      expect(result).toHaveLength(1);
      expect(db.select).toHaveBeenCalled();
    });

    it("should handle error in getDailyUsage", async () => {
      vi.mocked(db.select).mockImplementationOnce(() => { throw new Error("DB Error"); });
      await expect(getDailyUsage(1)).rejects.toThrow("DB Error");
    });
  });

  describe("getUsageStats", () => {
    it("should calculate total stats", async () => {
      vi.mocked(db.select).mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([{ totalTokens: "1000", totalRequests: "10", daysActive: "5" }])
      } as any);

      const stats = await getUsageStats(1);
      expect(stats.totalTokens).toBe(1000);
      expect(stats.daysActive).toBe(5);
    });

    it("should handle null results", async () => {
      vi.mocked(db.select).mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([{}])
      } as any);

      const stats = await getUsageStats(1);
      expect(stats.totalTokens).toBe(0);
    });

    it("should handle error in getUsageStats", async () => {
      vi.mocked(db.select).mockImplementationOnce(() => { throw new Error("DB Error"); });
      await expect(getUsageStats(1)).rejects.toThrow("DB Error");
    });
  });
});
