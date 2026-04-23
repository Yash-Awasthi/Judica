import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mock variables (available inside vi.mock factories) ─────────────
const {
  mockReturning,
  mockSet,
  mockOnConflictDoUpdate,
  mockValues,
  mockLeftJoin,
  mockGroupBy,
  mockOrderBy,
  mockChain,
  mockResult,
} = vi.hoisted(() => {
  const mockReturning = vi.fn();
  const mockSet = vi.fn();
  const mockOnConflictDoUpdate = vi.fn();
  const mockValues = vi.fn();
  const mockLeftJoin = vi.fn();
  const mockGroupBy = vi.fn();
  const mockOrderBy = vi.fn();

  // This holds the "current result" that the chain resolves to when awaited
  const mockResult = { value: [] as unknown[] };

  const mockChain: Record<string, any> = {
    select: vi.fn(),
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
    offset: vi.fn(),
    leftJoin: mockLeftJoin,
    groupBy: mockGroupBy,
    orderBy: mockOrderBy,
    insert: vi.fn(),
    values: mockValues,
    update: vi.fn(),
    set: mockSet,
    delete: vi.fn(),
    returning: mockReturning,
    onConflictDoUpdate: mockOnConflictDoUpdate,
    execute: vi.fn(),
    // Make the chain itself thenable so `await db.select().from().where().limit(1)` works
    then: vi.fn((resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
      return Promise.resolve(mockResult.value).then(resolve, reject);
    }),
  };

  return {
    mockReturning,
    mockSet,
    mockOnConflictDoUpdate,
    mockValues,
    mockLeftJoin,
    mockGroupBy,
    mockOrderBy,
    mockChain,
    mockResult,
  };
});

// ─── Schema mocks ────────────────────────────────────────────────────────────
vi.mock("../../src/db/schema/admin.js", () => ({
  adminAuditLogs: {},
  systemConfigs: { key: "key" },
  orgGroups: { id: "id" },
  orgGroupMemberships: { groupId: "groupId", userId: "userId" },
}));
vi.mock("../../src/db/schema/users.js", () => ({
  users: { id: "id", email: "email", username: "username", role: "role", isActive: "isActive", createdAt: "createdAt" },
  usageLogs: { promptTokens: "promptTokens", completionTokens: "completionTokens", createdAt: "createdAt", userId: "userId", provider: "provider" },
}));
vi.mock("../../src/db/schema/conversations.js", () => ({
  conversations: { id: "id", userId: "userId" },
  chats: { id: "id", conversationId: "conversationId" },
}));
vi.mock("../../src/db/schema/council.js", () => ({
  customProviders: { id: "id", authKey: "authKey" },
}));
vi.mock("../../src/db/schema/memory.js", () => ({
  memoryBackends: { id: "id", config: "config" },
}));

// ─── Logger mock ─────────────────────────────────────────────────────────────
vi.mock("../../src/lib/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ─── Crypto mock ─────────────────────────────────────────────────────────────
vi.mock("../../src/lib/crypto.js", () => ({
  encrypt: vi.fn((val: string) => `enc_${val}`),
  decrypt: vi.fn((val: string) => val.replace("enc_", "")),
}));

// ─── Drizzle mock ────────────────────────────────────────────────────────────
vi.mock("../../src/lib/drizzle.js", () => ({
  db: mockChain,
}));

// ─── drizzle-orm operators mock ──────────────────────────────────────────────
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: unknown[]) => ({ op: "eq", args })),
  sql: vi.fn((...args: unknown[]) => args),
  desc: vi.fn((col: unknown) => ({ op: "desc", col })),
  and: vi.fn((...args: unknown[]) => ({ op: "and", args })),
  gte: vi.fn((...args: unknown[]) => ({ op: "gte", args })),
  lte: vi.fn((...args: unknown[]) => ({ op: "lte", args })),
  or: vi.fn((...args: unknown[]) => ({ op: "or", args })),
  ilike: vi.fn((...args: unknown[]) => ({ op: "ilike", args })),
  inArray: vi.fn((...args: unknown[]) => ({ op: "inArray", args })),
}));

import { AdminService } from "../../src/services/admin.service.js";
import logger from "../../src/lib/logger.js";

describe("AdminService", () => {
  /** Helper: set the result that the mock chain resolves to when awaited */
  function setChainResult(val: unknown[]) {
    mockResult.value = val;
    mockChain.then.mockImplementation(
      (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
        Promise.resolve(val).then(resolve, reject)
    );
  }

  /** Helper: set a sequence of results for successive awaits of the chain */
  function setChainResults(...results: unknown[][]) {
    let callIdx = 0;
    mockChain.then.mockImplementation(
      (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
        const val = results[callIdx] ?? [];
        callIdx++;
        return Promise.resolve(val).then(resolve, reject);
      }
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    // Every chainable method returns the chain itself
    mockChain.select.mockReturnValue(mockChain);
    mockChain.from.mockReturnValue(mockChain);
    mockChain.where.mockReturnValue(mockChain);
    mockChain.limit.mockReturnValue(mockChain);
    mockChain.offset.mockReturnValue(mockChain);
    mockLeftJoin.mockReturnValue(mockChain);
    mockGroupBy.mockReturnValue(mockChain);
    mockOrderBy.mockReturnValue(mockChain);
    mockValues.mockReturnValue(mockChain);
    mockSet.mockReturnValue(mockChain);
    mockReturning.mockResolvedValue([{ id: 1, name: "test" }]);
    mockOnConflictDoUpdate.mockResolvedValue(undefined);
    mockChain.insert.mockReturnValue(mockChain);
    mockChain.update.mockReturnValue(mockChain);
    mockChain.delete.mockReturnValue(mockChain);
    // Default: awaiting the chain resolves to []
    setChainResult([]);
  });

  // ─── logAction ───────────────────────────────────────────────────────────
  describe("logAction", () => {
    it("should insert an audit log entry", async () => {
      mockValues.mockResolvedValue(undefined);
      await AdminService.logAction({
        adminId: 1,
        actionType: "test_action",
        resourceType: "test_resource",
      });
      expect(mockChain.insert).toHaveBeenCalled();
      expect(mockValues).toHaveBeenCalledWith(
        expect.objectContaining({
          adminId: 1,
          actionType: "test_action",
          resourceType: "test_resource",
          status: "success",
        }),
      );
    });

    it("should catch errors silently and log them", async () => {
      mockValues.mockRejectedValue(new Error("DB down"));
      await AdminService.logAction({
        adminId: 1,
        actionType: "test",
        resourceType: "test",
      });
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        expect.stringContaining("Failed to write admin audit log"),
      );
    });

    it("should use provided status and details", async () => {
      mockValues.mockResolvedValue(undefined);
      await AdminService.logAction({
        adminId: 5,
        actionType: "failed_op",
        resourceType: "config",
        status: "failure",
        details: { reason: "bad input" },
        errorMessage: "validation error",
      });
      expect(mockValues).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "failure",
          details: { reason: "bad input" },
          errorMessage: "validation error",
        }),
      );
    });
  });

  // ─── getSystemStats ──────────────────────────────────────────────────────
  describe("getSystemStats", () => {
    it("should return numeric counts", async () => {
      vi.clearAllMocks();

      let fromCallIdx = 0;
      const fromResults = [
        [{ value: 10 }],
        [{ value: 25 }],
        [{ value: 100 }],
        [{ totalPrompt: 500, totalCompletion: 300 }],
      ];

      mockChain.select.mockReturnValue(mockChain);
      mockChain.from.mockImplementation(() => {
        const idx = fromCallIdx++;
        const result = fromResults[idx] ?? [];
        const thenableChain = {
          ...mockChain,
          then: (res: (v: unknown) => void, _rej?: unknown) => {
            res(result);
            return Promise.resolve(result);
          },
          catch: () => Promise.resolve(result),
          [Symbol.toStringTag]: "Promise",
        };
        return thenableChain;
      });

      const stats = await AdminService.getSystemStats();
      expect(stats.totalUsers).toBe(10);
      expect(stats.totalConversations).toBe(25);
      expect(stats.totalMessages).toBe(100);
      expect(stats.totalTokens).toBe(800);
    });

    it("should handle NaN values from SQL gracefully", async () => {
      let fromCallIdx = 0;
      const fromResults = [
        [{ value: null }],
        [{ value: undefined }],
        [{ value: "NaN" }],
        [{ totalPrompt: null, totalCompletion: undefined }],
      ];

      mockChain.select.mockReturnValue(mockChain);
      mockChain.from.mockImplementation(() => {
        const idx = fromCallIdx++;
        const result = fromResults[idx] ?? [];
        return {
          ...mockChain,
          then: (res: (v: unknown) => void) => { res(result); return Promise.resolve(result); },
          catch: () => Promise.resolve(result),
          [Symbol.toStringTag]: "Promise",
        };
      });

      const stats = await AdminService.getSystemStats();
      expect(stats.totalUsers).toBe(0);
      expect(stats.totalConversations).toBe(0);
      expect(stats.totalMessages).toBe(0);
      expect(stats.totalTokens).toBe(0);
    });
  });

  // ─── getConfig ───────────────────────────────────────────────────────────
  describe("getConfig", () => {
    it("should return a key-value map from configs", async () => {
      setChainResult([
        { key: "site_name", value: "Test" },
        { key: "max_users", value: "100" },
      ]);

      const config = await AdminService.getConfig();
      expect(config.site_name).toBe("Test");
      expect(config.max_users).toBe("100");
    });

    it("should block __proto__ key (prototype pollution)", async () => {
      setChainResult([
        { key: "__proto__", value: "evil" },
        { key: "safe_key", value: "ok" },
      ]);

      const config = await AdminService.getConfig();
      expect(config.safe_key).toBe("ok");
      expect(config.__proto__).toBeUndefined();
      expect(Object.getPrototypeOf(config)).toBeNull();
    });

    it("should block constructor and prototype keys", async () => {
      setChainResult([
        { key: "constructor", value: "evil" },
        { key: "prototype", value: "evil" },
        { key: "normal", value: "fine" },
      ]);

      const config = await AdminService.getConfig();
      expect(config.constructor).toBeUndefined();
      expect(config.prototype).toBeUndefined();
      expect(config.normal).toBe("fine");
    });

    it("should return an object with null prototype", async () => {
      setChainResult([]);
      const config = await AdminService.getConfig();
      expect(Object.getPrototypeOf(config)).toBeNull();
    });
  });

  // ─── updateConfig ────────────────────────────────────────────────────────
  describe("updateConfig", () => {
    it("should upsert config and log the action", async () => {
      setChainResult([{ key: "k", value: "old_val" }]);
      mockOnConflictDoUpdate.mockResolvedValue(undefined);
      const logSpy = vi.spyOn(AdminService, "logAction").mockResolvedValue(undefined);

      await AdminService.updateConfig("k", "new_val", 1);
      expect(mockChain.insert).toHaveBeenCalled();
      expect(mockOnConflictDoUpdate).toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          adminId: 1,
          actionType: "config_update",
          resourceType: "system_config",
          resourceId: "k",
        }),
      );
      logSpy.mockRestore();
    });
  });

  // ─── deleteUser ──────────────────────────────────────────────────────────
  describe("deleteUser", () => {
    it("should throw if user not found", async () => {
      setChainResult([]);
      await expect(AdminService.deleteUser(999, 1)).rejects.toThrow("User not found");
    });

    it("should soft-delete with anonymization", async () => {
      setChainResult([{ id: 42, email: "real@email.com" }]);
      const logSpy = vi.spyOn(AdminService, "logAction").mockResolvedValue(undefined);

      await AdminService.deleteUser(42, 1);
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          isActive: false,
          email: "deleted_42@removed.local",
          username: "deleted_42",
          customInstructions: "",
        }),
      );
      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: "user_deleted",
          resourceId: "42",
          details: { email: "real@email.com" },
        }),
      );
      logSpy.mockRestore();
    });
  });

  // ─── updateUserRole ──────────────────────────────────────────────────────
  describe("updateUserRole", () => {
    it("should prevent self-demotion to user role", async () => {
      await expect(AdminService.updateUserRole(1, "user", 1)).rejects.toThrow("Cannot demote yourself");
    });

    it("should prevent self-demotion to moderator role", async () => {
      await expect(AdminService.updateUserRole(5, "moderator", 5)).rejects.toThrow("Cannot demote yourself");
    });

    it("should allow self-assignment of admin role", async () => {
      setChainResult([{ id: 1, role: "admin" }]);
      const logSpy = vi.spyOn(AdminService, "logAction").mockResolvedValue(undefined);
      await AdminService.updateUserRole(1, "admin", 1);
      expect(mockSet).toHaveBeenCalledWith({ role: "admin" });
      logSpy.mockRestore();
    });

    it("should allow self-assignment of owner role", async () => {
      setChainResult([{ id: 1, role: "admin" }]);
      const logSpy = vi.spyOn(AdminService, "logAction").mockResolvedValue(undefined);
      await AdminService.updateUserRole(1, "owner", 1);
      expect(mockSet).toHaveBeenCalledWith({ role: "owner" });
      logSpy.mockRestore();
    });

    it("should throw for invalid role", async () => {
      await expect(AdminService.updateUserRole(2, "superadmin", 1)).rejects.toThrow("Invalid role: superadmin");
    });

    it("should throw if user not found", async () => {
      setChainResult([]);
      await expect(AdminService.updateUserRole(999, "admin", 1)).rejects.toThrow("User not found");
    });

    it("should update role and log action", async () => {
      setChainResult([{ id: 2, role: "user" }]);
      const logSpy = vi.spyOn(AdminService, "logAction").mockResolvedValue(undefined);

      await AdminService.updateUserRole(2, "admin", 1);
      expect(mockSet).toHaveBeenCalledWith({ role: "admin" });
      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: "role_assigned",
          details: { oldRole: "user", newRole: "admin" },
        }),
      );
      logSpy.mockRestore();
    });
  });

  // ─── setUserStatus ───────────────────────────────────────────────────────
  describe("setUserStatus", () => {
    it("should throw if user not found", async () => {
      setChainResult([]);
      await expect(AdminService.setUserStatus(999, true, 1)).rejects.toThrow("User not found");
    });

    it("should activate a user and log action", async () => {
      setChainResult([{ id: 2, isActive: false }]);
      const logSpy = vi.spyOn(AdminService, "logAction").mockResolvedValue(undefined);

      await AdminService.setUserStatus(2, true, 1);
      expect(mockSet).toHaveBeenCalledWith({ isActive: true });
      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({ actionType: "user_activated" }),
      );
      logSpy.mockRestore();
    });

    it("should deactivate a user and log action", async () => {
      setChainResult([{ id: 2, isActive: true }]);
      const logSpy = vi.spyOn(AdminService, "logAction").mockResolvedValue(undefined);

      await AdminService.setUserStatus(2, false, 1);
      expect(mockSet).toHaveBeenCalledWith({ isActive: false });
      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({ actionType: "user_suspended" }),
      );
      logSpy.mockRestore();
    });
  });

  // ─── getUsers ────────────────────────────────────────────────────────────
  describe("getUsers", () => {
    it("should return users with pagination info", async () => {
      // First await: count query, second await: users query
      setChainResults(
        [{ count: 5 }],
        [{ id: 1, email: "a@b.c", username: "user1", role: "user", isActive: true, createdAt: new Date() }],
      );

      const result = await AdminService.getUsers({ limit: 10, offset: 0 });
      expect(result).toHaveProperty("users");
      expect(result).toHaveProperty("total");
      expect(result).toHaveProperty("page");
    });

    it("should escape LIKE wildcard characters in search", async () => {
      const { ilike } = await import("drizzle-orm");
      setChainResults([{ count: 1 }], []);

      await AdminService.getUsers({ search: "test%_user" });

      expect(ilike).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining("test\\%\\_user"),
      );
    });
  });

  // ─── getUserDetail ───────────────────────────────────────────────────────
  describe("getUserDetail", () => {
    it("should return null for missing user", async () => {
      setChainResult([]);
      const result = await AdminService.getUserDetail(999);
      expect(result).toBeNull();
    });

    it("should return user with stats", async () => {
      // First await: user lookup, second: stats, third: usage
      setChainResults(
        [{ id: 1, email: "a@b.c", username: "u" }],
        [{ conversationCount: 5, messageCount: 20 }],
        [{ totalTokens: 1000 }],
      );

      const result = await AdminService.getUserDetail(1);
      expect(result).not.toBeNull();
      expect(result!.id).toBe(1);
      expect(result!.stats).toBeDefined();
    });
  });

  // ─── createGroup ─────────────────────────────────────────────────────────
  describe("createGroup", () => {
    it("should insert a group and log the action", async () => {
      mockReturning.mockResolvedValue([{ id: 10, name: "Engineering" }]);
      const logSpy = vi.spyOn(AdminService, "logAction").mockResolvedValue(undefined);

      const group = await AdminService.createGroup("Engineering", "Eng team", 1);
      expect(group).toEqual({ id: 10, name: "Engineering" });
      expect(mockValues).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Engineering", description: "Eng team", createdBy: 1 }),
      );
      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: "group_created",
          resourceType: "group",
          resourceId: "10",
        }),
      );
      logSpy.mockRestore();
    });

    it("should handle undefined description", async () => {
      mockReturning.mockResolvedValue([{ id: 11, name: "NoDesc" }]);
      const logSpy = vi.spyOn(AdminService, "logAction").mockResolvedValue(undefined);

      const group = await AdminService.createGroup("NoDesc", undefined, 1);
      expect(group.name).toBe("NoDesc");
      expect(mockValues).toHaveBeenCalledWith(
        expect.objectContaining({ description: undefined }),
      );
      logSpy.mockRestore();
    });
  });

  // ─── getGroups ───────────────────────────────────────────────────────────
  describe("getGroups", () => {
    it("should return groups with member counts", async () => {
      mockGroupBy.mockResolvedValue([
        { id: 1, name: "Team A", description: null, createdAt: new Date(), memberCount: 3 },
        { id: 2, name: "Team B", description: "desc", createdAt: new Date(), memberCount: 0 },
      ]);

      const groups = await AdminService.getGroups();
      expect(groups).toHaveLength(2);
      expect(groups[0].memberCount).toBe(3);
    });
  });

  // ─── addMemberToGroup ────────────────────────────────────────────────────
  describe("addMemberToGroup", () => {
    it("should insert membership and log", async () => {
      mockValues.mockResolvedValue(undefined);
      const logSpy = vi.spyOn(AdminService, "logAction").mockResolvedValue(undefined);

      await AdminService.addMemberToGroup(10, 5, 1);
      expect(mockValues).toHaveBeenCalledWith({ groupId: 10, userId: 5 });
      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: "group_member_added",
          resourceId: "10",
          details: { userId: 5 },
        }),
      );
      logSpy.mockRestore();
    });
  });

  // ─── removeMemberFromGroup ───────────────────────────────────────────────
  describe("removeMemberFromGroup", () => {
    it("should delete membership and log", async () => {
      const logSpy = vi.spyOn(AdminService, "logAction").mockResolvedValue(undefined);

      await AdminService.removeMemberFromGroup(10, 5, 1);
      expect(mockChain.delete).toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: "group_member_removed",
          resourceId: "10",
          details: { userId: 5 },
        }),
      );
      logSpy.mockRestore();
    });
  });

  // ─── getUsageAnalytics ───────────────────────────────────────────────────
  describe("getUsageAnalytics", () => {
    it("should clamp days to minimum of 1", async () => {
      mockOrderBy.mockResolvedValue([]);
      const result = await AdminService.getUsageAnalytics(0);
      expect(result).toEqual([]);
    });

    it("should clamp days to maximum of 365", async () => {
      mockOrderBy.mockResolvedValue([]);
      const result = await AdminService.getUsageAnalytics(999);
      expect(result).toEqual([]);
    });

    it("should default to 7 days", async () => {
      mockOrderBy.mockResolvedValue([
        { date: "2026-04-16", promptTokens: 100, completionTokens: 50, count: 10 },
      ]);
      const result = await AdminService.getUsageAnalytics();
      expect(result).toHaveLength(1);
      expect(result[0].date).toBe("2026-04-16");
    });
  });

  // ─── getAuditLogs ────────────────────────────────────────────────────────
  describe("getAuditLogs", () => {
    it("should return logs with pagination", async () => {
      setChainResults(
        [{ count: 100 }],
        [{ id: 1, actionType: "test" }],
      );

      const result = await AdminService.getAuditLogs({ limit: 10, offset: 0 });
      expect(result).toHaveProperty("logs");
      expect(result).toHaveProperty("total");
      expect(result).toHaveProperty("page");
    });
  });
});
