/**
 * Integration test: Auth guard middleware via fastify.inject()
 *
 * Verifies that routes protected by fastifyRequireAuth correctly
 * return 401 for unauthenticated requests and accept valid JWTs.
 * This tests the REAL middleware pipeline, not mocked handlers.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { buildTestApp, createAuthHeaders, signTestToken } from "../helpers/testApp.js";

// Mock external deps that auth middleware and routes import
vi.mock("../../src/lib/redis.js", () => ({
  default: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue("OK"),
    del: vi.fn().mockResolvedValue(1),
    ping: vi.fn().mockResolvedValue("PONG"),
    expire: vi.fn().mockResolvedValue(1),
    pipeline: vi.fn(() => ({
      get: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      del: vi.fn().mockReturnThis(),
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
    select: vi.fn(() => chainable([])),
    insert: vi.fn(() => chainable([])),
    update: vi.fn(() => chainable([])),
    delete: vi.fn(() => chainable([])),
  },
}));

vi.mock("../../src/db/schema/auth.js", () => ({
  revokedTokens: { tokenHash: "revokedTokens.tokenHash" },
  refreshTokens: {},
  councilConfigs: {},
}));

vi.mock("../../src/db/schema/users.js", () => ({
  users: { id: "users.id", role: "users.role", email: "users.email", username: "users.username", createdAt: "users.createdAt" },
  dailyUsage: { userId: "dailyUsage.userId", date: "dailyUsage.date", requests: "dailyUsage.requests", tokens: "dailyUsage.tokens" },
  userSettings: {},
}));

vi.mock("../../src/db/schema/conversations.js", () => ({
  conversations: { id: "conversations.id", userId: "conversations.userId", title: "conversations.title", createdAt: "conversations.createdAt", updatedAt: "conversations.updatedAt" },
  chats: { id: "chats.id", userId: "chats.userId", conversationId: "chats.conversationId", tokensUsed: "chats.tokensUsed", durationMs: "chats.durationMs", createdAt: "chats.createdAt" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: any[]) => args),
  and: vi.fn((...args: any[]) => args),
  gte: vi.fn((...args: any[]) => args),
  asc: vi.fn((col: any) => col),
  desc: vi.fn((col: any) => col),
  or: vi.fn((...args: any[]) => args),
  ilike: vi.fn((...args: any[]) => args),
  count: vi.fn(() => "count"),
  sum: vi.fn((col: any) => col),
  avg: vi.fn((col: any) => col),
  lte: vi.fn((...args: any[]) => args),
  sql: Object.assign(vi.fn(), { raw: vi.fn() }),
  isNotNull: vi.fn((col: any) => col),
}));

vi.mock("../../src/lib/db.js", () => ({
  pool: { query: vi.fn().mockResolvedValue({ rows: [{ "?column?": 1 }] }) },
}));

vi.mock("../../src/lib/logger.js", () => ({
  default: {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn().mockReturnThis(),
  },
}));

vi.mock("../../src/middleware/validate.js", () => ({
  fastifyValidate: vi.fn(() => vi.fn()),
  renameConversationSchema: {},
  forkSchema: {},
  authSchema: {},
  configSchema: {},
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

vi.mock("../../src/services/conversation.service.js", () => ({
  getConversationList: vi.fn().mockResolvedValue({ conversations: [], total: 0 }),
  deleteConversation: vi.fn(),
  updateConversationTitle: vi.fn(),
  generateConversationSummary: vi.fn(),
  findConversationById: vi.fn(),
  searchChats: vi.fn().mockResolvedValue([]),
}));

describe("Auth guard integration", () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;

  beforeAll(async () => {
    const [
      { default: historyPlugin },
      { default: metricsPlugin },
    ] = await Promise.all([
      import("../../src/routes/history.js"),
      import("../../src/routes/metrics.js"),
    ]);

    app = await buildTestApp([
      { plugin: historyPlugin, prefix: "/api/history" },
      { plugin: metricsPlugin, prefix: "/api/metrics" },
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  const protectedRoutes = [
    { method: "GET" as const, url: "/api/history" },
    { method: "GET" as const, url: "/api/history/search?q=test" },
    { method: "GET" as const, url: "/api/metrics/usage" },
    { method: "GET" as const, url: "/api/metrics/conversation/abc123" },
  ];

  for (const { method, url } of protectedRoutes) {
    it(`${method} ${url} returns 401 without auth`, async () => {
      const res = await app.inject({ method, url });
      expect(res.statusCode).toBe(401);
    });

    it(`${method} ${url} accepts valid JWT`, async () => {
      const res = await app.inject({
        method,
        url,
        headers: createAuthHeaders(),
      });
      // Should NOT be 401 — it may be 200, 400, 404, 500, but not 401
      expect(res.statusCode).not.toBe(401);
    });
  }

  it("rejects expired JWT with 401", async () => {
    const expiredToken = signTestToken(
      { userId: 1, username: "testuser", role: "member" },
      { expiresIn: "-60s" },
    );
    const res = await app.inject({
      method: "GET",
      url: "/api/history",
      headers: { authorization: `Bearer ${expiredToken}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects malformed JWT with 401", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/history",
      headers: { authorization: "Bearer not.a.valid.jwt" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects missing Bearer prefix with 401", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/history",
      headers: { authorization: signTestToken() },
    });
    expect(res.statusCode).toBe(401);
  });
});
