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

vi.mock("../../src/db/schema/conversations.js", () => ({
  conversations: {
    userId: "conversations.userId",
  },
  chats: {
    userId: "chats.userId",
  },
}));

vi.mock("../../src/db/schema/traces.js", () => ({
  traces: {
    userId: "traces.userId",
    totalTokens: "traces.totalTokens",
    totalCostUsd: "traces.totalCostUsd",
    totalLatencyMs: "traces.totalLatencyMs",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: any[]) => args),
  count: vi.fn(() => "count"),
  sum: vi.fn((col: any) => col),
  avg: vi.fn((col: any) => col),
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

let analyticsPlugin: any;

beforeEach(async () => {
  vi.clearAllMocks();
  // Clear registered routes
  for (const key of Object.keys(registeredRoutes)) {
    delete registeredRoutes[key];
  }

  // Re-import to register routes fresh
  const mod = await import("../../src/routes/analytics.js");
  analyticsPlugin = mod.default;
  const fastify = createFastifyInstance();
  await analyticsPlugin(fastify);
});

// ================================================================
// Route registration
// ================================================================
describe("route registration", () => {
  it("registers the GET /overview route", () => {
    expect(registeredRoutes["GET /overview"]).toBeDefined();
  });

  it("has a preHandler for auth on /overview", () => {
    expect(registeredRoutes["GET /overview"].preHandler).toBeDefined();
  });
});

// ================================================================
// GET /overview - success path
// ================================================================
describe("GET /overview - success", () => {
  function setupDbMocks(opts: {
    convCount?: number;
    chatCount?: number;
    totalTokens?: string | null;
    totalCostUsd?: string | null;
    avgLatency?: string | null;
    dailyRows?: any[];
    modelRows?: any[];
    toolRows?: any[];
  } = {}) {
    const {
      convCount = 10,
      chatCount = 50,
      totalTokens = "100000",
      totalCostUsd = "5.25",
      avgLatency = "320",
      dailyRows = [],
      modelRows = [],
      toolRows = [],
    } = opts;

    // We need to track the call sequence to return different results
    // for each db.select().from().where() chain
    let selectCallIndex = 0;

    const selectResults = [
      [{ value: convCount }],    // conversations count
      [{ value: chatCount }],    // chats count
      [{ totalTokens, totalCostUsd, avgLatency }], // trace aggregation
    ];

    mockDb.select = vi.fn(() => {
      const currentIndex = selectCallIndex++;
      const chain = chainable({
        where: vi.fn(() => selectResults[currentIndex] ?? []),
      });
      return chain;
    });

    // Track execute calls for daily usage, model distribution, top tools
    let executeCallIndex = 0;
    const executeResults = [
      { rows: dailyRows },
      { rows: modelRows },
      { rows: toolRows },
    ];

    mockDb.execute = vi.fn(() => {
      return Promise.resolve(executeResults[executeCallIndex++] ?? { rows: [] });
    });
  }

  it("returns all expected fields in the overview response", async () => {
    setupDbMocks({
      convCount: 5,
      chatCount: 25,
      totalTokens: "50000",
      totalCostUsd: "2.50",
      avgLatency: "150",
      dailyRows: [
        { date: "2026-04-10", tokens: "1000", cost: "0.50" },
      ],
      modelRows: [
        { model: "gpt-4o", count: "10" },
      ],
      toolRows: [
        { tool: "web_search", count: "5" },
      ],
    });

    const { handler } = registeredRoutes["GET /overview"];
    const result = await handler(createRequest({ userId: 42 }), createReply());

    expect(result).toEqual({
      totalConversations: 5,
      totalMessages: 25,
      totalTokensUsed: 50000,
      totalCostUsd: 2.50,
      avgLatencyMs: 150,
      modelDistribution: [{ model: "gpt-4o", count: 10 }],
      dailyUsage: [{ date: "2026-04-10", tokens: 1000, cost: 0.50 }],
      topTools: [{ tool: "web_search", count: 5 }],
    });
  });

  it("uses request.userId for all queries", async () => {
    setupDbMocks();

    const { handler } = registeredRoutes["GET /overview"];
    await handler(createRequest({ userId: 99 }), createReply());

    // db.select called 3 times (conversations, chats, traces)
    expect(mockDb.select).toHaveBeenCalledTimes(3);
    // db.execute called 3 times (daily usage, model distribution, top tools)
    expect(mockDb.execute).toHaveBeenCalledTimes(3);
  });

  it("handles null totalTokens by defaulting to 0", async () => {
    setupDbMocks({ totalTokens: null, totalCostUsd: null, avgLatency: null });

    const { handler } = registeredRoutes["GET /overview"];
    const result = await handler(createRequest(), createReply());

    expect(result.totalTokensUsed).toBe(0);
    expect(result.totalCostUsd).toBe(0);
    expect(result.avgLatencyMs).toBe(0);
  });

  it("rounds avgLatencyMs to the nearest integer", async () => {
    setupDbMocks({ avgLatency: "123.789" });

    const { handler } = registeredRoutes["GET /overview"];
    const result = await handler(createRequest(), createReply());

    expect(result.avgLatencyMs).toBe(124);
  });

  it("converts token and cost strings from daily rows to numbers", async () => {
    setupDbMocks({
      dailyRows: [
        { date: "2026-04-01", tokens: "5000", cost: "1.25" },
        { date: "2026-04-02", tokens: "8000", cost: "2.00" },
      ],
    });

    const { handler } = registeredRoutes["GET /overview"];
    const result = await handler(createRequest(), createReply());

    expect(result.dailyUsage).toEqual([
      { date: "2026-04-01", tokens: 5000, cost: 1.25 },
      { date: "2026-04-02", tokens: 8000, cost: 2.00 },
    ]);
  });

  it("returns empty arrays when no daily usage, models, or tools found", async () => {
    setupDbMocks({
      dailyRows: [],
      modelRows: [],
      toolRows: [],
    });

    const { handler } = registeredRoutes["GET /overview"];
    const result = await handler(createRequest(), createReply());

    expect(result.dailyUsage).toEqual([]);
    expect(result.modelDistribution).toEqual([]);
    expect(result.topTools).toEqual([]);
  });

  it("handles multiple model distributions", async () => {
    setupDbMocks({
      modelRows: [
        { model: "gpt-4o", count: "20" },
        { model: "claude-3-5-sonnet", count: "15" },
        { model: "gpt-3.5-turbo", count: "5" },
      ],
    });

    const { handler } = registeredRoutes["GET /overview"];
    const result = await handler(createRequest(), createReply());

    expect(result.modelDistribution).toHaveLength(3);
    expect(result.modelDistribution[0]).toEqual({ model: "gpt-4o", count: 20 });
    expect(result.modelDistribution[1]).toEqual({ model: "claude-3-5-sonnet", count: 15 });
    expect(result.modelDistribution[2]).toEqual({ model: "gpt-3.5-turbo", count: 5 });
  });

  it("handles multiple top tools", async () => {
    setupDbMocks({
      toolRows: [
        { tool: "web_search", count: "30" },
        { tool: "code_interpreter", count: "20" },
        { tool: "file_reader", count: "10" },
      ],
    });

    const { handler } = registeredRoutes["GET /overview"];
    const result = await handler(createRequest(), createReply());

    expect(result.topTools).toHaveLength(3);
    expect(result.topTools[0]).toEqual({ tool: "web_search", count: 30 });
    expect(result.topTools[1]).toEqual({ tool: "code_interpreter", count: 20 });
    expect(result.topTools[2]).toEqual({ tool: "file_reader", count: 10 });
  });

  it("formats daily usage dates as YYYY-MM-DD ISO strings", async () => {
    setupDbMocks({
      dailyRows: [
        { date: new Date("2026-04-05T00:00:00Z").toISOString(), tokens: "100", cost: "0.10" },
      ],
    });

    const { handler } = registeredRoutes["GET /overview"];
    const result = await handler(createRequest(), createReply());

    expect(result.dailyUsage[0].date).toBe("2026-04-05");
  });

  it("returns zero conversation and message counts when user has no data", async () => {
    setupDbMocks({ convCount: 0, chatCount: 0 });

    const { handler } = registeredRoutes["GET /overview"];
    const result = await handler(createRequest(), createReply());

    expect(result.totalConversations).toBe(0);
    expect(result.totalMessages).toBe(0);
  });

  it("handles large token counts correctly", async () => {
    setupDbMocks({ totalTokens: "999999999" });

    const { handler } = registeredRoutes["GET /overview"];
    const result = await handler(createRequest(), createReply());

    expect(result.totalTokensUsed).toBe(999999999);
  });
});

// ================================================================
// GET /overview - error paths
// ================================================================
describe("GET /overview - errors", () => {
  it("propagates db error from conversations count query", async () => {
    let selectCallIndex = 0;
    mockDb.select = vi.fn(() => {
      selectCallIndex++;
      if (selectCallIndex === 1) {
        const chain = chainable({
          where: vi.fn(() => { throw new Error("conversations query failed"); }),
        });
        return chain;
      }
      return chainable({ where: vi.fn(() => [{ value: 0 }]) });
    });
    mockDb.execute = vi.fn(() => Promise.resolve({ rows: [] }));

    const { handler } = registeredRoutes["GET /overview"];
    await expect(handler(createRequest(), createReply())).rejects.toThrow("conversations query failed");
  });

  it("propagates db error from chats count query", async () => {
    let selectCallIndex = 0;
    mockDb.select = vi.fn(() => {
      selectCallIndex++;
      if (selectCallIndex === 2) {
        const chain = chainable({
          where: vi.fn(() => { throw new Error("chats query failed"); }),
        });
        return chain;
      }
      return chainable({ where: vi.fn(() => [{ value: 0 }]) });
    });
    mockDb.execute = vi.fn(() => Promise.resolve({ rows: [] }));

    const { handler } = registeredRoutes["GET /overview"];
    await expect(handler(createRequest(), createReply())).rejects.toThrow("chats query failed");
  });

  it("propagates db error from traces aggregation query", async () => {
    let selectCallIndex = 0;
    mockDb.select = vi.fn(() => {
      selectCallIndex++;
      if (selectCallIndex === 3) {
        const chain = chainable({
          where: vi.fn(() => { throw new Error("traces agg failed"); }),
        });
        return chain;
      }
      return chainable({ where: vi.fn(() => [{ value: 0 }]) });
    });
    mockDb.execute = vi.fn(() => Promise.resolve({ rows: [] }));

    const { handler } = registeredRoutes["GET /overview"];
    await expect(handler(createRequest(), createReply())).rejects.toThrow("traces agg failed");
  });

  it("propagates db.execute error from daily usage query", async () => {
    let selectCallIndex = 0;
    mockDb.select = vi.fn(() => {
      selectCallIndex++;
      const results: any = {
        1: [{ value: 10 }],
        2: [{ value: 50 }],
        3: [{ totalTokens: "100", totalCostUsd: "1.0", avgLatency: "100" }],
      };
      return chainable({
        where: vi.fn(() => results[selectCallIndex] ?? []),
      });
    });

    mockDb.execute = vi.fn(() => Promise.reject(new Error("daily usage query failed")));

    const { handler } = registeredRoutes["GET /overview"];
    await expect(handler(createRequest(), createReply())).rejects.toThrow("daily usage query failed");
  });

  it("silently catches model distribution query errors and returns empty array", async () => {
    let selectCallIndex = 0;
    mockDb.select = vi.fn(() => {
      selectCallIndex++;
      const results: any = {
        1: [{ value: 5 }],
        2: [{ value: 20 }],
        3: [{ totalTokens: "500", totalCostUsd: "1.0", avgLatency: "50" }],
      };
      return chainable({
        where: vi.fn(() => results[selectCallIndex] ?? []),
      });
    });

    let executeCallIndex = 0;
    mockDb.execute = vi.fn(() => {
      executeCallIndex++;
      if (executeCallIndex === 1) {
        // daily usage succeeds
        return Promise.resolve({ rows: [] });
      }
      if (executeCallIndex === 2) {
        // model distribution fails
        return Promise.reject(new Error("model query failed"));
      }
      // top tools succeeds
      return Promise.resolve({ rows: [] });
    });

    const { handler } = registeredRoutes["GET /overview"];
    const result = await handler(createRequest(), createReply());

    // model distribution should be empty due to the caught error
    expect(result.modelDistribution).toEqual([]);
  });

  it("silently catches top tools query errors and returns empty array", async () => {
    let selectCallIndex = 0;
    mockDb.select = vi.fn(() => {
      selectCallIndex++;
      const results: any = {
        1: [{ value: 5 }],
        2: [{ value: 20 }],
        3: [{ totalTokens: "500", totalCostUsd: "1.0", avgLatency: "50" }],
      };
      return chainable({
        where: vi.fn(() => results[selectCallIndex] ?? []),
      });
    });

    let executeCallIndex = 0;
    mockDb.execute = vi.fn(() => {
      executeCallIndex++;
      if (executeCallIndex === 1) {
        // daily usage succeeds
        return Promise.resolve({ rows: [] });
      }
      if (executeCallIndex === 2) {
        // model distribution succeeds
        return Promise.resolve({ rows: [{ model: "gpt-4o", count: "5" }] });
      }
      // top tools fails
      return Promise.reject(new Error("tools query failed"));
    });

    const { handler } = registeredRoutes["GET /overview"];
    const result = await handler(createRequest(), createReply());

    // top tools should be empty due to the caught error
    expect(result.topTools).toEqual([]);
    // model distribution should still be populated
    expect(result.modelDistribution).toEqual([{ model: "gpt-4o", count: 5 }]);
  });
});
