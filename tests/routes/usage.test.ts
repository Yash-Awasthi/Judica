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
    "groupBy",
  ];
  for (const m of methods) {
    chain[m] = overrides[m] ?? vi.fn(() => chain);
  }
  return chain;
}

vi.mock("../../src/lib/drizzle.js", () => ({
  db: mockDb,
}));

vi.mock("../../src/db/schema/users.js", () => ({
  usageLogs: {
    userId: "usageLogs.userId",
    provider: "usageLogs.provider",
    model: "usageLogs.model",
    promptTokens: "usageLogs.promptTokens",
    completionTokens: "usageLogs.completionTokens",
    costUsd: "usageLogs.costUsd",
    latencyMs: "usageLogs.latencyMs",
    createdAt: "usageLogs.createdAt",
  },
  dailyUsage: { id: "dailyUsage.id" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: any[]) => ({ type: "eq", args })),
  and: vi.fn((...args: any[]) => ({ type: "and", args })),
  gte: vi.fn((...args: any[]) => ({ type: "gte", args })),
  lte: vi.fn((...args: any[]) => ({ type: "lte", args })),
  sum: vi.fn((col: any) => col),
  count: vi.fn(() => "count"),
  avg: vi.fn((col: any) => col),
  sql: vi.fn((strings: TemplateStringsArray, ...values: any[]) => ({
    type: "sql",
    strings,
    values,
  })),
  desc: vi.fn((col: any) => col),
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
    code: vi.fn(function (this: any, c: number) {
      this.statusCode = c;
      return this;
    }),
    send: vi.fn(function (this: any) {
      return this;
    }),
  };
  return reply;
}

// ---- import and register the plugin ----

let usagePlugin: any;

beforeEach(async () => {
  vi.clearAllMocks();
  for (const key of Object.keys(registeredRoutes)) {
    delete registeredRoutes[key];
  }

  const mod = await import("../../src/routes/usage.js");
  usagePlugin = mod.default;
  const fastify = createFastifyInstance();
  await usagePlugin(fastify);
});

// ================================================================
// Route registration
// ================================================================
describe("route registration", () => {
  it("registers GET / route", () => {
    expect(registeredRoutes["GET /"]).toBeDefined();
  });

  it("registers GET / with preHandler for auth", () => {
    expect(registeredRoutes["GET /"].preHandler).toBeDefined();
  });
});

// ================================================================
// GET / — success paths
// ================================================================
describe("GET / — success", () => {
  function setupMocks(opts: {
    summaryRow: any;
    byProvider: any[];
    dailyRows: any[];
  }) {
    // The handler makes three DB calls in sequence:
    // 1. db.select(...).from(usageLogs).where(...) => summary
    // 2. db.select(...).from(usageLogs).where(...).groupBy(...).orderBy(...) => byProvider
    // 3. db.execute(sql`...`) => daily raw
    let selectCallIndex = 0;

    mockDb.select = vi.fn(() => {
      selectCallIndex++;
      if (selectCallIndex === 1) {
        // Summary query: .select().from().where() => [summaryRow]
        return chainable({
          from: vi.fn(() =>
            chainable({
              where: vi.fn().mockResolvedValue([opts.summaryRow]),
            }),
          ),
        });
      }
      // By-provider query: .select().from().where().groupBy().orderBy() => byProvider
      return chainable({
        from: vi.fn(() =>
          chainable({
            where: vi.fn(() =>
              chainable({
                groupBy: vi.fn(() =>
                  chainable({
                    orderBy: vi.fn().mockResolvedValue(opts.byProvider),
                  }),
                ),
              }),
            ),
          }),
        ),
      });
    });

    mockDb.execute = vi.fn().mockResolvedValue({ rows: opts.dailyRows });
  }

  it("returns full usage data with no date filters", async () => {
    setupMocks({
      summaryRow: {
        totalRequests: 42,
        totalPromptTokens: "10000",
        totalCompletionTokens: "5000",
        totalCostUsd: "1.50",
        avgLatencyMs: "250.7",
      },
      byProvider: [
        {
          provider: "openai",
          model: "gpt-4",
          requests: 30,
          totalPromptTokens: "8000",
          totalCompletionTokens: "4000",
          totalCostUsd: "1.20",
          avgLatencyMs: "300.4",
        },
        {
          provider: "anthropic",
          model: "claude-3",
          requests: 12,
          totalPromptTokens: "2000",
          totalCompletionTokens: "1000",
          totalCostUsd: "0.30",
          avgLatencyMs: "150.2",
        },
      ],
      dailyRows: [
        { date: "2025-01-15", total_tokens: "3000", total_cost: 0.5, count: "10" },
        { date: "2025-01-14", total_tokens: "2000", total_cost: 0.3, count: "8" },
      ],
    });

    const { handler } = registeredRoutes["GET /"];
    const request = createRequest({ userId: 7, query: {} });
    const result = await handler(request, createReply());

    expect(result.summary).toEqual({
      total_requests: 42,
      total_prompt_tokens: 10000,
      total_completion_tokens: 5000,
      total_cost_usd: 1.5,
      avg_latency_ms: 251,
    });

    expect(result.by_provider).toHaveLength(2);
    expect(result.by_provider[0]).toEqual({
      provider: "openai",
      model: "gpt-4",
      requests: 30,
      total_tokens: 12000,
      total_cost_usd: 1.2,
      avg_latency_ms: 300,
    });
    expect(result.by_provider[1]).toEqual({
      provider: "anthropic",
      model: "claude-3",
      requests: 12,
      total_tokens: 3000,
      total_cost_usd: 0.3,
      avg_latency_ms: 150,
    });

    expect(result.daily).toHaveLength(2);
    expect(result.daily[0]).toEqual({
      date: "2025-01-15",
      total_tokens: 3000,
      total_cost: 0.5,
      count: 10,
    });
    expect(result.daily[1]).toEqual({
      date: "2025-01-14",
      total_tokens: 2000,
      total_cost: 0.3,
      count: 8,
    });
  });

  it("returns zeroed summary when all aggregates are null", async () => {
    setupMocks({
      summaryRow: {
        totalRequests: 0,
        totalPromptTokens: null,
        totalCompletionTokens: null,
        totalCostUsd: null,
        avgLatencyMs: null,
      },
      byProvider: [],
      dailyRows: [],
    });

    const { handler } = registeredRoutes["GET /"];
    const result = await handler(createRequest({ query: {} }), createReply());

    expect(result.summary).toEqual({
      total_requests: 0,
      total_prompt_tokens: 0,
      total_completion_tokens: 0,
      total_cost_usd: 0,
      avg_latency_ms: 0,
    });
    expect(result.by_provider).toEqual([]);
    expect(result.daily).toEqual([]);
  });

  it("returns empty by_provider array when no records exist", async () => {
    setupMocks({
      summaryRow: {
        totalRequests: 0,
        totalPromptTokens: "0",
        totalCompletionTokens: "0",
        totalCostUsd: "0",
        avgLatencyMs: "0",
      },
      byProvider: [],
      dailyRows: [],
    });

    const { handler } = registeredRoutes["GET /"];
    const result = await handler(createRequest({ query: {} }), createReply());

    expect(result.by_provider).toEqual([]);
  });

  it("handles single provider row correctly", async () => {
    setupMocks({
      summaryRow: {
        totalRequests: 5,
        totalPromptTokens: "100",
        totalCompletionTokens: "50",
        totalCostUsd: "0.05",
        avgLatencyMs: "100",
      },
      byProvider: [
        {
          provider: "openai",
          model: "gpt-3.5",
          requests: 5,
          totalPromptTokens: "100",
          totalCompletionTokens: "50",
          totalCostUsd: "0.05",
          avgLatencyMs: "100",
        },
      ],
      dailyRows: [],
    });

    const { handler } = registeredRoutes["GET /"];
    const result = await handler(createRequest({ query: {} }), createReply());

    expect(result.by_provider).toHaveLength(1);
    expect(result.by_provider[0].total_tokens).toBe(150);
  });

  it("returns empty daily array when no recent data exists", async () => {
    setupMocks({
      summaryRow: {
        totalRequests: 10,
        totalPromptTokens: "500",
        totalCompletionTokens: "200",
        totalCostUsd: "0.10",
        avgLatencyMs: "80",
      },
      byProvider: [],
      dailyRows: [],
    });

    const { handler } = registeredRoutes["GET /"];
    const result = await handler(createRequest({ query: {} }), createReply());

    expect(result.daily).toEqual([]);
  });
});

// ================================================================
// GET / — date filtering
// ================================================================
describe("GET / — date filtering", () => {
  function setupMinimalMocks() {
    mockDb.select = vi.fn(() =>
      chainable({
        from: vi.fn(() =>
          chainable({
            where: vi.fn(() =>
              chainable({
                groupBy: vi.fn(() =>
                  chainable({
                    orderBy: vi.fn().mockResolvedValue([]),
                  }),
                ),
              }),
            ),
          }),
        ),
      }),
    );
    // Override first call for summary
    let callCount = 0;
    mockDb.select = vi.fn(() => {
      callCount++;
      if (callCount === 1) {
        return chainable({
          from: vi.fn(() =>
            chainable({
              where: vi.fn().mockResolvedValue([
                {
                  totalRequests: 0,
                  totalPromptTokens: null,
                  totalCompletionTokens: null,
                  totalCostUsd: null,
                  avgLatencyMs: null,
                },
              ]),
            }),
          ),
        });
      }
      return chainable({
        from: vi.fn(() =>
          chainable({
            where: vi.fn(() =>
              chainable({
                groupBy: vi.fn(() =>
                  chainable({
                    orderBy: vi.fn().mockResolvedValue([]),
                  }),
                ),
              }),
            ),
          }),
        ),
      });
    });
    mockDb.execute = vi.fn().mockResolvedValue({ rows: [] });
  }

  it("passes start_date filter when provided", async () => {
    setupMinimalMocks();
    const { gte } = await import("drizzle-orm");

    const { handler } = registeredRoutes["GET /"];
    const request = createRequest({
      userId: 1,
      query: { start_date: "2025-01-01T00:00:00Z" },
    });

    await handler(request, createReply());
    expect(gte).toHaveBeenCalled();
  });

  it("passes end_date filter when provided", async () => {
    setupMinimalMocks();
    const { lte } = await import("drizzle-orm");

    const { handler } = registeredRoutes["GET /"];
    const request = createRequest({
      userId: 1,
      query: { end_date: "2025-12-31T23:59:59Z" },
    });

    await handler(request, createReply());
    expect(lte).toHaveBeenCalled();
  });

  it("passes both start_date and end_date filters together", async () => {
    setupMinimalMocks();
    const { gte, lte } = await import("drizzle-orm");

    const { handler } = registeredRoutes["GET /"];
    const request = createRequest({
      userId: 1,
      query: { start_date: "2025-01-01T00:00:00Z", end_date: "2025-06-30T23:59:59Z" },
    });

    await handler(request, createReply());
    expect(gte).toHaveBeenCalled();
    expect(lte).toHaveBeenCalled();
  });

  it("does not call gte/lte when no date filters are provided", async () => {
    setupMinimalMocks();
    const { gte, lte } = await import("drizzle-orm");
    vi.mocked(gte).mockClear();
    vi.mocked(lte).mockClear();

    const { handler } = registeredRoutes["GET /"];
    const request = createRequest({ userId: 1, query: {} });

    await handler(request, createReply());
    expect(gte).not.toHaveBeenCalled();
    expect(lte).not.toHaveBeenCalled();
  });
});

// ================================================================
// GET / — numeric coercion edge cases
// ================================================================
describe("GET / — numeric coercion", () => {
  function setupWithSummary(summaryRow: any, byProvider: any[] = []) {
    let selectCallIndex = 0;
    mockDb.select = vi.fn(() => {
      selectCallIndex++;
      if (selectCallIndex === 1) {
        return chainable({
          from: vi.fn(() =>
            chainable({
              where: vi.fn().mockResolvedValue([summaryRow]),
            }),
          ),
        });
      }
      return chainable({
        from: vi.fn(() =>
          chainable({
            where: vi.fn(() =>
              chainable({
                groupBy: vi.fn(() =>
                  chainable({
                    orderBy: vi.fn().mockResolvedValue(byProvider),
                  }),
                ),
              }),
            ),
          }),
        ),
      });
    });
    mockDb.execute = vi.fn().mockResolvedValue({ rows: [] });
  }

  it("rounds avg_latency_ms in summary", async () => {
    setupWithSummary({
      totalRequests: 1,
      totalPromptTokens: "100",
      totalCompletionTokens: "50",
      totalCostUsd: "0.01",
      avgLatencyMs: "123.789",
    });

    const { handler } = registeredRoutes["GET /"];
    const result = await handler(createRequest({ query: {} }), createReply());
    expect(result.summary.avg_latency_ms).toBe(124);
  });

  it("rounds avg_latency_ms in by_provider entries", async () => {
    setupWithSummary(
      {
        totalRequests: 1,
        totalPromptTokens: "100",
        totalCompletionTokens: "50",
        totalCostUsd: "0.01",
        avgLatencyMs: "100",
      },
      [
        {
          provider: "openai",
          model: "gpt-4",
          requests: 1,
          totalPromptTokens: "100",
          totalCompletionTokens: "50",
          totalCostUsd: "0.01",
          avgLatencyMs: "99.5",
        },
      ],
    );

    const { handler } = registeredRoutes["GET /"];
    const result = await handler(createRequest({ query: {} }), createReply());
    expect(result.by_provider[0].avg_latency_ms).toBe(100);
  });

  it("coerces string token counts to numbers in summary", async () => {
    setupWithSummary({
      totalRequests: 1,
      totalPromptTokens: "999",
      totalCompletionTokens: "1001",
      totalCostUsd: "2.55",
      avgLatencyMs: "0",
    });

    const { handler } = registeredRoutes["GET /"];
    const result = await handler(createRequest({ query: {} }), createReply());
    expect(result.summary.total_prompt_tokens).toBe(999);
    expect(result.summary.total_completion_tokens).toBe(1001);
    expect(result.summary.total_cost_usd).toBe(2.55);
  });

  it("coerces null prompt/completion tokens to 0 in by_provider", async () => {
    setupWithSummary(
      {
        totalRequests: 1,
        totalPromptTokens: null,
        totalCompletionTokens: null,
        totalCostUsd: null,
        avgLatencyMs: null,
      },
      [
        {
          provider: "openai",
          model: "gpt-4",
          requests: 1,
          totalPromptTokens: null,
          totalCompletionTokens: null,
          totalCostUsd: null,
          avgLatencyMs: null,
        },
      ],
    );

    const { handler } = registeredRoutes["GET /"];
    const result = await handler(createRequest({ query: {} }), createReply());
    expect(result.by_provider[0].total_tokens).toBe(0);
    expect(result.by_provider[0].total_cost_usd).toBe(0);
    expect(result.by_provider[0].avg_latency_ms).toBe(0);
  });

  it("converts daily total_tokens and count from string to number", async () => {
    let selectCallIndex = 0;
    mockDb.select = vi.fn(() => {
      selectCallIndex++;
      if (selectCallIndex === 1) {
        return chainable({
          from: vi.fn(() =>
            chainable({
              where: vi.fn().mockResolvedValue([
                {
                  totalRequests: 0,
                  totalPromptTokens: null,
                  totalCompletionTokens: null,
                  totalCostUsd: null,
                  avgLatencyMs: null,
                },
              ]),
            }),
          ),
        });
      }
      return chainable({
        from: vi.fn(() =>
          chainable({
            where: vi.fn(() =>
              chainable({
                groupBy: vi.fn(() =>
                  chainable({
                    orderBy: vi.fn().mockResolvedValue([]),
                  }),
                ),
              }),
            ),
          }),
        ),
      });
    });

    mockDb.execute = vi.fn().mockResolvedValue({
      rows: [
        { date: "2025-03-01", total_tokens: "12345", total_cost: 1.23, count: "99" },
      ],
    });

    const { handler } = registeredRoutes["GET /"];
    const result = await handler(createRequest({ query: {} }), createReply());

    expect(result.daily[0].total_tokens).toBe(12345);
    expect(typeof result.daily[0].total_tokens).toBe("number");
    expect(result.daily[0].count).toBe(99);
    expect(typeof result.daily[0].count).toBe("number");
    expect(result.daily[0].total_cost).toBe(1.23);
  });
});

// ================================================================
// GET / — userId scoping
// ================================================================
describe("GET / — userId scoping", () => {
  it("uses request.userId for the query", async () => {
    const { eq } = await import("drizzle-orm");
    vi.mocked(eq).mockClear();

    let selectCallIndex = 0;
    mockDb.select = vi.fn(() => {
      selectCallIndex++;
      if (selectCallIndex === 1) {
        return chainable({
          from: vi.fn(() =>
            chainable({
              where: vi.fn().mockResolvedValue([
                {
                  totalRequests: 0,
                  totalPromptTokens: null,
                  totalCompletionTokens: null,
                  totalCostUsd: null,
                  avgLatencyMs: null,
                },
              ]),
            }),
          ),
        });
      }
      return chainable({
        from: vi.fn(() =>
          chainable({
            where: vi.fn(() =>
              chainable({
                groupBy: vi.fn(() =>
                  chainable({
                    orderBy: vi.fn().mockResolvedValue([]),
                  }),
                ),
              }),
            ),
          }),
        ),
      });
    });
    mockDb.execute = vi.fn().mockResolvedValue({ rows: [] });

    const { handler } = registeredRoutes["GET /"];
    await handler(createRequest({ userId: 42, query: {} }), createReply());

    expect(eq).toHaveBeenCalledWith("usageLogs.userId", 42);
  });
});

// ================================================================
// GET / — error paths
// ================================================================
describe("GET / — error paths", () => {
  it("propagates db error from summary query", async () => {
    mockDb.select = vi.fn(() =>
      chainable({
        from: vi.fn(() =>
          chainable({
            where: vi.fn().mockRejectedValue(new Error("summary query failed")),
          }),
        ),
      }),
    );

    const { handler } = registeredRoutes["GET /"];
    await expect(handler(createRequest({ query: {} }), createReply())).rejects.toThrow(
      "summary query failed",
    );
  });

  it("propagates db error from byProvider query", async () => {
    let selectCallIndex = 0;
    mockDb.select = vi.fn(() => {
      selectCallIndex++;
      if (selectCallIndex === 1) {
        return chainable({
          from: vi.fn(() =>
            chainable({
              where: vi.fn().mockResolvedValue([
                {
                  totalRequests: 0,
                  totalPromptTokens: null,
                  totalCompletionTokens: null,
                  totalCostUsd: null,
                  avgLatencyMs: null,
                },
              ]),
            }),
          ),
        });
      }
      return chainable({
        from: vi.fn(() =>
          chainable({
            where: vi.fn(() =>
              chainable({
                groupBy: vi.fn(() =>
                  chainable({
                    orderBy: vi.fn().mockRejectedValue(new Error("provider query failed")),
                  }),
                ),
              }),
            ),
          }),
        ),
      });
    });

    const { handler } = registeredRoutes["GET /"];
    await expect(handler(createRequest({ query: {} }), createReply())).rejects.toThrow(
      "provider query failed",
    );
  });

  it("propagates db error from daily raw SQL query", async () => {
    let selectCallIndex = 0;
    mockDb.select = vi.fn(() => {
      selectCallIndex++;
      if (selectCallIndex === 1) {
        return chainable({
          from: vi.fn(() =>
            chainable({
              where: vi.fn().mockResolvedValue([
                {
                  totalRequests: 0,
                  totalPromptTokens: null,
                  totalCompletionTokens: null,
                  totalCostUsd: null,
                  avgLatencyMs: null,
                },
              ]),
            }),
          ),
        });
      }
      return chainable({
        from: vi.fn(() =>
          chainable({
            where: vi.fn(() =>
              chainable({
                groupBy: vi.fn(() =>
                  chainable({
                    orderBy: vi.fn().mockResolvedValue([]),
                  }),
                ),
              }),
            ),
          }),
        ),
      });
    });

    mockDb.execute = vi.fn().mockRejectedValue(new Error("daily query failed"));

    const { handler } = registeredRoutes["GET /"];
    await expect(handler(createRequest({ query: {} }), createReply())).rejects.toThrow(
      "daily query failed",
    );
  });
});

// ================================================================
// GET / — daily data mapping
// ================================================================
describe("GET / — daily data mapping", () => {
  function setupWithDaily(dailyRows: any[]) {
    let selectCallIndex = 0;
    mockDb.select = vi.fn(() => {
      selectCallIndex++;
      if (selectCallIndex === 1) {
        return chainable({
          from: vi.fn(() =>
            chainable({
              where: vi.fn().mockResolvedValue([
                {
                  totalRequests: 0,
                  totalPromptTokens: null,
                  totalCompletionTokens: null,
                  totalCostUsd: null,
                  avgLatencyMs: null,
                },
              ]),
            }),
          ),
        });
      }
      return chainable({
        from: vi.fn(() =>
          chainable({
            where: vi.fn(() =>
              chainable({
                groupBy: vi.fn(() =>
                  chainable({
                    orderBy: vi.fn().mockResolvedValue([]),
                  }),
                ),
              }),
            ),
          }),
        ),
      });
    });
    mockDb.execute = vi.fn().mockResolvedValue({ rows: dailyRows });
  }

  it("maps multiple daily rows preserving order", async () => {
    setupWithDaily([
      { date: "2025-03-05", total_tokens: "5000", total_cost: 2.0, count: "20" },
      { date: "2025-03-04", total_tokens: "3000", total_cost: 1.0, count: "15" },
      { date: "2025-03-03", total_tokens: "1000", total_cost: 0.5, count: "5" },
    ]);

    const { handler } = registeredRoutes["GET /"];
    const result = await handler(createRequest({ query: {} }), createReply());

    expect(result.daily).toHaveLength(3);
    expect(result.daily[0].date).toBe("2025-03-05");
    expect(result.daily[2].date).toBe("2025-03-03");
  });

  it("preserves the date field as-is from the database", async () => {
    const dateObj = new Date("2025-06-15");
    setupWithDaily([{ date: dateObj, total_tokens: "100", total_cost: 0.01, count: "1" }]);

    const { handler } = registeredRoutes["GET /"];
    const result = await handler(createRequest({ query: {} }), createReply());

    expect(result.daily[0].date).toBe(dateObj);
  });

  it("handles zero token daily rows", async () => {
    setupWithDaily([{ date: "2025-01-01", total_tokens: "0", total_cost: 0, count: "0" }]);

    const { handler } = registeredRoutes["GET /"];
    const result = await handler(createRequest({ query: {} }), createReply());

    expect(result.daily[0].total_tokens).toBe(0);
    expect(result.daily[0].count).toBe(0);
    expect(result.daily[0].total_cost).toBe(0);
  });
});

// ================================================================
// GET / — by_provider total_tokens calculation
// ================================================================
describe("GET / — by_provider total_tokens", () => {
  function setupWithProvider(providerRow: any) {
    let selectCallIndex = 0;
    mockDb.select = vi.fn(() => {
      selectCallIndex++;
      if (selectCallIndex === 1) {
        return chainable({
          from: vi.fn(() =>
            chainable({
              where: vi.fn().mockResolvedValue([
                {
                  totalRequests: 1,
                  totalPromptTokens: "100",
                  totalCompletionTokens: "50",
                  totalCostUsd: "0.01",
                  avgLatencyMs: "100",
                },
              ]),
            }),
          ),
        });
      }
      return chainable({
        from: vi.fn(() =>
          chainable({
            where: vi.fn(() =>
              chainable({
                groupBy: vi.fn(() =>
                  chainable({
                    orderBy: vi.fn().mockResolvedValue([providerRow]),
                  }),
                ),
              }),
            ),
          }),
        ),
      });
    });
    mockDb.execute = vi.fn().mockResolvedValue({ rows: [] });
  }

  it("sums prompt and completion tokens for total_tokens", async () => {
    setupWithProvider({
      provider: "openai",
      model: "gpt-4",
      requests: 10,
      totalPromptTokens: "7000",
      totalCompletionTokens: "3000",
      totalCostUsd: "1.00",
      avgLatencyMs: "200",
    });

    const { handler } = registeredRoutes["GET /"];
    const result = await handler(createRequest({ query: {} }), createReply());

    expect(result.by_provider[0].total_tokens).toBe(10000);
  });

  it("handles null prompt tokens in by_provider", async () => {
    setupWithProvider({
      provider: "openai",
      model: "gpt-4",
      requests: 1,
      totalPromptTokens: null,
      totalCompletionTokens: "500",
      totalCostUsd: "0.05",
      avgLatencyMs: "100",
    });

    const { handler } = registeredRoutes["GET /"];
    const result = await handler(createRequest({ query: {} }), createReply());

    expect(result.by_provider[0].total_tokens).toBe(500);
  });

  it("handles null completion tokens in by_provider", async () => {
    setupWithProvider({
      provider: "openai",
      model: "gpt-4",
      requests: 1,
      totalPromptTokens: "500",
      totalCompletionTokens: null,
      totalCostUsd: "0.05",
      avgLatencyMs: "100",
    });

    const { handler } = registeredRoutes["GET /"];
    const result = await handler(createRequest({ query: {} }), createReply());

    expect(result.by_provider[0].total_tokens).toBe(500);
  });

  it("handles both null prompt and completion tokens in by_provider", async () => {
    setupWithProvider({
      provider: "openai",
      model: "gpt-4",
      requests: 1,
      totalPromptTokens: null,
      totalCompletionTokens: null,
      totalCostUsd: null,
      avgLatencyMs: null,
    });

    const { handler } = registeredRoutes["GET /"];
    const result = await handler(createRequest({ query: {} }), createReply());

    expect(result.by_provider[0].total_tokens).toBe(0);
  });
});
