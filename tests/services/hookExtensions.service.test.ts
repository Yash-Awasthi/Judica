import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mock variables ─────────────────────────────────────────────────
const {
  mockReturning,
  mockSet,
  mockValues,
  mockChain,
  mockResult,
} = vi.hoisted(() => {
  const mockReturning = vi.fn();
  const mockSet = vi.fn();
  const mockValues = vi.fn();

  const mockResult = { value: [] as unknown[] };

  const mockChain: Record<string, any> = {
    select: vi.fn(),
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
    offset: vi.fn(),
    orderBy: vi.fn(),
    insert: vi.fn(),
    values: mockValues,
    update: vi.fn(),
    set: mockSet,
    delete: vi.fn(),
    returning: mockReturning,
    then: vi.fn((resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
      return Promise.resolve(mockResult.value).then(resolve, reject);
    }),
  };

  return { mockReturning, mockSet, mockValues, mockChain, mockResult };
});

// ─── Schema mocks ───────────────────────────────────────────────────────────
vi.mock("../../src/db/schema/hookExtensions.js", () => ({
  hookExtensions: {
    id: "id",
    userId: "userId",
    name: "name",
    hookPoint: "hookPoint",
    executionOrder: "executionOrder",
    isActive: "isActive",
    code: "code",
    language: "language",
    config: "config",
    timeout: "timeout",
  },
  hookExecutionLogs: {
    id: "id",
    hookId: "hookId",
    conversationId: "conversationId",
    executionTimeMs: "executionTimeMs",
    status: "status",
    createdAt: "createdAt",
  },
  HOOK_POINTS: [
    "pre_indexing", "post_indexing", "pre_query", "post_query",
    "pre_response", "post_response", "pre_council", "post_council",
  ],
}));

vi.mock("../../src/db/schema/users.js", () => ({
  users: { id: "id" },
}));

// ─── Logger mock ────────────────────────────────────────────────────────────
vi.mock("../../src/lib/logger.js", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    })),
  },
}));

// ─── Drizzle mock ───────────────────────────────────────────────────────────
vi.mock("../../src/lib/drizzle.js", () => ({
  db: mockChain,
}));

// ─── drizzle-orm operators mock ─────────────────────────────────────────────
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: unknown[]) => ({ op: "eq", args })),
  and: vi.fn((...args: unknown[]) => ({ op: "and", args })),
  asc: vi.fn((col: unknown) => ({ op: "asc", col })),
  desc: vi.fn((col: unknown) => ({ op: "desc", col })),
  inArray: vi.fn((...args: unknown[]) => ({ op: "inArray", args })),
}));

// ─── Built-in hooks mock ───────────────────────────────────────────────────
vi.mock("../../src/services/builtInHooks.js", () => ({
  builtInHooks: [
    {
      type: "PII_SCRUBBER",
      name: "PII Scrubber",
      description: "Regex-based PII detection",
      hookPoint: "pre_indexing",
      language: "javascript",
      code: "function handler(ctx) { return { content: ctx.content, metadata: {} }; }",
      defaultConfig: {},
      timeout: 5000,
    },
  ],
  getBuiltInHookByType: vi.fn(),
}));

import {
  createHook,
  getHooks,
  updateHook,
  deleteHook,
  toggleHook,
  executeHook,
  getHookLogs,
  getBuiltInHooks,
  validateHookCode,
  reorderHooks,
} from "../../src/services/hookExtensions.service.js";

describe("hookExtensions.service", () => {
  function setChainResult(val: unknown[]) {
    mockResult.value = val;
    mockChain.then.mockImplementation(
      (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
        Promise.resolve(val).then(resolve, reject),
    );
  }

  function setChainResults(...results: unknown[][]) {
    let callIdx = 0;
    mockChain.then.mockImplementation(
      (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
        const val = results[callIdx] ?? [];
        callIdx++;
        return Promise.resolve(val).then(resolve, reject);
      },
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockChain.select.mockReturnValue(mockChain);
    mockChain.from.mockReturnValue(mockChain);
    mockChain.where.mockReturnValue(mockChain);
    mockChain.limit.mockReturnValue(mockChain);
    mockChain.offset.mockReturnValue(mockChain);
    mockChain.orderBy.mockReturnValue(mockChain);
    mockValues.mockReturnValue(mockChain);
    mockSet.mockReturnValue(mockChain);
    mockReturning.mockResolvedValue([{ id: 1, name: "test hook" }]);
    mockChain.insert.mockReturnValue(mockChain);
    mockChain.update.mockReturnValue(mockChain);
    mockChain.delete.mockReturnValue(mockChain);
    setChainResult([]);
  });

  // ─── createHook ─────────────────────────────────────────────────────────
  describe("createHook", () => {
    it("should insert a hook and return it", async () => {
      const mockHook = {
        id: 1,
        userId: 42,
        name: "Test Hook",
        hookPoint: "pre_indexing",
        code: 'function handler(ctx) { return { content: ctx.content, metadata: {} }; }',
        language: "javascript",
        isActive: true,
        executionOrder: 0,
        timeout: 5000,
      };
      mockReturning.mockResolvedValue([mockHook]);

      const result = await createHook(42, {
        name: "Test Hook",
        hookPoint: "pre_indexing",
        code: 'function handler(ctx) { return { content: ctx.content, metadata: {} }; }',
      });

      expect(mockChain.insert).toHaveBeenCalled();
      expect(mockValues).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 42,
          name: "Test Hook",
          hookPoint: "pre_indexing",
        }),
      );
      expect(result).toEqual(mockHook);
    });
  });

  // ─── getHooks ───────────────────────────────────────────────────────────
  describe("getHooks", () => {
    it("should return hooks for a user", async () => {
      const hooks = [
        { id: 1, name: "Hook 1", hookPoint: "pre_indexing" },
        { id: 2, name: "Hook 2", hookPoint: "pre_query" },
      ];
      setChainResult(hooks);

      const result = await getHooks(42);
      expect(mockChain.select).toHaveBeenCalled();
      expect(result).toEqual(hooks);
    });

    it("should filter by hookPoint when provided", async () => {
      setChainResult([{ id: 1, name: "Hook 1", hookPoint: "pre_indexing" }]);

      const result = await getHooks(42, "pre_indexing");
      expect(mockChain.where).toHaveBeenCalled();
      expect(result).toHaveLength(1);
    });
  });

  // ─── updateHook ─────────────────────────────────────────────────────────
  describe("updateHook", () => {
    it("should update and return the hook", async () => {
      const updated = { id: 1, name: "Updated Hook", hookPoint: "pre_query" };
      mockReturning.mockResolvedValue([updated]);

      const result = await updateHook(1, 42, { name: "Updated Hook" });
      expect(mockChain.update).toHaveBeenCalled();
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Updated Hook" }),
      );
      expect(result).toEqual(updated);
    });

    it("should return null when hook not found", async () => {
      mockReturning.mockResolvedValue([]);

      const result = await updateHook(999, 42, { name: "Nope" });
      expect(result).toBeNull();
    });
  });

  // ─── deleteHook ─────────────────────────────────────────────────────────
  describe("deleteHook", () => {
    it("should delete and return true", async () => {
      mockReturning.mockResolvedValue([{ id: 1 }]);

      const result = await deleteHook(1, 42);
      expect(mockChain.delete).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it("should return false when hook not found", async () => {
      mockReturning.mockResolvedValue([]);

      const result = await deleteHook(999, 42);
      expect(result).toBe(false);
    });
  });

  // ─── toggleHook ─────────────────────────────────────────────────────────
  describe("toggleHook", () => {
    it("should toggle isActive and return updated hook", async () => {
      const toggled = { id: 1, isActive: false };
      mockReturning.mockResolvedValue([toggled]);

      const result = await toggleHook(1, 42, false);
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({ isActive: false }),
      );
      expect(result).toEqual(toggled);
    });
  });

  // ─── executeHook ────────────────────────────────────────────────────────
  describe("executeHook", () => {
    it("should execute hook code in sandbox and return result", async () => {
      const hook = {
        id: 1,
        userId: 42,
        name: "Passthrough",
        hookPoint: "pre_indexing",
        code: 'function handler(ctx) { return { content: ctx.content + " processed", metadata: { done: true } }; }',
        language: "javascript",
        isActive: true,
        timeout: 5000,
        config: {},
      };
      // getHookById returns the hook
      setChainResult([hook]);

      const result = await executeHook(1, {
        content: "hello",
        config: {},
      });

      expect(result.content).toBe("hello processed");
      expect(result.metadata).toEqual({ done: true });
    });

    it("should throw when hook not found", async () => {
      setChainResult([]);
      await expect(executeHook(999, { content: "test", config: {} }))
        .rejects.toThrow("Hook 999 not found");
    });
  });

  // ─── getHookLogs ────────────────────────────────────────────────────────
  describe("getHookLogs", () => {
    it("should return logs and total count", async () => {
      const logs = [{ id: 1, hookId: 1, status: "success" }];
      setChainResults(logs, logs);

      const result = await getHookLogs(1, { limit: 10, offset: 0 });
      expect(result.logs).toEqual(logs);
      expect(result.total).toBe(1);
    });
  });

  // ─── getBuiltInHooks ───────────────────────────────────────────────────
  describe("getBuiltInHooks", () => {
    it("should return built-in hook templates", () => {
      const templates = getBuiltInHooks();
      expect(templates).toHaveLength(1);
      expect(templates[0].type).toBe("PII_SCRUBBER");
    });
  });

  // ─── validateHookCode ─────────────────────────────────────────────────
  describe("validateHookCode", () => {
    it("should accept valid hook code", () => {
      const code = 'function handler(ctx) { return { content: ctx.content, metadata: {} }; }';
      const result = validateHookCode(code, "javascript");
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should reject code without handler function", () => {
      const code = 'function doStuff(ctx) { return ctx; }';
      const result = validateHookCode(code, "javascript");
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        "Code must define a 'handler' function: function handler(context) { ... }",
      );
    });

    it("should reject code with require()", () => {
      const code = 'const fs = require("fs"); function handler(ctx) { return ctx; }';
      const result = validateHookCode(code, "javascript");
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("require()"))).toBe(true);
    });

    it("should reject code with import statements", () => {
      const code = 'import fs from "fs"; function handler(ctx) { return ctx; }';
      const result = validateHookCode(code, "javascript");
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("import"))).toBe(true);
    });

    it("should reject code with process access", () => {
      const code = 'function handler(ctx) { process.exit(1); return ctx; }';
      const result = validateHookCode(code, "javascript");
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("process"))).toBe(true);
    });

    it("should reject code with syntax errors", () => {
      const code = 'function handler(ctx { return ctx; }';
      const result = validateHookCode(code, "javascript");
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("Syntax error"))).toBe(true);
    });
  });

  // ─── reorderHooks ─────────────────────────────────────────────────────
  describe("reorderHooks", () => {
    it("should update execution order for each hook", async () => {
      mockReturning
        .mockResolvedValueOnce([{ id: 3, executionOrder: 0 }])
        .mockResolvedValueOnce([{ id: 1, executionOrder: 1 }])
        .mockResolvedValueOnce([{ id: 2, executionOrder: 2 }]);

      const result = await reorderHooks(42, "pre_indexing", [3, 1, 2]);
      expect(result).toHaveLength(3);
      expect(mockChain.update).toHaveBeenCalledTimes(3);
    });
  });
});
