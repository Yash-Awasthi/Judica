/**
 * Integration test: Memory routes via fastify.inject()
 *
 * Tests memory management endpoints: compact, stats, clear, backend config.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { buildTestApp, createAuthHeaders } from "../helpers/testApp.js";

vi.mock("../../src/lib/redis.js", () => ({
  default: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue("OK"),
    pipeline: vi.fn(() => ({
      get: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([[null, null], [null, null]]),
    })),
  },
}));

function chainable(resolveValue: any = []): any {
  const chain: any = {};
  const methods = [
    "select", "from", "where", "limit", "orderBy", "update", "set",
    "insert", "values", "returning", "delete", "innerJoin",
  ];
  for (const m of methods) {
    chain[m] = vi.fn(() => chain);
  }
  chain.then = (resolve: any, reject?: any) => Promise.resolve(resolveValue).then(resolve, reject);
  return chain;
}

vi.mock("../../src/lib/drizzle.js", () => ({
  db: {
    select: vi.fn(() => chainable([{ value: 42 }])),
    insert: vi.fn(() => chainable([])),
    update: vi.fn(() => chainable([])),
    delete: vi.fn(() => chainable([])),
  },
}));

vi.mock("../../src/db/schema/auth.js", () => ({
  revokedTokens: { token: "revokedTokens.token" },
  refreshTokens: {},
  councilConfigs: {},
}));

vi.mock("../../src/db/schema/users.js", () => ({
  users: { id: "users.id", role: "users.role" },
  dailyUsage: {},
  userSettings: {},
}));

vi.mock("../../src/db/schema/memory.js", () => ({
  memories: {
    id: "memories.id",
    userId: "memories.userId",
    content: "memories.content",
  },
  memoryBackends: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: any[]) => args),
  and: vi.fn((...args: any[]) => args),
  count: vi.fn(() => "count"),
  sql: Object.assign(vi.fn(), { raw: vi.fn() }),
}));

vi.mock("../../src/lib/logger.js", () => ({
  default: {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn().mockReturnThis(),
  },
}));

vi.mock("../../src/middleware/errorHandler.js", () => ({
  AppError: class AppError extends Error {
    statusCode: number;
    code: string;
    constructor(statusCode: number, message: string, code: string = "INTERNAL_ERROR") {
      super(message);
      this.statusCode = statusCode;
      this.code = code;
    }
  },
}));

vi.mock("../../src/services/memoryCompaction.service.js", () => ({
  compact: vi.fn().mockResolvedValue({ merged: 5, removed: 2, expiredCount: 1 }),
}));

vi.mock("../../src/services/memoryRouter.service.js", () => ({
  getBackend: vi.fn().mockResolvedValue(null),
  setBackend: vi.fn().mockResolvedValue(undefined),
  removeBackend: vi.fn().mockResolvedValue(undefined),
  encryptConfig: vi.fn(),
}));

vi.mock("../../src/services/sessionSummary.service.js", () => ({
  summarizeSession: vi.fn().mockResolvedValue({ topics: ["AI", "testing"], keyPoints: 3 }),
}));

describe("Memory routes integration", () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;

  beforeAll(async () => {
    const { default: memoryPlugin } = await import("../../src/routes/memory.js");
    app = await buildTestApp([{ plugin: memoryPlugin, prefix: "/api/memory" }]);
  });

  afterAll(async () => {
    await app.close();
  });

  // --- Auth checks ---

  const protectedRoutes = [
    { method: "POST" as const, url: "/api/memory/compact" },
    { method: "GET" as const, url: "/api/memory/stats" },
    { method: "DELETE" as const, url: "/api/memory/all" },
    { method: "GET" as const, url: "/api/memory/backend" },
    { method: "POST" as const, url: "/api/memory/backend" },
    { method: "DELETE" as const, url: "/api/memory/backend" },
  ];

  for (const { method, url } of protectedRoutes) {
    it(`${method} ${url} returns 401 without auth`, async () => {
      const res = await app.inject({ method, url });
      expect(res.statusCode).toBe(401);
    });
  }

  // --- Compaction ---

  describe("POST /api/memory/compact", () => {
    it("triggers compaction with auth", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/memory/compact",
        headers: createAuthHeaders(),
        payload: {},
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty("merged");
      expect(body).toHaveProperty("removed");
    });
  });

  // --- Stats ---

  describe("GET /api/memory/stats", () => {
    it("returns memory statistics", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/memory/stats",
        headers: createAuthHeaders(),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty("chunkCount");
      expect(body).toHaveProperty("estimatedStorageMB");
    });
  });

  // --- Clear all ---

  describe("DELETE /api/memory/all", () => {
    it("rejects without confirmation", async () => {
      const res = await app.inject({
        method: "DELETE",
        url: "/api/memory/all",
        headers: createAuthHeaders(),
        payload: { confirm: "wrong" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("clears memory with correct confirmation", async () => {
      const res = await app.inject({
        method: "DELETE",
        url: "/api/memory/all",
        headers: createAuthHeaders(),
        payload: { confirm: "DELETE_ALL_MEMORY" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
    });
  });

  // --- Backend config ---

  describe("GET /api/memory/backend", () => {
    it("returns default local backend", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/memory/backend",
        headers: createAuthHeaders(),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().type).toBe("local");
    });
  });

  describe("POST /api/memory/backend", () => {
    it("rejects invalid backend type", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/memory/backend",
        headers: createAuthHeaders(),
        payload: { type: "invalid_backend" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("accepts valid backend type", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/memory/backend",
        headers: createAuthHeaders(),
        payload: { type: "local" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().type).toBe("local");
    });
  });

  describe("DELETE /api/memory/backend", () => {
    it("resets backend to local", async () => {
      const res = await app.inject({
        method: "DELETE",
        url: "/api/memory/backend",
        headers: createAuthHeaders(),
        payload: {},
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().type).toBe("local");
    });
  });

  // --- Session summary ---

  describe("POST /api/memory/summarize/:conversationId", () => {
    it("returns 401 without auth", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/memory/summarize/conv-123",
      });
      expect(res.statusCode).toBe(401);
    });

    it("triggers session summary with auth", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/memory/summarize/conv-123",
        headers: createAuthHeaders(),
        payload: {},
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toHaveProperty("summary");
    });
  });
});
