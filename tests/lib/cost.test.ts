import { describe, it, expect, vi, beforeEach } from 'vitest';
import { calculateCost, trackTokenUsage, getUserCostBreakdown, checkUserCostLimits, getOrganizationCostSummary, getCostEfficiencyMetrics } from '../../src/lib/cost.js';

// ─── Helper: build a chainable mock that resolves to `data` ──────────────────
function makeSelectMock(data: unknown[]) {
  const chain: any = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockResolvedValue(data),
    limit: vi.fn().mockResolvedValue(data),
    // Allow: await db.select().from().where()  (no orderBy/limit)
    then: (resolve: (v: unknown) => void) => resolve(data),
  };
  return chain;
}

vi.mock('../../src/lib/drizzle.js', () => ({
  db: {
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
    select: vi.fn(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
  },
}));

vi.mock('../../src/lib/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('Cost Utilities', () => {
  let db: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = (await import('../../src/lib/drizzle.js')).db;
  });

  // ── calculateCost ──────────────────────────────────────────────────────────
  describe('calculateCost', () => {
    it('should correctly calculate cost for known OpenAI models', () => {
      // gpt-4o: input $0.0025, output $0.01 per 1K tokens
      const cost = calculateCost('openai', 'gpt-4o', 1000, 1000);
      expect(cost).toBeCloseTo(0.0025 + 0.01, 6);
    });

    it('should use default rates for unknown models', () => {
      // default: (tokens * 0.001 + tokens * 0.002) / 1000
      const cost = calculateCost('unknown', 'unknown-model', 1000, 1000);
      expect(cost).toBeCloseTo(0.003, 6);
    });
  });

  // ── trackTokenUsage ────────────────────────────────────────────────────────
  describe('trackTokenUsage', () => {
    it('should call db.insert', async () => {
      await trackTokenUsage(1, 'conv1', 'openai', 'gpt-4o', 500, 500);
      expect(db.insert).toHaveBeenCalled();
    });
  });

  // ── getUserCostBreakdown ───────────────────────────────────────────────────
  describe('getUserCostBreakdown', () => {
    it('should aggregate totals from daily rows', async () => {
      const rows = [
        { userId: 1, date: new Date(), tokens: 1000, requests: 2, updatedAt: new Date() },
        { userId: 1, date: new Date(), tokens: 2000, requests: 3, updatedAt: new Date() },
      ];
      db.select.mockReturnValue(makeSelectMock(rows));

      const breakdown = await getUserCostBreakdown(1, 7);
      expect(breakdown.totalTokens).toBe(3000);
      expect(breakdown.totalCost).toBeGreaterThan(0);
    });
  });

  // ── getOrganizationCostSummary ─────────────────────────────────────────────
  describe('getOrganizationCostSummary', () => {
    it('should sum tokens across all users', async () => {
      const rows = [
        { userId: 1, date: new Date('2024-01-01'), tokens: 1000, requests: 1, updatedAt: new Date() },
        { userId: 2, date: new Date('2024-01-01'), tokens: 2000, requests: 1, updatedAt: new Date() },
      ];
      db.select.mockReturnValue(makeSelectMock(rows));

      const result = await getOrganizationCostSummary(7);
      expect(result.totalTokens).toBe(3000);
      expect(result.userBreakdown).toHaveLength(2);
    });
  });

  // ── getCostEfficiencyMetrics ───────────────────────────────────────────────
  describe('getCostEfficiencyMetrics', () => {
    it('should return metrics and recommendations for non-zero usage', async () => {
      const rows = [{ userId: 1, date: new Date(), tokens: 5000, requests: 1, updatedAt: new Date() }];
      // Both calls (getUserCostBreakdown's orderBy chain + direct where chain) resolve to rows
      db.select.mockReturnValue(makeSelectMock(rows));

      const result = await getCostEfficiencyMetrics(1, 7);
      expect(result.avgTokensPerRequest).toBe(5000);
      expect(result.recommendations).toBeInstanceOf(Array);
    });

    it('should return zero metrics and start-prompt recommendation when no usage', async () => {
      db.select.mockReturnValue(makeSelectMock([]));

      const result = await getCostEfficiencyMetrics(1, 7);
      expect(result.avgTokensPerRequest).toBe(0);
      expect(result.recommendations[0]).toContain('Start using');
    });
  });

  // ── checkUserCostLimits ────────────────────────────────────────────────────
  describe('checkUserCostLimits', () => {
    it('should return withinLimits=true when under limits', async () => {
      const dailyRow  = [{ userId: 1, date: new Date(), tokens: 100, requests: 1, updatedAt: new Date() }];
      const monthlyRow = [{ totalTokens: 500, totalRequests: 5 }];

      // First call → daily limit query  (limit(1))
      // Second call → monthly aggregate (direct where)
      db.select
        .mockReturnValueOnce(makeSelectMock(dailyRow))
        .mockReturnValueOnce(makeSelectMock(monthlyRow));

      const result = await checkUserCostLimits(1, 10, 100);
      expect(result.withinLimits).toBe(true);
      expect(result.warnings).toBeInstanceOf(Array);
    });
  });
});
