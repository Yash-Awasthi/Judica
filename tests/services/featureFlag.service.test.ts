const { mockRedisGet, mockRedisSet, mockRedisDel } = vi.hoisted(() => ({
  mockRedisGet: vi.fn().mockResolvedValue(null),
  mockRedisSet: vi.fn().mockResolvedValue("OK"),
  mockRedisDel: vi.fn().mockResolvedValue(1),
}));

vi.mock("../../src/lib/redis.js", () => ({
  default: { get: mockRedisGet, set: mockRedisSet, del: mockRedisDel },
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

vi.mock("../../src/db/schema/featureFlags.js", () => ({
  featureFlags: {
    id: "id",
    key: "key",
    name: "name",
    enabled: "enabled",
    rolloutPercent: "rolloutPercent",
    environment: "environment",
  },
  featureFlagUserOverrides: {
    flagId: "flagId",
    userId: "userId",
    enabled: "enabled",
    variant: "variant",
  },
  featureFlagGroupOverrides: {
    flagId: "flagId",
    groupId: "groupId",
    enabled: "enabled",
  },
}));

vi.mock("../../src/db/schema/userGroups.js", () => ({
  userGroupMembers: {
    userId: "userId",
    groupId: "groupId",
  },
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

  const mockInsertReturning = vi.fn().mockResolvedValue([{ id: 1, key: "test-flag" }]);
  const mockOnConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
  const mockInsertValues = vi.fn().mockReturnValue({
    returning: mockInsertReturning,
    onConflictDoUpdate: mockOnConflictDoUpdate,
  });
  const mockDbInsert = vi.fn().mockReturnValue({ values: mockInsertValues });

  const mockUpdateReturning = vi.fn().mockResolvedValue([]);
  const mockUpdateWhere = vi.fn().mockReturnValue({ returning: mockUpdateReturning });
  const mockUpdateSet = vi.fn().mockReturnValue({ where: mockUpdateWhere });
  const mockDbUpdate = vi.fn().mockReturnValue({ set: mockUpdateSet });

  // Select chain: .select().from(table).where(...).limit(n) or just await
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
  evaluateFlag,
  evaluateAllFlags,
  listFlags,
  createFlag,
  updateFlag,
  deleteFlag,
  setUserOverride,
  removeUserOverride,
  setGroupOverride,
  removeGroupOverride,
} from "../../src/services/featureFlag.service.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const baseFlag = {
  id: 10,
  key: "my-flag",
  name: "My Flag",
  description: null,
  enabled: true,
  rolloutPercent: 100,
  flagType: "boolean" as const,
  variants: null,
  environment: "all",
};

describe("FeatureFlag Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Reset Redis to cache miss by default
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue("OK");
    mockRedisDel.mockResolvedValue(1);

    // Reset select chain defaults
    const mockSelectLimit = vi.fn().mockResolvedValue([]);
    const mockSelectWhere = vi.fn().mockReturnValue({ limit: mockSelectLimit });
    mockSelectFrom.mockReturnValue({ where: mockSelectWhere });
    mockDbSelect.mockReturnValue({ from: mockSelectFrom });

    // Reset insert defaults
    const mockInsertReturning = vi.fn().mockResolvedValue([{ id: 1, key: "test-flag" }]);
    const mockOnConflict = vi.fn().mockResolvedValue(undefined);
    mockInsertValues.mockReturnValue({
      returning: mockInsertReturning,
      onConflictDoUpdate: mockOnConflict,
    });

    // Reset update defaults
    const mockUpdateReturning = vi.fn().mockResolvedValue([]);
    const mockUpdateWhere = vi.fn().mockReturnValue({ returning: mockUpdateReturning });
    mockUpdateSet.mockReturnValue({ where: mockUpdateWhere });

    // Reset delete defaults
    mockDeleteReturning.mockResolvedValue([]);
  });

  // ─── listFlags ─────────────────────────────────────────────────────────────

  describe("listFlags", () => {
    it("selects from featureFlags table and returns array", async () => {
      const flags = [baseFlag, { ...baseFlag, id: 11, key: "other-flag" }];
      // listFlags does db.select().from(featureFlags) — resolves directly (no where)
      mockSelectFrom.mockResolvedValue(flags);

      const result = await listFlags();

      expect(mockDbSelect).toHaveBeenCalled();
      expect(mockSelectFrom).toHaveBeenCalled();
      expect(result).toEqual(flags);
    });

    it("returns empty array when no flags exist", async () => {
      mockSelectFrom.mockResolvedValue([]);

      const result = await listFlags();
      expect(result).toEqual([]);
    });
  });

  // ─── createFlag ────────────────────────────────────────────────────────────

  describe("createFlag", () => {
    it("inserts flag and returns created record", async () => {
      const newFlag = { ...baseFlag };
      delete (newFlag as any).id;

      const mockReturning = vi.fn().mockResolvedValue([baseFlag]);
      mockInsertValues.mockReturnValue({ returning: mockReturning, onConflictDoUpdate: vi.fn() });

      const result = await createFlag(newFlag as any);

      expect(mockDbInsert).toHaveBeenCalled();
      expect(mockInsertValues).toHaveBeenCalledWith(expect.objectContaining({ key: "my-flag" }));
      expect(result).toEqual(baseFlag);
    });

    it("passes all flag fields to insert", async () => {
      const flagData = {
        key: "beta-feature",
        name: "Beta Feature",
        description: "A beta feature",
        enabled: false,
        rolloutPercent: 25,
        flagType: "percentage" as const,
        variants: null,
        environment: "production",
      };

      const mockReturning = vi.fn().mockResolvedValue([{ id: 99, ...flagData }]);
      mockInsertValues.mockReturnValue({ returning: mockReturning, onConflictDoUpdate: vi.fn() });

      await createFlag(flagData);

      expect(mockInsertValues).toHaveBeenCalledWith(expect.objectContaining({
        key: "beta-feature",
        enabled: false,
        rolloutPercent: 25,
        environment: "production",
      }));
    });
  });

  // ─── updateFlag ────────────────────────────────────────────────────────────

  describe("updateFlag", () => {
    it("returns null when flag not found", async () => {
      const mockUpdateReturning = vi.fn().mockResolvedValue([]);
      const mockUpdateWhere = vi.fn().mockReturnValue({ returning: mockUpdateReturning });
      mockUpdateSet.mockReturnValue({ where: mockUpdateWhere });

      const result = await updateFlag(999, { enabled: false });
      expect(result).toBeNull();
    });

    it("returns updated flag when found", async () => {
      const updatedFlag = { ...baseFlag, enabled: false };
      const mockUpdateReturning = vi.fn().mockResolvedValue([updatedFlag]);
      const mockUpdateWhere = vi.fn().mockReturnValue({ returning: mockUpdateReturning });
      mockUpdateSet.mockReturnValue({ where: mockUpdateWhere });

      const result = await updateFlag(10, { enabled: false });
      expect(result).toEqual(updatedFlag);
    });

    it("invalidates Redis cache on update", async () => {
      const updatedFlag = { ...baseFlag, enabled: false };
      const mockUpdateReturning = vi.fn().mockResolvedValue([updatedFlag]);
      const mockUpdateWhere = vi.fn().mockReturnValue({ returning: mockUpdateReturning });
      mockUpdateSet.mockReturnValue({ where: mockUpdateWhere });

      await updateFlag(10, { enabled: false });

      expect(mockRedisDel).toHaveBeenCalledWith(`ff:${baseFlag.key}`);
    });

    it("does not call redis.del when flag not found", async () => {
      const mockUpdateReturning = vi.fn().mockResolvedValue([]);
      const mockUpdateWhere = vi.fn().mockReturnValue({ returning: mockUpdateReturning });
      mockUpdateSet.mockReturnValue({ where: mockUpdateWhere });

      await updateFlag(999, { enabled: false });
      expect(mockRedisDel).not.toHaveBeenCalled();
    });

    it("sets updatedAt on update", async () => {
      const mockUpdateReturning = vi.fn().mockResolvedValue([baseFlag]);
      const mockUpdateWhere = vi.fn().mockReturnValue({ returning: mockUpdateReturning });
      mockUpdateSet.mockReturnValue({ where: mockUpdateWhere });

      await updateFlag(10, { enabled: true });

      expect(mockUpdateSet).toHaveBeenCalledWith(
        expect.objectContaining({ updatedAt: expect.any(Date) })
      );
    });
  });

  // ─── deleteFlag ────────────────────────────────────────────────────────────

  describe("deleteFlag", () => {
    it("returns true when flag is deleted", async () => {
      mockDeleteReturning.mockResolvedValueOnce([baseFlag]);

      const result = await deleteFlag(10);
      expect(result).toBe(true);
    });

    it("returns false when flag not found", async () => {
      const result = await deleteFlag(999);
      expect(result).toBe(false);
    });

    it("invalidates Redis cache on delete", async () => {
      mockDeleteReturning.mockResolvedValueOnce([baseFlag]);

      await deleteFlag(10);
      expect(mockRedisDel).toHaveBeenCalledWith(`ff:${baseFlag.key}`);
    });

    it("does not call redis.del when flag not found", async () => {
      await deleteFlag(999);
      expect(mockRedisDel).not.toHaveBeenCalled();
    });
  });

  // ─── setUserOverride ───────────────────────────────────────────────────────

  describe("setUserOverride", () => {
    it("calls insert with onConflictDoUpdate for upsert", async () => {
      const mockOnConflict = vi.fn().mockResolvedValue(undefined);
      mockInsertValues.mockReturnValue({
        returning: vi.fn().mockResolvedValue([]),
        onConflictDoUpdate: mockOnConflict,
      });

      await setUserOverride(10, 5, true, "variant-a");

      expect(mockDbInsert).toHaveBeenCalled();
      expect(mockInsertValues).toHaveBeenCalledWith(
        expect.objectContaining({ flagId: 10, userId: 5, enabled: true, variant: "variant-a" })
      );
      expect(mockOnConflict).toHaveBeenCalled();
    });

    it("works without variant", async () => {
      const mockOnConflict = vi.fn().mockResolvedValue(undefined);
      mockInsertValues.mockReturnValue({
        returning: vi.fn().mockResolvedValue([]),
        onConflictDoUpdate: mockOnConflict,
      });

      await setUserOverride(10, 5, false);

      expect(mockInsertValues).toHaveBeenCalledWith(
        expect.objectContaining({ flagId: 10, userId: 5, enabled: false })
      );
    });
  });

  // ─── removeUserOverride ────────────────────────────────────────────────────

  describe("removeUserOverride", () => {
    it("calls delete with flagId and userId condition", async () => {
      await removeUserOverride(10, 5);

      expect(mockDbDelete).toHaveBeenCalled();
      expect(mockDeleteWhere).toHaveBeenCalled();
    });
  });

  // ─── setGroupOverride ──────────────────────────────────────────────────────

  describe("setGroupOverride", () => {
    it("calls insert with onConflictDoUpdate for upsert", async () => {
      const mockOnConflict = vi.fn().mockResolvedValue(undefined);
      mockInsertValues.mockReturnValue({
        returning: vi.fn().mockResolvedValue([]),
        onConflictDoUpdate: mockOnConflict,
      });

      await setGroupOverride(10, 99, true);

      expect(mockDbInsert).toHaveBeenCalled();
      expect(mockInsertValues).toHaveBeenCalledWith(
        expect.objectContaining({ flagId: 10, groupId: 99, enabled: true })
      );
      expect(mockOnConflict).toHaveBeenCalled();
    });
  });

  // ─── removeGroupOverride ───────────────────────────────────────────────────

  describe("removeGroupOverride", () => {
    it("calls delete with flagId and groupId condition", async () => {
      await removeGroupOverride(10, 99);

      expect(mockDbDelete).toHaveBeenCalled();
      expect(mockDeleteWhere).toHaveBeenCalled();
    });
  });

  // ─── evaluateFlag ──────────────────────────────────────────────────────────

  describe("evaluateFlag", () => {
    it("returns cached value when Redis hits with a serialized flag", async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify(baseFlag));

      // No userId — should go straight to global enabled
      const result = await evaluateFlag("my-flag");

      // Should NOT query DB since we had a cache hit
      expect(mockDbSelect).not.toHaveBeenCalled();
      expect(result.key).toBe("my-flag");
      expect(result.enabled).toBe(true);
      expect(result.source).toBe("global");
    });

    it("returns default when Redis has negative cache sentinel __null__", async () => {
      mockRedisGet.mockResolvedValue("__null__");

      const result = await evaluateFlag("nonexistent-flag");
      expect(result.enabled).toBe(false);
      expect(result.source).toBe("default");
    });

    it("fetches from DB and caches when Redis misses", async () => {
      mockRedisGet.mockResolvedValue(null);

      // First DB call: fetch flag by key
      const mockLimit = vi.fn().mockResolvedValue([baseFlag]);
      const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit });
      mockSelectFrom.mockReturnValueOnce({ where: mockWhere });

      // Second DB call (user override): no override
      const mockLimit2 = vi.fn().mockResolvedValue([]);
      const mockWhere2 = vi.fn().mockReturnValue({ limit: mockLimit2 });
      mockSelectFrom.mockReturnValueOnce({ where: mockWhere2 });

      // Third DB call (group memberships)
      const mockWhere3 = vi.fn().mockResolvedValue([]);
      mockSelectFrom.mockReturnValueOnce({ where: mockWhere3 });

      const result = await evaluateFlag("my-flag", 1);

      expect(mockRedisSet).toHaveBeenCalledWith(
        "ff:my-flag",
        expect.any(String),
        expect.objectContaining({ EX: 60 })
      );
      expect(result.key).toBe("my-flag");
    });

    it("returns default source when flag does not exist in DB", async () => {
      mockRedisGet.mockResolvedValue(null);

      const mockLimit = vi.fn().mockResolvedValue([]);
      const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit });
      mockSelectFrom.mockReturnValueOnce({ where: mockWhere });

      const result = await evaluateFlag("nonexistent");
      expect(result.enabled).toBe(false);
      expect(result.source).toBe("default");
    });

    it("returns disabled global when flag.enabled is false", async () => {
      const disabledFlag = { ...baseFlag, enabled: false };
      mockRedisGet.mockResolvedValue(JSON.stringify(disabledFlag));

      const result = await evaluateFlag("my-flag");
      expect(result.enabled).toBe(false);
      expect(result.source).toBe("global");
    });

    it("returns default when environment does not match", async () => {
      const prodFlag = { ...baseFlag, environment: "production" };
      mockRedisGet.mockResolvedValue(JSON.stringify(prodFlag));

      // NODE_ENV defaults to 'test' in vitest
      const result = await evaluateFlag("my-flag");
      expect(result.enabled).toBe(false);
      expect(result.source).toBe("default");
    });

    it("returns user_override when user override exists and is enabled", async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify(baseFlag));

      const userOverride = { flagId: 10, userId: 1, enabled: true, variant: "beta" };
      const mockLimit = vi.fn().mockResolvedValue([userOverride]);
      const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit });
      mockSelectFrom.mockReturnValueOnce({ where: mockWhere });

      const result = await evaluateFlag("my-flag", 1);
      expect(result.enabled).toBe(true);
      expect(result.source).toBe("user_override");
      expect(result.variant).toBe("beta");
    });

    it("returns user_override disabled when override is false", async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify(baseFlag));

      const userOverride = { flagId: 10, userId: 1, enabled: false, variant: null };
      const mockLimit = vi.fn().mockResolvedValue([userOverride]);
      const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit });
      mockSelectFrom.mockReturnValueOnce({ where: mockWhere });

      const result = await evaluateFlag("my-flag", 1);
      expect(result.enabled).toBe(false);
      expect(result.source).toBe("user_override");
    });

    it("returns group_override enabled when any group enables flag", async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify(baseFlag));

      // No user override
      const mockLimitUser = vi.fn().mockResolvedValue([]);
      const mockWhereUser = vi.fn().mockReturnValue({ limit: mockLimitUser });
      mockSelectFrom.mockReturnValueOnce({ where: mockWhereUser });

      // Group memberships
      const mockWhereMembership = vi.fn().mockResolvedValue([{ groupId: 5 }, { groupId: 6 }]);
      mockSelectFrom.mockReturnValueOnce({ where: mockWhereMembership });

      // Group overrides: group 5 enables it
      const mockWhereGroup = vi.fn().mockResolvedValue([{ flagId: 10, groupId: 5, enabled: true }]);
      mockSelectFrom.mockReturnValueOnce({ where: mockWhereGroup });

      const result = await evaluateFlag("my-flag", 1);
      expect(result.enabled).toBe(true);
      expect(result.source).toBe("group_override");
    });

    it("returns group_override disabled when groups all disable flag", async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify(baseFlag));

      // No user override
      const mockLimitUser = vi.fn().mockResolvedValue([]);
      const mockWhereUser = vi.fn().mockReturnValue({ limit: mockLimitUser });
      mockSelectFrom.mockReturnValueOnce({ where: mockWhereUser });

      // Group memberships
      const mockWhereMembership = vi.fn().mockResolvedValue([{ groupId: 5 }]);
      mockSelectFrom.mockReturnValueOnce({ where: mockWhereMembership });

      // Group overrides all disabled
      const mockWhereGroup = vi.fn().mockResolvedValue([{ flagId: 10, groupId: 5, enabled: false }]);
      mockSelectFrom.mockReturnValueOnce({ where: mockWhereGroup });

      const result = await evaluateFlag("my-flag", 1);
      expect(result.enabled).toBe(false);
      expect(result.source).toBe("group_override");
    });

    it("returns rollout source when rolloutPercent < 100 and no overrides", async () => {
      const rolloutFlag = { ...baseFlag, rolloutPercent: 50 };
      mockRedisGet.mockResolvedValue(JSON.stringify(rolloutFlag));

      // No user override
      const mockLimitUser = vi.fn().mockResolvedValue([]);
      const mockWhereUser = vi.fn().mockReturnValue({ limit: mockLimitUser });
      mockSelectFrom.mockReturnValueOnce({ where: mockWhereUser });

      // No group memberships
      const mockWhereMembership = vi.fn().mockResolvedValue([]);
      mockSelectFrom.mockReturnValueOnce({ where: mockWhereMembership });

      const result = await evaluateFlag("my-flag", 42);
      expect(result.source).toBe("rollout");
    });

    it("returns global when no userId provided and flag is enabled", async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify(baseFlag));

      const result = await evaluateFlag("my-flag");
      expect(result.enabled).toBe(true);
      expect(result.source).toBe("global");
    });
  });

  // ─── evaluateAllFlags ──────────────────────────────────────────────────────

  describe("evaluateAllFlags", () => {
    it("evaluates all flags and returns record keyed by flag.key", async () => {
      const flagA = { ...baseFlag, id: 1, key: "flag-a" };
      const flagB = { ...baseFlag, id: 2, key: "flag-b", enabled: false };

      // evaluateAllFlags calls db.select().from(featureFlags) first
      mockSelectFrom.mockResolvedValueOnce([flagA, flagB]);

      // For each flag, evaluateFlag is called — both cache-miss so need DB + Redis
      // flag-a: Redis miss -> DB fetch
      mockRedisGet.mockResolvedValueOnce(null).mockResolvedValueOnce(null);

      // DB fetches for individual flag evaluation (via evaluateFlag)
      const mockLimitA = vi.fn().mockResolvedValue([flagA]);
      const mockWhereA = vi.fn().mockReturnValue({ limit: mockLimitA });
      mockSelectFrom.mockReturnValueOnce({ where: mockWhereA });

      const mockLimitB = vi.fn().mockResolvedValue([flagB]);
      const mockWhereB = vi.fn().mockReturnValue({ limit: mockLimitB });
      mockSelectFrom.mockReturnValueOnce({ where: mockWhereB });

      const result = await evaluateAllFlags();

      expect(result).toHaveProperty("flag-a");
      expect(result).toHaveProperty("flag-b");
    });
  });
});
