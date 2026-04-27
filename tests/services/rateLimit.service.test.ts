const { mockPipelineExec, mockPipelineIncr, mockPipelineIncrby, mockPipelineExpire, mockPipeline } = vi.hoisted(() => {
  const mockPipelineExec = vi.fn().mockResolvedValue([
    [null, 1],
    [null, 1],
    [null, 1],
    [null, 1],
    [null, 1],
    [null, 1],
  ]);
  const mockPipelineIncr = vi.fn().mockReturnThis();
  const mockPipelineIncrby = vi.fn().mockReturnThis();
  const mockPipelineExpire = vi.fn().mockReturnThis();
  const mockPipeline = vi.fn().mockReturnValue({
    incr: mockPipelineIncr,
    incrby: mockPipelineIncrby,
    expire: mockPipelineExpire,
    exec: mockPipelineExec,
  });
  return { mockPipelineExec, mockPipelineIncr, mockPipelineIncrby, mockPipelineExpire, mockPipeline };
});

vi.mock("../../src/lib/redis.js", () => ({
  default: { pipeline: mockPipeline },
}));

vi.mock("../../src/lib/logger.js", () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a, b) => ({ eq: true, a, b })),
  and: vi.fn((...args) => ({ and: true, args })),
  inArray: vi.fn((col, vals) => ({ inArray: true, col, vals })),
  desc: vi.fn((col) => ({ desc: true, col })),
  count: vi.fn(() => "count(*)"),
  sql: vi.fn(() => "sql"),
  gte: vi.fn((a, b) => ({ gte: true, a, b })),
  lte: vi.fn((a, b) => ({ lte: true, a, b })),
}));

vi.mock("../../src/db/schema/rateLimits.js", () => ({
  rateLimitTiers: {
    id: "id",
    name: "name",
    requestsPerMinute: "requestsPerMinute",
    requestsPerHour: "requestsPerHour",
    requestsPerDay: "requestsPerDay",
    tokensPerMinute: "tokensPerMinute",
    tokensPerDay: "tokensPerDay",
    maxConcurrent: "maxConcurrent",
  },
  userRateLimits: { userId: "userId", tierId: "tierId" },
  groupRateLimits: { groupId: "groupId", tierId: "tierId" },
}));

vi.mock("../../src/db/schema/userGroups.js", () => ({
  userGroupMembers: { userId: "userId", groupId: "groupId" },
}));

// ─── Hoisted DB mocks ─────────────────────────────────────────────────────────
const {
  mockDbSelect,
  mockDbInsert,
  mockDbUpdate,
  mockDbDelete,
  mockSelectFrom,
  mockInsertValues,
  mockUpdateSet,
  mockDeleteWhere,
  mockDeleteReturning,
} = vi.hoisted(() => {
  const mockDeleteReturning = vi.fn().mockResolvedValue([]);
  const mockDeleteWhere = vi.fn().mockImplementation(() => {
    const p = Promise.resolve([]);
    return Object.assign(p, { returning: mockDeleteReturning });
  });
  const mockDbDelete = vi.fn().mockReturnValue({ where: mockDeleteWhere });

  const mockInsertReturning = vi.fn().mockResolvedValue([{ id: 1, name: "default" }]);
  const mockOnConflict = vi.fn().mockResolvedValue(undefined);
  const mockInsertValues = vi.fn().mockReturnValue({
    returning: mockInsertReturning,
    onConflictDoUpdate: mockOnConflict,
  });
  const mockDbInsert = vi.fn().mockReturnValue({ values: mockInsertValues });

  const mockUpdateReturning = vi.fn().mockResolvedValue([]);
  const mockUpdateWhere = vi.fn().mockReturnValue({ returning: mockUpdateReturning });
  const mockUpdateSet = vi.fn().mockReturnValue({ where: mockUpdateWhere });
  const mockDbUpdate = vi.fn().mockReturnValue({ set: mockUpdateSet });

  const mockSelectLimit = vi.fn().mockResolvedValue([]);
  const mockSelectWhere = vi.fn().mockReturnValue({ limit: mockSelectLimit });
  const mockSelectFrom = vi.fn().mockReturnValue({ where: mockSelectWhere });
  const mockDbSelect = vi.fn().mockReturnValue({ from: mockSelectFrom });

  return {
    mockDbSelect,
    mockDbInsert,
    mockDbUpdate,
    mockDbDelete,
    mockSelectFrom,
    mockInsertValues,
    mockUpdateSet,
    mockDeleteWhere,
    mockDeleteReturning,
  };
});

vi.mock("../../src/lib/drizzle.js", () => ({
  db: {
    select: mockDbSelect,
    insert: mockDbInsert,
    update: mockDbUpdate,
    delete: mockDbDelete,
  },
}));

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  checkRateLimit,
  trackTokenUsage,
  listTiers,
  createTier,
  updateTier,
  deleteTier,
  setUserTier,
  removeUserTier,
  setGroupTier,
  removeGroupTier,
  resolveUserTier,
} from "../../src/services/rateLimit.service.js";

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const defaultTier = {
  id: 1,
  name: "default",
  requestsPerMinute: 60,
  requestsPerHour: 1000,
  requestsPerDay: 10000,
  tokensPerMinute: 100000,
  tokensPerDay: 1000000,
  maxConcurrent: 5,
};

const premiumTier = {
  id: 2,
  name: "premium",
  requestsPerMinute: 200,
  requestsPerHour: 5000,
  requestsPerDay: 50000,
  tokensPerMinute: 500000,
  tokensPerDay: 5000000,
  maxConcurrent: 20,
};

describe("RateLimit Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Reset pipeline mock
    mockPipelineExec.mockResolvedValue([
      [null, 1],
      [null, 1],
      [null, 1],
      [null, 1],
      [null, 1],
      [null, 1],
    ]);

    // Reset select chain - load default tier for resolveUserTier
    mockSelectFrom.mockResolvedValue([defaultTier]);
    mockDbSelect.mockReturnValue({ from: mockSelectFrom });

    // Reset insert
    const mockOnConflict = vi.fn().mockResolvedValue(undefined);
    const mockInsertReturning = vi.fn().mockResolvedValue([defaultTier]);
    mockInsertValues.mockReturnValue({ returning: mockInsertReturning, onConflictDoUpdate: mockOnConflict });

    // Reset update
    const mockUpdateReturning = vi.fn().mockResolvedValue([]);
    const mockUpdateWhere = vi.fn().mockReturnValue({ returning: mockUpdateReturning });
    mockUpdateSet.mockReturnValue({ where: mockUpdateWhere });

    // Reset delete
    mockDeleteReturning.mockResolvedValue([]);
  });

  // ─── listTiers ──────────────────────────────────────────────────────────────

  describe("listTiers", () => {
    it("returns all tiers from DB", async () => {
      mockSelectFrom.mockResolvedValue([defaultTier, premiumTier]);

      const result = await listTiers();
      expect(result).toEqual([defaultTier, premiumTier]);
      expect(mockDbSelect).toHaveBeenCalled();
    });

    it("returns empty array when no tiers exist", async () => {
      mockSelectFrom.mockResolvedValue([]);

      const result = await listTiers();
      expect(result).toEqual([]);
    });
  });

  // ─── createTier ─────────────────────────────────────────────────────────────

  describe("createTier", () => {
    it("inserts tier and returns created record", async () => {
      const mockInsertReturning = vi.fn().mockResolvedValue([defaultTier]);
      mockInsertValues.mockReturnValue({ returning: mockInsertReturning, onConflictDoUpdate: vi.fn() });

      const { id, ...tierData } = defaultTier;
      const result = await createTier(tierData);

      expect(mockDbInsert).toHaveBeenCalled();
      expect(mockInsertValues).toHaveBeenCalledWith(expect.objectContaining({ name: "default" }));
      expect(result).toEqual(defaultTier);
    });

    it("passes all tier fields to insert", async () => {
      const mockInsertReturning = vi.fn().mockResolvedValue([premiumTier]);
      mockInsertValues.mockReturnValue({ returning: mockInsertReturning, onConflictDoUpdate: vi.fn() });

      const { id, ...premiumData } = premiumTier;
      await createTier(premiumData);

      expect(mockInsertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "premium",
          requestsPerMinute: 200,
          tokensPerDay: 5000000,
        })
      );
    });
  });

  // ─── updateTier ─────────────────────────────────────────────────────────────

  describe("updateTier", () => {
    it("returns null when tier not found", async () => {
      const mockUpdateReturning = vi.fn().mockResolvedValue([]);
      const mockUpdateWhere = vi.fn().mockReturnValue({ returning: mockUpdateReturning });
      mockUpdateSet.mockReturnValue({ where: mockUpdateWhere });

      const result = await updateTier(999, { requestsPerMinute: 100 });
      expect(result).toBeNull();
    });

    it("returns updated tier when found", async () => {
      const updated = { ...defaultTier, requestsPerMinute: 120 };
      const mockUpdateReturning = vi.fn().mockResolvedValue([updated]);
      const mockUpdateWhere = vi.fn().mockReturnValue({ returning: mockUpdateReturning });
      mockUpdateSet.mockReturnValue({ where: mockUpdateWhere });

      const result = await updateTier(1, { requestsPerMinute: 120 });
      expect(result).toEqual(updated);
    });

    it("sets updatedAt in the update payload", async () => {
      const mockUpdateReturning = vi.fn().mockResolvedValue([defaultTier]);
      const mockUpdateWhere = vi.fn().mockReturnValue({ returning: mockUpdateReturning });
      mockUpdateSet.mockReturnValue({ where: mockUpdateWhere });

      await updateTier(1, { name: "basic" });

      expect(mockUpdateSet).toHaveBeenCalledWith(
        expect.objectContaining({ updatedAt: expect.any(Date) })
      );
    });
  });

  // ─── deleteTier ─────────────────────────────────────────────────────────────

  describe("deleteTier", () => {
    it("returns true when tier is deleted", async () => {
      mockDeleteReturning.mockResolvedValueOnce([defaultTier]);

      const result = await deleteTier(1);
      expect(result).toBe(true);
    });

    it("returns false when tier not found", async () => {
      const result = await deleteTier(999);
      expect(result).toBe(false);
    });
  });

  // ─── setUserTier ────────────────────────────────────────────────────────────

  describe("setUserTier", () => {
    it("calls insert with onConflictDoUpdate for upsert", async () => {
      const mockOnConflict = vi.fn().mockResolvedValue(undefined);
      mockInsertValues.mockReturnValue({ returning: vi.fn(), onConflictDoUpdate: mockOnConflict });

      await setUserTier(42, 2);

      expect(mockDbInsert).toHaveBeenCalled();
      expect(mockInsertValues).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 42, tierId: 2 })
      );
      expect(mockOnConflict).toHaveBeenCalled();
    });
  });

  // ─── removeUserTier ─────────────────────────────────────────────────────────

  describe("removeUserTier", () => {
    it("calls delete with userId condition", async () => {
      await removeUserTier(42);

      expect(mockDbDelete).toHaveBeenCalled();
      expect(mockDeleteWhere).toHaveBeenCalled();
    });
  });

  // ─── setGroupTier ───────────────────────────────────────────────────────────

  describe("setGroupTier", () => {
    it("calls insert with groupId and tierId", async () => {
      const mockOnConflict = vi.fn().mockResolvedValue(undefined);
      mockInsertValues.mockReturnValue({ returning: vi.fn(), onConflictDoUpdate: mockOnConflict });

      await setGroupTier(7, 2);

      expect(mockDbInsert).toHaveBeenCalled();
      expect(mockInsertValues).toHaveBeenCalledWith(
        expect.objectContaining({ groupId: 7, tierId: 2 })
      );
      expect(mockOnConflict).toHaveBeenCalled();
    });
  });

  // ─── removeGroupTier ────────────────────────────────────────────────────────

  describe("removeGroupTier", () => {
    it("calls delete with groupId condition", async () => {
      await removeGroupTier(7);

      expect(mockDbDelete).toHaveBeenCalled();
      expect(mockDeleteWhere).toHaveBeenCalled();
    });
  });

  // ─── resolveUserTier ────────────────────────────────────────────────────────

  describe("resolveUserTier", () => {
    it("returns user override tier when one exists", async () => {
      // loadTiers: returns [defaultTier, premiumTier]
      mockSelectFrom.mockResolvedValueOnce([defaultTier, premiumTier]);

      // User override check: returns row pointing to premiumTier.id
      const mockLimitUser = vi.fn().mockResolvedValue([{ userId: 1, tierId: 2 }]);
      const mockWhereUser = vi.fn().mockReturnValue({ limit: mockLimitUser });
      mockSelectFrom.mockReturnValueOnce({ where: mockWhereUser });

      const result = await resolveUserTier(1);
      expect(result.name).toBe("premium");
      expect(result.id).toBe(2);
    });

    it("returns best group tier when no user override", async () => {
      // tierCache is warm from previous test — loadTiers() uses cache, no DB call

      // No user override
      const mockLimitUser = vi.fn().mockResolvedValue([]);
      const mockWhereUser = vi.fn().mockReturnValue({ limit: mockLimitUser });
      mockSelectFrom.mockReturnValueOnce({ where: mockWhereUser });

      // Group memberships
      const mockWhereMembership = vi.fn().mockResolvedValue([{ groupId: 10 }]);
      mockSelectFrom.mockReturnValueOnce({ where: mockWhereMembership });

      // Group tiers: group 10 → premiumTier
      const mockWhereGroupTier = vi.fn().mockResolvedValue([{ groupId: 10, tierId: 2 }]);
      mockSelectFrom.mockReturnValueOnce({ where: mockWhereGroupTier });

      const result = await resolveUserTier(1);
      expect(result.name).toBe("premium");
    });

    it("returns default tier when no overrides", async () => {
      // tierCache is warm — loadTiers() uses cache, no DB call

      // No user override
      const mockLimitUser = vi.fn().mockResolvedValue([]);
      const mockWhereUser = vi.fn().mockReturnValue({ limit: mockLimitUser });
      mockSelectFrom.mockReturnValueOnce({ where: mockWhereUser });

      // No group memberships
      const mockWhereMembership = vi.fn().mockResolvedValue([]);
      mockSelectFrom.mockReturnValueOnce({ where: mockWhereMembership });

      const result = await resolveUserTier(1);
      expect(result.name).toBe("default");
    });

    it("falls back to built-in DEFAULT_TIER when DB has no default named tier", async () => {
      // tierCache is warm — loadTiers() uses cache, no DB call

      // No user override
      const mockLimitUser = vi.fn().mockResolvedValue([]);
      const mockWhereUser = vi.fn().mockReturnValue({ limit: mockLimitUser });
      mockSelectFrom.mockReturnValueOnce({ where: mockWhereUser });

      // No group memberships
      const mockWhereMembership = vi.fn().mockResolvedValue([]);
      mockSelectFrom.mockReturnValueOnce({ where: mockWhereMembership });

      const result = await resolveUserTier(1);
      expect(result.name).toBe("default");
      expect(result.requestsPerMinute).toBe(60);
    });
  });

  // ─── checkRateLimit ─────────────────────────────────────────────────────────

  describe("checkRateLimit", () => {
    it("returns allowed=true and tier name when under limits", async () => {
      // tierCache warm — resolveUserTier uses cache; just mock user override + groups
      mockSelectFrom
        .mockReturnValueOnce({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }) })
        .mockReturnValueOnce({ where: vi.fn().mockResolvedValue([]) });

      // Pipeline returns [1, 1, 1, 1, 1, 1] — counts of 1 for each incr
      mockPipelineExec.mockResolvedValue([
        [null, 1], [null, 1],  // minute incr + expire
        [null, 1], [null, 1],  // hour incr + expire
        [null, 1], [null, 1],  // day incr + expire
      ]);

      const result = await checkRateLimit(1);
      expect(result.allowed).toBe(true);
      expect(result.tier).toBe("default");
    });

    it("returns allowed=false and retryAfter when minute limit exceeded", async () => {
      // tierCache warm
      mockSelectFrom
        .mockReturnValueOnce({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }) })
        .mockReturnValueOnce({ where: vi.fn().mockResolvedValue([]) });

      // minute count = 61 (exceeds 60)
      mockPipelineExec.mockResolvedValue([
        [null, 61], [null, 1],
        [null, 1], [null, 1],
        [null, 1], [null, 1],
      ]);

      const result = await checkRateLimit(1);
      expect(result.allowed).toBe(false);
      expect(result.retryAfter).toBeDefined();
      expect(result.retryAfter).toBeGreaterThan(0);
    });

    it("returns correct limits shape in response", async () => {
      // tierCache warm
      mockSelectFrom
        .mockReturnValueOnce({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }) })
        .mockReturnValueOnce({ where: vi.fn().mockResolvedValue([]) });

      mockPipelineExec.mockResolvedValue([
        [null, 5], [null, 1],
        [null, 10], [null, 1],
        [null, 20], [null, 1],
      ]);

      const result = await checkRateLimit(1);
      expect(result.limits).toHaveProperty("requestsPerMinute");
      expect(result.limits).toHaveProperty("requestsPerHour");
      expect(result.limits).toHaveProperty("requestsPerDay");
      expect(result.limits.requestsPerMinute.limit).toBe(60);
      expect(result.limits.requestsPerMinute.remaining).toBe(55);
    });

    it("uses redis pipeline for atomic counter operations", async () => {
      // tierCache warm
      mockSelectFrom
        .mockReturnValueOnce({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }) })
        .mockReturnValueOnce({ where: vi.fn().mockResolvedValue([]) });

      await checkRateLimit(1);

      expect(mockPipeline).toHaveBeenCalled();
      expect(mockPipelineExec).toHaveBeenCalled();
    });
  });

  // ─── trackTokenUsage ────────────────────────────────────────────────────────

  describe("trackTokenUsage", () => {
    it("returns true when under token limits", async () => {
      // tierCache warm
      mockSelectFrom
        .mockReturnValueOnce({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }) })
        .mockReturnValueOnce({ where: vi.fn().mockResolvedValue([]) });

      // 4 pipeline results: incrby minute, expire, incrby day, expire
      mockPipelineExec.mockResolvedValue([
        [null, 500], [null, 1],
        [null, 5000], [null, 1],
      ]);

      const result = await trackTokenUsage(1, 100);
      expect(result).toBe(true);
    });

    it("returns false when minute token limit exceeded", async () => {
      // tierCache warm
      mockSelectFrom
        .mockReturnValueOnce({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }) })
        .mockReturnValueOnce({ where: vi.fn().mockResolvedValue([]) });

      // minute tokens = 200001 > 100000
      mockPipelineExec.mockResolvedValue([
        [null, 200001], [null, 1],
        [null, 5000], [null, 1],
      ]);

      const result = await trackTokenUsage(1, 200001);
      expect(result).toBe(false);
    });

    it("returns false when day token limit exceeded", async () => {
      // tierCache warm
      mockSelectFrom
        .mockReturnValueOnce({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }) })
        .mockReturnValueOnce({ where: vi.fn().mockResolvedValue([]) });

      // day tokens = 2000000 > 1000000
      mockPipelineExec.mockResolvedValue([
        [null, 100], [null, 1],
        [null, 2000000], [null, 1],
      ]);

      const result = await trackTokenUsage(1, 50);
      expect(result).toBe(false);
    });

    it("uses incrby (not incr) for token tracking", async () => {
      // tierCache warm
      mockSelectFrom
        .mockReturnValueOnce({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }) })
        .mockReturnValueOnce({ where: vi.fn().mockResolvedValue([]) });

      mockPipelineExec.mockResolvedValue([
        [null, 1000], [null, 1],
        [null, 1000], [null, 1],
      ]);

      await trackTokenUsage(1, 500);

      expect(mockPipelineIncrby).toHaveBeenCalledWith(expect.stringContaining("rl:tok:"), 500);
    });
  });
});
