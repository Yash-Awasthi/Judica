import { describe, it, expect, vi, beforeEach } from "vitest";

// ---- mocks ----

const mockDb: any = {};

function chainable(overrides: Record<string, any> = {}): any {
  const chain: any = {};
  const methods = [
    "select",
    "from",
    "where",
    "limit",
    "orderBy",
    "offset",
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
  return chain;
}

vi.mock("../../src/lib/drizzle.js", () => ({
  db: mockDb,
}));

vi.mock("../../src/db/schema/traces.js", () => ({
  traces: {
    id: "traces.id",
    userId: "traces.userId",
    conversationId: "traces.conversationId",
    workflowRunId: "traces.workflowRunId",
    type: "traces.type",
    totalLatencyMs: "traces.totalLatencyMs",
    totalTokens: "traces.totalTokens",
    totalCostUsd: "traces.totalCostUsd",
    createdAt: "traces.createdAt",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: any[]) => ({ _tag: "eq", args })),
  and: vi.fn((...args: any[]) => ({ _tag: "and", args })),
  gte: vi.fn((...args: any[]) => ({ _tag: "gte", args })),
  lte: vi.fn((...args: any[]) => ({ _tag: "lte", args })),
  count: vi.fn(() => "count"),
  desc: vi.fn((col: any) => ({ _tag: "desc", col })),
  sql: vi.fn((...args: any[]) => args),
}));

vi.mock("../../src/middleware/fastifyAuth.js", () => ({
  fastifyRequireAuth: vi.fn(),
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

function createRequest(overrides: Partial<{
  userId: number;
  body: any;
  params: any;
  query: any;
  headers: Record<string, string>;
}> = {}): any {
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
    status: vi.fn(function (this: any, c: number) {
      this.statusCode = c;
      return this;
    }),
    code: vi.fn(function (this: any, c: number) {
      this.statusCode = c;
      return this;
    }),
    send: vi.fn(function (this: any, b: any) {
      this._body = b;
      return this;
    }),
  };
  return reply;
}

// ---- import and register the plugin ----

let tracesPlugin: any;

beforeEach(async () => {
  vi.clearAllMocks();
  for (const key of Object.keys(registeredRoutes)) {
    delete registeredRoutes[key];
  }

  const mod = await import("../../src/routes/traces.js");
  tracesPlugin = mod.default;
  const fastify = createFastifyInstance();
  await tracesPlugin(fastify);
});

// ================================================================
// Route registration
// ================================================================
describe("route registration", () => {
  it("registers the GET / route", () => {
    expect(registeredRoutes["GET /"]).toBeDefined();
  });

  it("registers the GET /:id route", () => {
    expect(registeredRoutes["GET /:id"]).toBeDefined();
  });

  it("has a preHandler for auth on GET /", () => {
    expect(registeredRoutes["GET /"].preHandler).toBeDefined();
  });

  it("has a preHandler for auth on GET /:id", () => {
    expect(registeredRoutes["GET /:id"].preHandler).toBeDefined();
  });
});

// ================================================================
// GET / - list traces - success paths
// ================================================================
describe("GET / - list traces - success", () => {
  function setupListMocks(opts: {
    traceRows?: any[];
    total?: number;
  } = {}) {
    const { traceRows = [], total = 0 } = opts;

    let selectCallIndex = 0;

    mockDb.select = vi.fn(() => {
      const currentIndex = selectCallIndex++;
      if (currentIndex === 0) {
        // trace rows query
        return chainable({
          limit: vi.fn(() => traceRows),
        });
      }
      // count query
      return chainable({
        where: vi.fn(() => [{ value: total }]),
      });
    });
  }

  it("returns paginated traces with default page and limit", async () => {
    const mockTraces = [
      { id: "t1", conversationId: "c1", workflowRunId: "w1", type: "llm", totalLatencyMs: 100, totalTokens: 500, totalCostUsd: 0.01, createdAt: new Date() },
    ];

    setupListMocks({ traceRows: mockTraces, total: 1 });

    const { handler } = registeredRoutes["GET /"];
    const result = await handler(createRequest({ query: {} }), createReply());

    expect(result).toEqual({
      traces: mockTraces,
      total: 1,
      page: 1,
      limit: 20,
      pages: 1,
    });
  });

  it("respects page and limit query params", async () => {
    setupListMocks({ traceRows: [], total: 50 });

    const { handler } = registeredRoutes["GET /"];
    const result = await handler(
      createRequest({ query: { page: "3", limit: "10" } }),
      createReply(),
    );

    expect(result.page).toBe(3);
    expect(result.limit).toBe(10);
    expect(result.total).toBe(50);
    expect(result.pages).toBe(5);
  });

  it("clamps limit to max 100", async () => {
    setupListMocks({ traceRows: [], total: 0 });

    const { handler } = registeredRoutes["GET /"];
    const result = await handler(
      createRequest({ query: { limit: "500" } }),
      createReply(),
    );

    expect(result.limit).toBe(100);
  });

  it("clamps limit to min 1 when negative", async () => {
    setupListMocks({ traceRows: [], total: 0 });

    const { handler } = registeredRoutes["GET /"];
    const result = await handler(
      createRequest({ query: { limit: "-5" } }),
      createReply(),
    );

    expect(result.limit).toBe(1);
  });

  it("defaults limit to 20 when limit is 0 (falsy parseInt result)", async () => {
    setupListMocks({ traceRows: [], total: 0 });

    const { handler } = registeredRoutes["GET /"];
    const result = await handler(
      createRequest({ query: { limit: "0" } }),
      createReply(),
    );

    // parseInt("0") is 0, which is falsy, so || 20 kicks in, then Math.min/max yields 20
    expect(result.limit).toBe(20);
  });

  it("clamps page to min 1 for negative values", async () => {
    setupListMocks({ traceRows: [], total: 0 });

    const { handler } = registeredRoutes["GET /"];
    const result = await handler(
      createRequest({ query: { page: "-5" } }),
      createReply(),
    );

    expect(result.page).toBe(1);
  });

  it("defaults page to 1 for non-numeric values", async () => {
    setupListMocks({ traceRows: [], total: 0 });

    const { handler } = registeredRoutes["GET /"];
    const result = await handler(
      createRequest({ query: { page: "abc" } }),
      createReply(),
    );

    expect(result.page).toBe(1);
  });

  it("defaults limit to 20 for non-numeric values", async () => {
    setupListMocks({ traceRows: [], total: 0 });

    const { handler } = registeredRoutes["GET /"];
    const result = await handler(
      createRequest({ query: { limit: "xyz" } }),
      createReply(),
    );

    expect(result.limit).toBe(20);
  });

  it("calculates pages correctly (ceiling division)", async () => {
    setupListMocks({ traceRows: [], total: 21 });

    const { handler } = registeredRoutes["GET /"];
    const result = await handler(
      createRequest({ query: { limit: "10" } }),
      createReply(),
    );

    expect(result.pages).toBe(3); // ceil(21/10) = 3
  });

  it("returns 0 pages when total is 0", async () => {
    setupListMocks({ traceRows: [], total: 0 });

    const { handler } = registeredRoutes["GET /"];
    const result = await handler(createRequest({ query: {} }), createReply());

    expect(result.pages).toBe(0);
    expect(result.traces).toEqual([]);
  });

  it("passes type filter to conditions", async () => {
    setupListMocks({ traceRows: [], total: 0 });
    const { eq } = await import("drizzle-orm");

    const { handler } = registeredRoutes["GET /"];
    await handler(
      createRequest({ query: { type: "llm" } }),
      createReply(),
    );

    expect(eq).toHaveBeenCalledWith("traces.type", "llm");
  });

  it("passes conversation_id filter to conditions", async () => {
    setupListMocks({ traceRows: [], total: 0 });
    const { eq } = await import("drizzle-orm");

    const { handler } = registeredRoutes["GET /"];
    await handler(
      createRequest({ query: { conversation_id: "conv-123" } }),
      createReply(),
    );

    expect(eq).toHaveBeenCalledWith("traces.conversationId", "conv-123");
  });

  it("passes date_from filter using gte", async () => {
    setupListMocks({ traceRows: [], total: 0 });
    const { gte } = await import("drizzle-orm");

    const { handler } = registeredRoutes["GET /"];
    await handler(
      createRequest({ query: { date_from: "2026-01-01T00:00:00Z" } }),
      createReply(),
    );

    expect(gte).toHaveBeenCalledWith("traces.createdAt", new Date("2026-01-01T00:00:00Z"));
  });

  it("passes date_to filter using lte", async () => {
    setupListMocks({ traceRows: [], total: 0 });
    const { lte } = await import("drizzle-orm");

    const { handler } = registeredRoutes["GET /"];
    await handler(
      createRequest({ query: { date_to: "2026-12-31T23:59:59Z" } }),
      createReply(),
    );

    expect(lte).toHaveBeenCalledWith("traces.createdAt", new Date("2026-12-31T23:59:59Z"));
  });

  it("combines multiple filters together", async () => {
    setupListMocks({ traceRows: [], total: 0 });
    const { eq, gte, lte, and } = await import("drizzle-orm");

    const { handler } = registeredRoutes["GET /"];
    await handler(
      createRequest({
        userId: 42,
        query: {
          type: "llm",
          conversation_id: "conv-1",
          date_from: "2026-01-01T00:00:00Z",
          date_to: "2026-12-31T23:59:59Z",
        },
      }),
      createReply(),
    );

    // userId filter is always applied
    expect(eq).toHaveBeenCalledWith("traces.userId", 42);
    // type filter
    expect(eq).toHaveBeenCalledWith("traces.type", "llm");
    // conversation_id filter
    expect(eq).toHaveBeenCalledWith("traces.conversationId", "conv-1");
    // date filters
    expect(gte).toHaveBeenCalled();
    expect(lte).toHaveBeenCalled();
    // and is called to combine all conditions
    expect(and).toHaveBeenCalled();
  });

  it("always filters by userId", async () => {
    setupListMocks({ traceRows: [], total: 0 });
    const { eq } = await import("drizzle-orm");

    const { handler } = registeredRoutes["GET /"];
    await handler(createRequest({ userId: 77 }), createReply());

    expect(eq).toHaveBeenCalledWith("traces.userId", 77);
  });

  it("uses desc ordering on createdAt", async () => {
    setupListMocks({ traceRows: [], total: 0 });
    const { desc } = await import("drizzle-orm");

    const { handler } = registeredRoutes["GET /"];
    await handler(createRequest({ query: {} }), createReply());

    expect(desc).toHaveBeenCalledWith("traces.createdAt");
  });

  it("handles countResult with no rows gracefully (defaults to 0)", async () => {
    let selectCallIndex = 0;
    mockDb.select = vi.fn(() => {
      const currentIndex = selectCallIndex++;
      if (currentIndex === 0) {
        return chainable({ limit: vi.fn(() => []) });
      }
      // count query returns empty array
      return chainable({ where: vi.fn(() => []) });
    });

    const { handler } = registeredRoutes["GET /"];
    const result = await handler(createRequest({ query: {} }), createReply());

    expect(result.total).toBe(0);
    expect(result.pages).toBe(0);
  });

  it("returns multiple trace rows", async () => {
    const mockTraces = [
      { id: "t1", type: "llm" },
      { id: "t2", type: "tool" },
      { id: "t3", type: "llm" },
    ];
    setupListMocks({ traceRows: mockTraces, total: 3 });

    const { handler } = registeredRoutes["GET /"];
    const result = await handler(createRequest({ query: {} }), createReply());

    expect(result.traces).toHaveLength(3);
    expect(result.total).toBe(3);
  });
});

// ================================================================
// GET / - list traces - error paths
// ================================================================
describe("GET / - list traces - errors", () => {
  it("propagates db error from select query", async () => {
    mockDb.select = vi.fn(() => {
      throw new Error("db select failed");
    });

    const { handler } = registeredRoutes["GET /"];
    await expect(handler(createRequest(), createReply())).rejects.toThrow("db select failed");
  });

  it("propagates db error from Promise.all rejection", async () => {
    let selectCallIndex = 0;
    mockDb.select = vi.fn(() => {
      const currentIndex = selectCallIndex++;
      if (currentIndex === 0) {
        return chainable({
          limit: vi.fn(() => Promise.reject(new Error("trace query failed"))),
        });
      }
      return chainable({
        where: vi.fn(() => [{ value: 0 }]),
      });
    });

    const { handler } = registeredRoutes["GET /"];
    await expect(handler(createRequest(), createReply())).rejects.toThrow("trace query failed");
  });
});

// ================================================================
// GET /:id - get trace detail - success paths
// ================================================================
describe("GET /:id - trace detail - success", () => {
  it("returns the trace when found", async () => {
    const mockTrace = {
      id: "trace-abc",
      userId: 1,
      conversationId: "conv-1",
      type: "llm",
      totalLatencyMs: 250,
      totalTokens: 1000,
      totalCostUsd: 0.05,
      createdAt: new Date("2026-04-01T12:00:00Z"),
    };

    mockDb.select = vi.fn(() =>
      chainable({
        limit: vi.fn(() => [mockTrace]),
      }),
    );

    const { handler } = registeredRoutes["GET /:id"];
    const result = await handler(
      createRequest({ userId: 1, params: { id: "trace-abc" } }),
      createReply(),
    );

    expect(result).toEqual(mockTrace);
  });

  it("filters by both trace id and userId", async () => {
    const mockTrace = { id: "trace-xyz", userId: 42 };

    mockDb.select = vi.fn(() =>
      chainable({
        limit: vi.fn(() => [mockTrace]),
      }),
    );
    const { eq, and } = await import("drizzle-orm");

    const { handler } = registeredRoutes["GET /:id"];
    await handler(
      createRequest({ userId: 42, params: { id: "trace-xyz" } }),
      createReply(),
    );

    expect(eq).toHaveBeenCalledWith("traces.id", "trace-xyz");
    expect(eq).toHaveBeenCalledWith("traces.userId", 42);
    expect(and).toHaveBeenCalled();
  });
});

// ================================================================
// GET /:id - get trace detail - error / not found paths
// ================================================================
describe("GET /:id - trace detail - not found / errors", () => {
  it("returns 404 when trace is not found", async () => {
    mockDb.select = vi.fn(() =>
      chainable({
        limit: vi.fn(() => []),
      }),
    );

    const { handler } = registeredRoutes["GET /:id"];
    const reply = createReply();
    await handler(
      createRequest({ params: { id: "nonexistent" } }),
      reply,
    );

    expect(reply.status).toHaveBeenCalledWith(404);
    expect(reply.send).toHaveBeenCalledWith({ error: "Trace not found" });
  });

  it("returns 404 when trace belongs to a different user", async () => {
    // The query filters by userId, so a different user's trace won't be returned
    mockDb.select = vi.fn(() =>
      chainable({
        limit: vi.fn(() => []),
      }),
    );

    const { handler } = registeredRoutes["GET /:id"];
    const reply = createReply();
    await handler(
      createRequest({ userId: 999, params: { id: "trace-other-user" } }),
      reply,
    );

    expect(reply.status).toHaveBeenCalledWith(404);
    expect(reply.send).toHaveBeenCalledWith({ error: "Trace not found" });
  });

  it("propagates db error from detail query", async () => {
    mockDb.select = vi.fn(() =>
      chainable({
        limit: vi.fn(() => {
          throw new Error("detail query failed");
        }),
      }),
    );

    const { handler } = registeredRoutes["GET /:id"];
    await expect(
      handler(createRequest({ params: { id: "trace-err" } }), createReply()),
    ).rejects.toThrow("detail query failed");
  });
});
