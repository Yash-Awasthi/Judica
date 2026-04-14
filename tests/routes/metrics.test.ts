import { describe, it, expect, vi, beforeEach } from "vitest";

// ---- mocks ----

const mockDb: any = {};

/**
 * Creates a thenable chain: every method returns `chain`, and
 * `await chain` resolves to `resolveValue`.  Pass `overrides`
 * to intercept specific methods (each override must itself return
 * a thenable or a resolved chain).
 */
function chainable(resolveValue: any = [], overrides: Record<string, any> = {}): any {
  const chain: any = {};
  const methods = [
    "select",
    "from",
    "where",
    "limit",
    "orderBy",
    "update",
    "set",
    "insert",
    "values",
    "returning",
    "delete",
    "innerJoin",
  ];
  for (const m of methods) {
    chain[m] = overrides[m] ?? vi.fn(() => chain);
  }
  // Make the chain awaitable
  chain.then = (resolve: any, reject?: any) => Promise.resolve(resolveValue).then(resolve, reject);
  return chain;
}

vi.mock("../../src/lib/drizzle.js", () => ({
  db: mockDb,
}));

vi.mock("../../src/db/schema/users.js", () => ({
  users: {
    id: "users.id",
    email: "users.email",
    username: "users.username",
    role: "users.role",
    createdAt: "users.createdAt",
  },
  dailyUsage: {
    userId: "dailyUsage.userId",
    date: "dailyUsage.date",
    requests: "dailyUsage.requests",
    tokens: "dailyUsage.tokens",
  },
}));

vi.mock("../../src/db/schema/conversations.js", () => ({
  conversations: {
    id: "conversations.id",
    userId: "conversations.userId",
    title: "conversations.title",
    createdAt: "conversations.createdAt",
    updatedAt: "conversations.updatedAt",
  },
  chats: {
    id: "chats.id",
    userId: "chats.userId",
    conversationId: "chats.conversationId",
    tokensUsed: "chats.tokensUsed",
    durationMs: "chats.durationMs",
    createdAt: "chats.createdAt",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: any[]) => args),
  and: vi.fn((...args: any[]) => args),
  gte: vi.fn((...args: any[]) => args),
  asc: vi.fn((col: any) => col),
  desc: vi.fn((col: any) => col),
  count: vi.fn(() => "count"),
  sum: vi.fn((col: any) => col),
  avg: vi.fn((col: any) => col),
  isNotNull: vi.fn((col: any) => col),
}));

vi.mock("../../src/middleware/fastifyAuth.js", () => ({
  fastifyRequireAuth: vi.fn(),
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

vi.mock("../../src/lib/logger.js", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ---- helpers to capture registered route handlers ----

const registeredRoutes: Record<string, { handler: Function; preHandler?: Function }> = {};

function createFastifyInstance(): any {
  const register = (method: string) =>
    vi.fn((path: string, opts: any, handler?: Function) => {
      const h = handler ?? opts;
      const pre = handler ? opts?.preHandler : undefined;
      registeredRoutes[`${method.toUpperCase()} ${path}`] = { handler: h, preHandler: pre };
    });

  return {
    get: register("GET"),
    post: register("POST"),
    put: register("PUT"),
    delete: register("DELETE"),
  };
}

function createRequest(
  overrides: Partial<{
    userId: number;
    body: any;
    params: any;
    query: any;
    headers: Record<string, string>;
  }> = {},
): any {
  return {
    userId: overrides.userId ?? 1,
    body: overrides.body ?? {},
    params: overrides.params ?? {},
    query: overrides.query ?? {},
    headers: overrides.headers ?? { authorization: "Bearer token" },
  };
}

function createReply(): any {
  const reply: any = {
    statusCode: 200,
    sent: false,
    code: vi.fn(function (this: any, c: number) {
      this.statusCode = c;
      return this;
    }),
    send: vi.fn(function (this: any, b: any) {
      return this;
    }),
  };
  return reply;
}

// ---- import and register the plugin ----

let metricsPlugin: any;

beforeEach(async () => {
  vi.clearAllMocks();
  for (const key of Object.keys(registeredRoutes)) {
    delete registeredRoutes[key];
  }

  const mod = await import("../../src/routes/metrics.js");
  metricsPlugin = mod.default;
  const fastify = createFastifyInstance();
  await metricsPlugin(fastify);
});

// ================================================================
// Route registration
// ================================================================
describe("route registration", () => {
  it("registers all expected routes", () => {
    expect(registeredRoutes["GET /usage"]).toBeDefined();
    expect(registeredRoutes["GET /system"]).toBeDefined();
    expect(registeredRoutes["GET /conversation/:id"]).toBeDefined();
  });

  it("all routes have a preHandler", () => {
    for (const key of Object.keys(registeredRoutes)) {
      expect(registeredRoutes[key].preHandler).toBeDefined();
    }
  });
});

// ================================================================
// GET /usage
// ================================================================
describe("GET /usage", () => {
  function setupUsageMocks(results: any[]) {
    let selectCallIndex = 0;
    mockDb.select = vi.fn(() => {
      const idx = selectCallIndex++;
      return chainable(results[idx]);
    });
  }

  it("returns usage metrics with default 30-day window", async () => {
    const dailyRows = [
      { date: new Date("2026-04-01"), requests: 10, tokens: 500 },
      { date: new Date("2026-04-02"), requests: 20, tokens: 1000 },
    ];

    setupUsageMocks([
      dailyRows,
      [{ value: 42 }],
      [{ total: "15000" }],
      [{ avgVal: "123.456" }],
    ]);

    const { handler } = registeredRoutes["GET /usage"];
    const request = createRequest({ userId: 7, query: {} });
    const reply = createReply();

    const result = await handler(request, reply);

    expect(result.period.days).toBe(30);
    expect(result.period.from).toBeDefined();
    expect(result.period.to).toBeDefined();
    expect(result.summary.totalChats).toBe(42);
    expect(result.summary.totalTokens).toBe(15000);
    expect(result.summary.avgDurationMs).toBe(123);
    expect(result.daily).toHaveLength(2);
    expect(result.daily[0].date).toBe("2026-04-01");
    expect(result.daily[0].requests).toBe(10);
    expect(result.daily[0].tokens).toBe(500);
    expect(result.daily[1].date).toBe("2026-04-02");
  });

  it("respects custom days query parameter", async () => {
    setupUsageMocks([[], [{ value: 0 }], [{ total: null }], [{ avgVal: null }]]);

    const { handler } = registeredRoutes["GET /usage"];
    const request = createRequest({ userId: 1, query: { days: "7" } });
    const result = await handler(request, createReply());

    expect(result.period.days).toBe(7);
  });

  it("defaults to 30 days when days query is non-numeric", async () => {
    setupUsageMocks([[], [{ value: 0 }], [{ total: null }], [{ avgVal: null }]]);

    const { handler } = registeredRoutes["GET /usage"];
    const request = createRequest({ userId: 1, query: { days: "abc" } });
    const result = await handler(request, createReply());

    expect(result.period.days).toBe(30);
  });

  it("handles null token sum gracefully (returns 0)", async () => {
    setupUsageMocks([[], [{ value: 0 }], [{ total: null }], [{ avgVal: null }]]);

    const { handler } = registeredRoutes["GET /usage"];
    const result = await handler(createRequest(), createReply());

    expect(result.summary.totalTokens).toBe(0);
    expect(result.summary.avgDurationMs).toBe(0);
  });

  it("returns empty daily array when no daily rows exist", async () => {
    setupUsageMocks([[], [{ value: 0 }], [{ total: "0" }], [{ avgVal: "0" }]]);

    const { handler } = registeredRoutes["GET /usage"];
    const result = await handler(createRequest(), createReply());

    expect(result.daily).toEqual([]);
  });

  it("rounds avgDurationMs to nearest integer", async () => {
    setupUsageMocks([[], [{ value: 5 }], [{ total: "100" }], [{ avgVal: "99.7" }]]);

    const { handler } = registeredRoutes["GET /usage"];
    const result = await handler(createRequest(), createReply());

    expect(result.summary.avgDurationMs).toBe(100);
  });

  it("throws AppError on database failure", async () => {
    const err = new Error("db down");
    mockDb.select = vi.fn(() => {
      const c = chainable([]);
      c.from = vi.fn(() => {
        const c2 = chainable([]);
        c2.where = vi.fn(() => {
          const c3 = chainable([]);
          c3.orderBy = vi.fn(() => Promise.reject(err));
          c3.then = (res: any, rej: any) => Promise.reject(err).then(res, rej);
          return c3;
        });
        c2.then = (res: any, rej: any) => Promise.reject(err).then(res, rej);
        return c2;
      });
      return c;
    });

    const { handler } = registeredRoutes["GET /usage"];
    await expect(handler(createRequest(), createReply())).rejects.toThrow(
      "Failed to get usage metrics",
    );
  });

  it("thrown AppError has correct code on database failure", async () => {
    const err = new Error("db down");
    mockDb.select = vi.fn(() => {
      const c = chainable([]);
      c.from = vi.fn(() => {
        const c2 = chainable([]);
        c2.where = vi.fn(() => {
          const c3 = chainable([]);
          c3.orderBy = vi.fn(() => Promise.reject(err));
          c3.then = (res: any, rej: any) => Promise.reject(err).then(res, rej);
          return c3;
        });
        c2.then = (res: any, rej: any) => Promise.reject(err).then(res, rej);
        return c2;
      });
      return c;
    });

    const { handler } = registeredRoutes["GET /usage"];
    try {
      await handler(createRequest(), createReply());
      expect.unreachable("Should have thrown");
    } catch (e: any) {
      expect(e.statusCode).toBe(500);
      expect(e.code).toBe("USAGE_METRICS_FETCH_FAILED");
    }
  });
});

// ================================================================
// GET /system
// ================================================================
describe("GET /system", () => {
  function setupSystemMocks(results: any[]) {
    let selectCallIndex = 0;
    mockDb.select = vi.fn(() => {
      const idx = selectCallIndex++;
      return chainable(results[idx]);
    });
  }

  it("returns system-wide metrics", async () => {
    setupSystemMocks([
      [{ value: 100 }], // totalUsers
      [{ value: 50 }], // totalConversations
      [{ value: 200 }], // totalChats
      [{ total: "99999" }], // tokenRow
      [{ value: 15 }], // recentChats
    ]);

    const { handler } = registeredRoutes["GET /system"];
    const result = await handler(createRequest(), createReply());

    expect(result.totalUsers).toBe(100);
    expect(result.totalConversations).toBe(50);
    expect(result.totalChats).toBe(200);
    expect(result.totalTokens).toBe(99999);
    expect(result.recentActivity.chatsLast24h).toBe(15);
  });

  it("handles null token total gracefully (returns 0)", async () => {
    setupSystemMocks([
      [{ value: 0 }],
      [{ value: 0 }],
      [{ value: 0 }],
      [{ total: null }],
      [{ value: 0 }],
    ]);

    const { handler } = registeredRoutes["GET /system"];
    const result = await handler(createRequest(), createReply());

    expect(result.totalTokens).toBe(0);
  });

  it("handles zero counts across the board", async () => {
    setupSystemMocks([
      [{ value: 0 }],
      [{ value: 0 }],
      [{ value: 0 }],
      [{ total: "0" }],
      [{ value: 0 }],
    ]);

    const { handler } = registeredRoutes["GET /system"];
    const result = await handler(createRequest(), createReply());

    expect(result).toEqual({
      totalUsers: 0,
      totalConversations: 0,
      totalChats: 0,
      totalTokens: 0,
      recentActivity: { chatsLast24h: 0 },
    });
  });

  it("throws AppError on database failure", async () => {
    const err = new Error("db down");
    mockDb.select = vi.fn(() => {
      const c = chainable([]);
      c.then = (res: any, rej: any) => Promise.reject(err).then(res, rej);
      return c;
    });

    const { handler } = registeredRoutes["GET /system"];
    await expect(handler(createRequest(), createReply())).rejects.toThrow(
      "Failed to get system metrics",
    );
  });

  it("thrown AppError has correct code on database failure", async () => {
    const err = new Error("db down");
    mockDb.select = vi.fn(() => {
      const c = chainable([]);
      c.then = (res: any, rej: any) => Promise.reject(err).then(res, rej);
      return c;
    });

    const { handler } = registeredRoutes["GET /system"];
    try {
      await handler(createRequest(), createReply());
      expect.unreachable("Should have thrown");
    } catch (e: any) {
      expect(e.statusCode).toBe(500);
      expect(e.code).toBe("SYSTEM_METRICS_FETCH_FAILED");
    }
  });
});

// ================================================================
// GET /conversation/:id
// ================================================================
describe("GET /conversation/:id", () => {
  it("returns conversation metrics for a valid conversation", async () => {
    const conversation = {
      id: "conv-1",
      userId: 1,
      title: "Test Conversation",
      createdAt: new Date("2026-04-01T00:00:00Z"),
      updatedAt: new Date("2026-04-10T00:00:00Z"),
    };

    const chatRows = [
      { tokensUsed: 100, durationMs: 200, createdAt: new Date() },
      { tokensUsed: 300, durationMs: 400, createdAt: new Date() },
      { tokensUsed: null, durationMs: null, createdAt: new Date() },
    ];

    let selectCallIndex = 0;
    mockDb.select = vi.fn(() => {
      const idx = selectCallIndex++;
      return chainable(idx === 0 ? [conversation] : chatRows);
    });

    const { handler } = registeredRoutes["GET /conversation/:id"];
    const request = createRequest({ userId: 1, params: { id: "conv-1" } });
    const reply = createReply();

    const result = await handler(request, reply);

    expect(result.conversationId).toBe("conv-1");
    expect(result.title).toBe("Test Conversation");
    expect(result.totalChats).toBe(3);
    expect(result.totalTokens).toBe(400); // 100 + 300 + 0
    expect(result.avgDurationMs).toBe(200); // (200 + 400 + 0) / 3 = 200
    expect(result.createdAt).toEqual(conversation.createdAt);
    expect(result.updatedAt).toEqual(conversation.updatedAt);
  });

  it("returns 404 when conversation is not found", async () => {
    mockDb.select = vi.fn(() => chainable([]));

    const { handler } = registeredRoutes["GET /conversation/:id"];
    const request = createRequest({ userId: 1, params: { id: "nonexistent" } });
    const reply = createReply();

    const result = await handler(request, reply);

    expect(reply.code).toHaveBeenCalledWith(404);
    expect(result).toEqual({ error: "Conversation not found" });
  });

  it("does not return another user's conversation (enforces userId match)", async () => {
    mockDb.select = vi.fn(() => chainable([]));

    const { handler } = registeredRoutes["GET /conversation/:id"];
    const request = createRequest({ userId: 999, params: { id: "conv-1" } });
    const reply = createReply();

    const result = await handler(request, reply);

    expect(reply.code).toHaveBeenCalledWith(404);
    expect(result).toEqual({ error: "Conversation not found" });
  });

  it("returns zero tokens and avgDuration when conversation has no chats", async () => {
    const conversation = {
      id: "conv-empty",
      userId: 1,
      title: "Empty",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    let selectCallIndex = 0;
    mockDb.select = vi.fn(() => {
      const idx = selectCallIndex++;
      return chainable(idx === 0 ? [conversation] : []);
    });

    const { handler } = registeredRoutes["GET /conversation/:id"];
    const request = createRequest({ userId: 1, params: { id: "conv-empty" } });
    const result = await handler(request, createReply());

    expect(result.totalChats).toBe(0);
    expect(result.totalTokens).toBe(0);
    expect(result.avgDurationMs).toBe(0);
  });

  it("handles chats with all null tokensUsed and durationMs", async () => {
    const conversation = {
      id: "conv-nulls",
      userId: 1,
      title: "Nulls",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const chatRows = [
      { tokensUsed: null, durationMs: null, createdAt: new Date() },
      { tokensUsed: null, durationMs: null, createdAt: new Date() },
    ];

    let selectCallIndex = 0;
    mockDb.select = vi.fn(() => {
      const idx = selectCallIndex++;
      return chainable(idx === 0 ? [conversation] : chatRows);
    });

    const { handler } = registeredRoutes["GET /conversation/:id"];
    const request = createRequest({ userId: 1, params: { id: "conv-nulls" } });
    const result = await handler(request, createReply());

    expect(result.totalChats).toBe(2);
    expect(result.totalTokens).toBe(0);
    expect(result.avgDurationMs).toBe(0);
  });

  it("throws AppError on database failure", async () => {
    const err = new Error("db down");
    mockDb.select = vi.fn(() => {
      const c = chainable([]);
      c.then = (res: any, rej: any) => Promise.reject(err).then(res, rej);
      return c;
    });

    const { handler } = registeredRoutes["GET /conversation/:id"];
    const request = createRequest({ userId: 1, params: { id: "conv-1" } });
    await expect(handler(request, createReply())).rejects.toThrow(
      "Failed to get conversation metrics",
    );
  });

  it("thrown AppError has correct code on database failure", async () => {
    const err = new Error("db down");
    mockDb.select = vi.fn(() => {
      const c = chainable([]);
      c.then = (res: any, rej: any) => Promise.reject(err).then(res, rej);
      return c;
    });

    const { handler } = registeredRoutes["GET /conversation/:id"];
    const request = createRequest({ userId: 1, params: { id: "conv-1" } });
    try {
      await handler(request, createReply());
      expect.unreachable("Should have thrown");
    } catch (e: any) {
      expect(e.statusCode).toBe(500);
      expect(e.code).toBe("CONVERSATION_METRICS_FETCH_FAILED");
    }
  });
});

// ================================================================
// fastifyRequireAdmin (inline preHandler in metrics.ts)
// ================================================================
describe("fastifyRequireAdmin preHandler", () => {
  it("/system route uses the admin preHandler (not just fastifyRequireAuth)", async () => {
    // The /system route uses fastifyRequireAdmin which is defined inline.
    // The /usage and /conversation/:id routes use fastifyRequireAuth directly.
    const { fastifyRequireAuth } = await import("../../src/middleware/fastifyAuth.js");

    const systemPre = registeredRoutes["GET /system"].preHandler;
    const usagePre = registeredRoutes["GET /usage"].preHandler;

    // /usage uses the imported fastifyRequireAuth directly
    expect(usagePre).toBe(fastifyRequireAuth);

    // /system uses fastifyRequireAdmin (a different function that wraps fastifyRequireAuth)
    expect(systemPre).not.toBe(fastifyRequireAuth);
  });

  it("/conversation/:id route uses fastifyRequireAuth preHandler", async () => {
    const { fastifyRequireAuth } = await import("../../src/middleware/fastifyAuth.js");
    const convPre = registeredRoutes["GET /conversation/:id"].preHandler;
    expect(convPre).toBe(fastifyRequireAuth);
  });

  it("fastifyRequireAdmin sends 401 when userId is missing", async () => {
    const { fastifyRequireAuth } = (await import(
      "../../src/middleware/fastifyAuth.js"
    )) as any;
    // Make fastifyRequireAuth a no-op (doesn't set reply.sent)
    fastifyRequireAuth.mockImplementation(() => Promise.resolve());

    const adminPreHandler = registeredRoutes["GET /system"].preHandler!;
    const request = createRequest();
    (request as any).userId = undefined;
    const reply = createReply();

    await adminPreHandler(request, reply);

    expect(reply.code).toHaveBeenCalledWith(401);
    expect(reply.send).toHaveBeenCalledWith({ error: "Not authenticated" });
  });

  it("fastifyRequireAdmin sends 403 when user is not admin", async () => {
    const { fastifyRequireAuth } = (await import(
      "../../src/middleware/fastifyAuth.js"
    )) as any;
    fastifyRequireAuth.mockImplementation(() => Promise.resolve());

    // Mock db to return a non-admin user
    mockDb.select = vi.fn(() => chainable([{ role: "member" }]));

    const adminPreHandler = registeredRoutes["GET /system"].preHandler!;
    const request = createRequest({ userId: 5 });
    const reply = createReply();

    await adminPreHandler(request, reply);

    expect(reply.code).toHaveBeenCalledWith(403);
    expect(reply.send).toHaveBeenCalledWith({ error: "Admin access required" });
  });

  it("fastifyRequireAdmin sends 403 when user not found in db", async () => {
    const { fastifyRequireAuth } = (await import(
      "../../src/middleware/fastifyAuth.js"
    )) as any;
    fastifyRequireAuth.mockImplementation(() => Promise.resolve());

    mockDb.select = vi.fn(() => chainable([]));

    const adminPreHandler = registeredRoutes["GET /system"].preHandler!;
    const request = createRequest({ userId: 999 });
    const reply = createReply();

    await adminPreHandler(request, reply);

    expect(reply.code).toHaveBeenCalledWith(403);
    expect(reply.send).toHaveBeenCalledWith({ error: "Admin access required" });
  });

  it("fastifyRequireAdmin passes through when user is admin", async () => {
    const { fastifyRequireAuth } = (await import(
      "../../src/middleware/fastifyAuth.js"
    )) as any;
    fastifyRequireAuth.mockImplementation(() => Promise.resolve());

    mockDb.select = vi.fn(() => chainable([{ role: "admin" }]));

    const adminPreHandler = registeredRoutes["GET /system"].preHandler!;
    const request = createRequest({ userId: 1 });
    const reply = createReply();

    await adminPreHandler(request, reply);

    // Should not have sent any error response
    expect(reply.code).not.toHaveBeenCalled();
    expect(reply.send).not.toHaveBeenCalled();
  });

  it("fastifyRequireAdmin returns early if fastifyRequireAuth sets reply.sent", async () => {
    const { fastifyRequireAuth } = (await import(
      "../../src/middleware/fastifyAuth.js"
    )) as any;
    fastifyRequireAuth.mockImplementation((_req: any, rep: any) => {
      rep.sent = true;
      return Promise.resolve();
    });

    const adminPreHandler = registeredRoutes["GET /system"].preHandler!;
    const request = createRequest({ userId: 1 });
    const reply = createReply();

    await adminPreHandler(request, reply);

    // Should return early without making any db calls or sending additional responses
    expect(mockDb.select).not.toHaveBeenCalled();
  });
});
