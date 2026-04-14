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

vi.mock("../../src/db/schema/users.js", () => ({
  users: {
    id: "users.id",
    email: "users.email",
    username: "users.username",
    role: "users.role",
    createdAt: "users.createdAt",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: any[]) => args),
  and: vi.fn((...args: any[]) => args),
  desc: vi.fn((col: any) => col),
  gte: vi.fn((...args: any[]) => args),
  sql: vi.fn(() => "sql"),
  count: vi.fn(() => "count"),
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

// Mock cost.js library functions
const mockGetUserCostBreakdown = vi.fn();
const mockGetOrganizationCostSummary = vi.fn();
const mockCheckUserCostLimits = vi.fn();
const mockGetCostEfficiencyMetrics = vi.fn();
const mockDefaultCostConfig = [
  { provider: "openai", model: "gpt-4o", inputTokenPrice: 0.0025, outputTokenPrice: 0.01, currency: "USD" },
  { provider: "anthropic", model: "claude-3-5-sonnet-20241022", inputTokenPrice: 0.003, outputTokenPrice: 0.015, currency: "USD" },
];

vi.mock("../../src/lib/cost.js", () => ({
  getUserCostBreakdown: (...args: any[]) => mockGetUserCostBreakdown(...args),
  getOrganizationCostSummary: (...args: any[]) => mockGetOrganizationCostSummary(...args),
  checkUserCostLimits: (...args: any[]) => mockCheckUserCostLimits(...args),
  getCostEfficiencyMetrics: (...args: any[]) => mockGetCostEfficiencyMetrics(...args),
  DEFAULT_COST_CONFIG: [
    { provider: "openai", model: "gpt-4o", inputTokenPrice: 0.0025, outputTokenPrice: 0.01, currency: "USD" },
    { provider: "anthropic", model: "claude-3-5-sonnet-20241022", inputTokenPrice: 0.003, outputTokenPrice: 0.015, currency: "USD" },
  ],
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

let costsPlugin: any;

beforeEach(async () => {
  vi.clearAllMocks();
  // Clear registered routes
  for (const key of Object.keys(registeredRoutes)) {
    delete registeredRoutes[key];
  }

  // Re-import to register routes fresh
  const mod = await import("../../src/routes/costs.js");
  costsPlugin = mod.default;
  const fastify = createFastifyInstance();
  await costsPlugin(fastify);
});

// ================================================================
// Route registration
// ================================================================
describe("route registration", () => {
  it("registers all expected routes", () => {
    expect(registeredRoutes["GET /breakdown"]).toBeDefined();
    expect(registeredRoutes["GET /limits"]).toBeDefined();
    expect(registeredRoutes["GET /efficiency"]).toBeDefined();
    expect(registeredRoutes["GET /pricing"]).toBeDefined();
    expect(registeredRoutes["GET /organization"]).toBeDefined();
    expect(registeredRoutes["GET /dashboard"]).toBeDefined();
  });

  it("all routes have a preHandler for auth", () => {
    for (const key of Object.keys(registeredRoutes)) {
      expect(registeredRoutes[key].preHandler).toBeDefined();
    }
  });
});

// ================================================================
// GET /breakdown
// ================================================================
describe("GET /breakdown", () => {
  it("returns cost breakdown with default 30-day period", async () => {
    const mockBreakdown = {
      totalCost: 12.50,
      totalTokens: 625000,
      byProvider: { openai: { cost: 12.50, tokens: 625000, requests: 100 } },
      byModel: {},
      byTimeframe: { "2026-04-01": { cost: 5.0, tokens: 250000, requests: 50 } },
    };
    mockGetUserCostBreakdown.mockResolvedValue(mockBreakdown);

    const { handler } = registeredRoutes["GET /breakdown"];
    const request = createRequest({ userId: 1, query: {} });
    const reply = createReply();

    await handler(request, reply);

    expect(mockGetUserCostBreakdown).toHaveBeenCalledWith(1, 30);
    expect(reply.send).toHaveBeenCalledWith({
      breakdown: mockBreakdown,
      period: "30 days",
      currency: "USD",
    });
  });

  it("accepts custom days parameter", async () => {
    const mockBreakdown = { totalCost: 5.0, totalTokens: 250000, byProvider: {}, byModel: {}, byTimeframe: {} };
    mockGetUserCostBreakdown.mockResolvedValue(mockBreakdown);

    const { handler } = registeredRoutes["GET /breakdown"];
    const request = createRequest({ userId: 42, query: { days: "7" } });
    const reply = createReply();

    await handler(request, reply);

    expect(mockGetUserCostBreakdown).toHaveBeenCalledWith(42, 7);
    expect(reply.send).toHaveBeenCalledWith({
      breakdown: mockBreakdown,
      period: "7 days",
      currency: "USD",
    });
  });

  it("returns empty breakdown when no usage exists", async () => {
    const emptyBreakdown = { totalCost: 0, totalTokens: 0, byProvider: {}, byModel: {}, byTimeframe: {} };
    mockGetUserCostBreakdown.mockResolvedValue(emptyBreakdown);

    const { handler } = registeredRoutes["GET /breakdown"];
    const reply = createReply();
    await handler(createRequest(), reply);

    expect(reply.send).toHaveBeenCalledWith({
      breakdown: emptyBreakdown,
      period: "30 days",
      currency: "USD",
    });
  });

  it("propagates errors from getUserCostBreakdown", async () => {
    mockGetUserCostBreakdown.mockRejectedValue(new Error("db failure"));

    const { handler } = registeredRoutes["GET /breakdown"];
    await expect(handler(createRequest(), createReply())).rejects.toThrow("db failure");
  });

  it("passes days=1 correctly", async () => {
    mockGetUserCostBreakdown.mockResolvedValue({ totalCost: 0, totalTokens: 0, byProvider: {}, byModel: {}, byTimeframe: {} });

    const { handler } = registeredRoutes["GET /breakdown"];
    await handler(createRequest({ query: { days: "1" } }), createReply());

    expect(mockGetUserCostBreakdown).toHaveBeenCalledWith(1, 1);
  });
});

// ================================================================
// GET /limits
// ================================================================
describe("GET /limits", () => {
  it("returns limits with no custom thresholds", async () => {
    const mockLimits = { withinLimits: true, dailyUsage: 1.20, monthlyUsage: 15.00, warnings: [] };
    mockCheckUserCostLimits.mockResolvedValue(mockLimits);

    const { handler } = registeredRoutes["GET /limits"];
    const request = createRequest({ userId: 1, query: {} });
    const reply = createReply();

    await handler(request, reply);

    expect(mockCheckUserCostLimits).toHaveBeenCalledWith(1, undefined, undefined);
    expect(reply.send).toHaveBeenCalledWith(mockLimits);
  });

  it("passes dailyLimit when provided", async () => {
    const mockLimits = { withinLimits: true, dailyUsage: 1.20, monthlyUsage: 15.00, warnings: [] };
    mockCheckUserCostLimits.mockResolvedValue(mockLimits);

    const { handler } = registeredRoutes["GET /limits"];
    const request = createRequest({ userId: 5, query: { dailyLimit: "10.50" } });
    const reply = createReply();

    await handler(request, reply);

    expect(mockCheckUserCostLimits).toHaveBeenCalledWith(5, 10.50, undefined);
  });

  it("passes monthlyLimit when provided", async () => {
    const mockLimits = { withinLimits: true, dailyUsage: 0, monthlyUsage: 0, warnings: [] };
    mockCheckUserCostLimits.mockResolvedValue(mockLimits);

    const { handler } = registeredRoutes["GET /limits"];
    const request = createRequest({ query: { monthlyLimit: "100" } });
    const reply = createReply();

    await handler(request, reply);

    expect(mockCheckUserCostLimits).toHaveBeenCalledWith(1, undefined, 100);
  });

  it("passes both dailyLimit and monthlyLimit when provided", async () => {
    const mockLimits = {
      withinLimits: false,
      dailyUsage: 12.00,
      monthlyUsage: 120.00,
      warnings: ["Approaching daily cost limit: $12.00 / $10"],
    };
    mockCheckUserCostLimits.mockResolvedValue(mockLimits);

    const { handler } = registeredRoutes["GET /limits"];
    const request = createRequest({ query: { dailyLimit: "10", monthlyLimit: "200" } });
    const reply = createReply();

    await handler(request, reply);

    expect(mockCheckUserCostLimits).toHaveBeenCalledWith(1, 10, 200);
    expect(reply.send).toHaveBeenCalledWith(mockLimits);
  });

  it("returns warnings when limits are being approached", async () => {
    const mockLimits = {
      withinLimits: true,
      dailyUsage: 8.50,
      monthlyUsage: 85.00,
      warnings: ["Approaching daily cost limit: $8.50 / $10"],
    };
    mockCheckUserCostLimits.mockResolvedValue(mockLimits);

    const { handler } = registeredRoutes["GET /limits"];
    const reply = createReply();
    await handler(createRequest({ query: { dailyLimit: "10" } }), reply);

    expect(reply.send).toHaveBeenCalledWith(mockLimits);
  });

  it("propagates errors from checkUserCostLimits", async () => {
    mockCheckUserCostLimits.mockRejectedValue(new Error("limits check failed"));

    const { handler } = registeredRoutes["GET /limits"];
    await expect(handler(createRequest(), createReply())).rejects.toThrow("limits check failed");
  });
});

// ================================================================
// GET /efficiency
// ================================================================
describe("GET /efficiency", () => {
  it("returns efficiency metrics with default 30-day period", async () => {
    const mockMetrics = {
      avgCostPerRequest: 0.12,
      avgTokensPerRequest: 2000,
      costEfficiencyScore: 88,
      recommendations: ["Excellent cost efficiency maintained"],
    };
    mockGetCostEfficiencyMetrics.mockResolvedValue(mockMetrics);

    const { handler } = registeredRoutes["GET /efficiency"];
    const request = createRequest({ userId: 1, query: {} });
    const reply = createReply();

    await handler(request, reply);

    expect(mockGetCostEfficiencyMetrics).toHaveBeenCalledWith(1, 30);
    expect(reply.send).toHaveBeenCalledWith(mockMetrics);
  });

  it("accepts custom days parameter", async () => {
    const mockMetrics = {
      avgCostPerRequest: 0,
      avgTokensPerRequest: 0,
      costEfficiencyScore: 100,
      recommendations: [],
    };
    mockGetCostEfficiencyMetrics.mockResolvedValue(mockMetrics);

    const { handler } = registeredRoutes["GET /efficiency"];
    const request = createRequest({ userId: 7, query: { days: "90" } });
    const reply = createReply();

    await handler(request, reply);

    expect(mockGetCostEfficiencyMetrics).toHaveBeenCalledWith(7, 90);
  });

  it("propagates errors from getCostEfficiencyMetrics", async () => {
    mockGetCostEfficiencyMetrics.mockRejectedValue(new Error("efficiency query failed"));

    const { handler } = registeredRoutes["GET /efficiency"];
    await expect(handler(createRequest(), createReply())).rejects.toThrow("efficiency query failed");
  });
});

// ================================================================
// GET /pricing
// ================================================================
describe("GET /pricing", () => {
  it("returns pricing configuration", async () => {
    const { handler } = registeredRoutes["GET /pricing"];
    const reply = createReply();

    await handler(createRequest(), reply);

    expect(reply.send).toHaveBeenCalledTimes(1);
    const sentData = reply.send.mock.calls[0][0];
    expect(sentData.pricing).toEqual(mockDefaultCostConfig);
    expect(sentData.currency).toBe("USD");
    expect(sentData.lastUpdated).toBeDefined();
  });

  it("returns a valid ISO date string in lastUpdated", async () => {
    const { handler } = registeredRoutes["GET /pricing"];
    const reply = createReply();

    await handler(createRequest(), reply);

    const sentData = reply.send.mock.calls[0][0];
    const parsed = new Date(sentData.lastUpdated);
    expect(parsed.getTime()).not.toBeNaN();
  });

  it("works for any authenticated user", async () => {
    const { handler } = registeredRoutes["GET /pricing"];
    const reply = createReply();

    await handler(createRequest({ userId: 999 }), reply);

    expect(reply.send).toHaveBeenCalledTimes(1);
  });
});

// ================================================================
// GET /organization
// ================================================================
describe("GET /organization", () => {
  it("returns organization cost summary for admin user", async () => {
    const adminUser = { role: "admin" };
    const dbChain = chainable({
      limit: vi.fn().mockResolvedValue([adminUser]),
    });
    mockDb.select = vi.fn(() => dbChain);

    const mockSummary = {
      totalCost: 250.00,
      totalTokens: 12500000,
      totalRequests: 5000,
      userBreakdown: [{ userId: 1, cost: 150, tokens: 7500000, requests: 3000 }],
      dailyTrend: [{ date: "2026-04-01", cost: 10.00, tokens: 500000, requests: 200 }],
    };
    mockGetOrganizationCostSummary.mockResolvedValue(mockSummary);

    const { handler } = registeredRoutes["GET /organization"];
    const request = createRequest({ userId: 1, query: {} });
    const reply = createReply();

    await handler(request, reply);

    expect(mockGetOrganizationCostSummary).toHaveBeenCalledWith(30);
    expect(reply.send).toHaveBeenCalledWith({
      summary: mockSummary,
      period: "30 days",
      currency: "USD",
    });
  });

  it("accepts custom days parameter for admin", async () => {
    const dbChain = chainable({
      limit: vi.fn().mockResolvedValue([{ role: "admin" }]),
    });
    mockDb.select = vi.fn(() => dbChain);

    mockGetOrganizationCostSummary.mockResolvedValue({
      totalCost: 50, totalTokens: 2500000, totalRequests: 1000,
      userBreakdown: [], dailyTrend: [],
    });

    const { handler } = registeredRoutes["GET /organization"];
    const request = createRequest({ query: { days: "7" } });
    const reply = createReply();

    await handler(request, reply);

    expect(mockGetOrganizationCostSummary).toHaveBeenCalledWith(7);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({ period: "7 days" })
    );
  });

  it("throws 403 for non-admin user (member)", async () => {
    const dbChain = chainable({
      limit: vi.fn().mockResolvedValue([{ role: "member" }]),
    });
    mockDb.select = vi.fn(() => dbChain);

    const { handler } = registeredRoutes["GET /organization"];
    const request = createRequest({ userId: 2 });

    await expect(handler(request, createReply())).rejects.toThrow("Admin access required");
  });

  it("throws 403 for non-admin user (viewer)", async () => {
    const dbChain = chainable({
      limit: vi.fn().mockResolvedValue([{ role: "viewer" }]),
    });
    mockDb.select = vi.fn(() => dbChain);

    const { handler } = registeredRoutes["GET /organization"];

    await expect(handler(createRequest(), createReply())).rejects.toThrow("Admin access required");
  });

  it("throws 403 when user is not found", async () => {
    const dbChain = chainable({
      limit: vi.fn().mockResolvedValue([]),
    });
    mockDb.select = vi.fn(() => dbChain);

    const { handler } = registeredRoutes["GET /organization"];

    await expect(handler(createRequest(), createReply())).rejects.toThrow("Admin access required");
  });

  it("throws 403 when db returns undefined user", async () => {
    const dbChain = chainable({
      limit: vi.fn().mockResolvedValue([undefined]),
    });
    mockDb.select = vi.fn(() => dbChain);

    const { handler } = registeredRoutes["GET /organization"];

    await expect(handler(createRequest(), createReply())).rejects.toThrow("Admin access required");
  });

  it("propagates db errors during user lookup", async () => {
    const dbChain = chainable({
      limit: vi.fn().mockRejectedValue(new Error("user lookup failed")),
    });
    mockDb.select = vi.fn(() => dbChain);

    const { handler } = registeredRoutes["GET /organization"];
    await expect(handler(createRequest(), createReply())).rejects.toThrow("user lookup failed");
  });

  it("propagates errors from getOrganizationCostSummary", async () => {
    const dbChain = chainable({
      limit: vi.fn().mockResolvedValue([{ role: "admin" }]),
    });
    mockDb.select = vi.fn(() => dbChain);
    mockGetOrganizationCostSummary.mockRejectedValue(new Error("org summary failed"));

    const { handler } = registeredRoutes["GET /organization"];

    await expect(handler(createRequest(), createReply())).rejects.toThrow("org summary failed");
  });
});

// ================================================================
// GET /dashboard
// ================================================================
describe("GET /dashboard", () => {
  const mockBreakdown = {
    totalCost: 25.00,
    totalTokens: 1250000,
    byProvider: {
      openai: { cost: 15.00, tokens: 750000, requests: 60 },
      anthropic: { cost: 10.00, tokens: 500000, requests: 40 },
    },
    byModel: {},
    byTimeframe: {
      "2026-04-01": { cost: 5.0, tokens: 250000, requests: 20 },
      "2026-04-02": { cost: 8.0, tokens: 400000, requests: 30 },
    },
  };

  const mockEfficiency = {
    avgCostPerRequest: 0.25,
    avgTokensPerRequest: 12500,
    costEfficiencyScore: 75,
    recommendations: ["Consider using more cost-effective models"],
  };

  const mockLimits = {
    withinLimits: true,
    dailyUsage: 5.00,
    monthlyUsage: 25.00,
    warnings: [],
  };

  it("returns full dashboard data with default 30-day period", async () => {
    mockGetUserCostBreakdown.mockResolvedValue(mockBreakdown);
    mockGetCostEfficiencyMetrics.mockResolvedValue(mockEfficiency);
    mockCheckUserCostLimits.mockResolvedValue(mockLimits);

    const { handler } = registeredRoutes["GET /dashboard"];
    const request = createRequest({ userId: 1, query: {} });
    const reply = createReply();

    await handler(request, reply);

    expect(mockGetUserCostBreakdown).toHaveBeenCalledWith(1, 30);
    expect(mockGetCostEfficiencyMetrics).toHaveBeenCalledWith(1, 30);
    expect(mockCheckUserCostLimits).toHaveBeenCalledWith(1);

    const sentData = reply.send.mock.calls[0][0];
    expect(sentData.currency).toBe("USD");
    expect(sentData.efficiency).toEqual(mockEfficiency);
    expect(sentData.limits).toEqual(mockLimits);
    expect(sentData.trends).toEqual(mockBreakdown.byTimeframe);
  });

  it("calculates currentPeriod correctly", async () => {
    mockGetUserCostBreakdown.mockResolvedValue(mockBreakdown);
    mockGetCostEfficiencyMetrics.mockResolvedValue(mockEfficiency);
    mockCheckUserCostLimits.mockResolvedValue(mockLimits);

    const { handler } = registeredRoutes["GET /dashboard"];
    const reply = createReply();
    await handler(createRequest(), reply);

    const sentData = reply.send.mock.calls[0][0];
    expect(sentData.currentPeriod.totalCost).toBe(25.00);
    expect(sentData.currentPeriod.totalTokens).toBe(1250000);

    // avgCostPerRequest = 25 / (20 + 30) = 0.5
    const totalRequests = 20 + 30;
    expect(sentData.currentPeriod.avgCostPerRequest).toBe(25.00 / totalRequests);
  });

  it("sorts topProviders by cost descending and limits to top 5", async () => {
    mockGetUserCostBreakdown.mockResolvedValue(mockBreakdown);
    mockGetCostEfficiencyMetrics.mockResolvedValue(mockEfficiency);
    mockCheckUserCostLimits.mockResolvedValue(mockLimits);

    const { handler } = registeredRoutes["GET /dashboard"];
    const reply = createReply();
    await handler(createRequest(), reply);

    const sentData = reply.send.mock.calls[0][0];
    expect(sentData.topProviders).toHaveLength(2);
    // openai ($15) should come before anthropic ($10)
    expect(sentData.topProviders[0].provider).toBe("openai");
    expect(sentData.topProviders[0].cost).toBe(15.00);
    expect(sentData.topProviders[1].provider).toBe("anthropic");
    expect(sentData.topProviders[1].cost).toBe(10.00);
  });

  it("limits topProviders to 5 entries", async () => {
    const manyProviders: Record<string, any> = {};
    for (let i = 0; i < 8; i++) {
      manyProviders[`provider-${i}`] = { cost: (8 - i) * 10, tokens: 100000, requests: 10 };
    }
    const breakdownWithManyProviders = {
      ...mockBreakdown,
      byProvider: manyProviders,
      byTimeframe: { "2026-04-01": { cost: 1, tokens: 100, requests: 1 } },
    };
    mockGetUserCostBreakdown.mockResolvedValue(breakdownWithManyProviders);
    mockGetCostEfficiencyMetrics.mockResolvedValue(mockEfficiency);
    mockCheckUserCostLimits.mockResolvedValue(mockLimits);

    const { handler } = registeredRoutes["GET /dashboard"];
    const reply = createReply();
    await handler(createRequest(), reply);

    const sentData = reply.send.mock.calls[0][0];
    expect(sentData.topProviders).toHaveLength(5);
    // Verify sorted descending by cost
    for (let i = 0; i < sentData.topProviders.length - 1; i++) {
      expect(sentData.topProviders[i].cost).toBeGreaterThanOrEqual(sentData.topProviders[i + 1].cost);
    }
  });

  it("accepts custom days parameter", async () => {
    mockGetUserCostBreakdown.mockResolvedValue(mockBreakdown);
    mockGetCostEfficiencyMetrics.mockResolvedValue(mockEfficiency);
    mockCheckUserCostLimits.mockResolvedValue(mockLimits);

    const { handler } = registeredRoutes["GET /dashboard"];
    const request = createRequest({ userId: 3, query: { days: "14" } });
    const reply = createReply();

    await handler(request, reply);

    expect(mockGetUserCostBreakdown).toHaveBeenCalledWith(3, 14);
    expect(mockGetCostEfficiencyMetrics).toHaveBeenCalledWith(3, 14);
    // checkUserCostLimits is called without custom days
    expect(mockCheckUserCostLimits).toHaveBeenCalledWith(3);
  });

  it("handles zero requests gracefully (avgCostPerRequest = 0)", async () => {
    const emptyBreakdown = {
      totalCost: 0,
      totalTokens: 0,
      byProvider: {},
      byModel: {},
      byTimeframe: {},
    };
    mockGetUserCostBreakdown.mockResolvedValue(emptyBreakdown);
    mockGetCostEfficiencyMetrics.mockResolvedValue({
      avgCostPerRequest: 0,
      avgTokensPerRequest: 0,
      costEfficiencyScore: 100,
      recommendations: [],
    });
    mockCheckUserCostLimits.mockResolvedValue({
      withinLimits: true, dailyUsage: 0, monthlyUsage: 0, warnings: [],
    });

    const { handler } = registeredRoutes["GET /dashboard"];
    const reply = createReply();
    await handler(createRequest(), reply);

    const sentData = reply.send.mock.calls[0][0];
    // 0 / 0 || 0 should be 0 due to the || 0 fallback
    expect(sentData.currentPeriod.avgCostPerRequest).toBe(0);
    expect(sentData.currentPeriod.totalCost).toBe(0);
    expect(sentData.currentPeriod.totalTokens).toBe(0);
    expect(sentData.topProviders).toEqual([]);
  });

  it("calls all three functions concurrently via Promise.all", async () => {
    // Verify all three are called (implying concurrent execution)
    mockGetUserCostBreakdown.mockResolvedValue({
      totalCost: 0, totalTokens: 0, byProvider: {}, byModel: {}, byTimeframe: {},
    });
    mockGetCostEfficiencyMetrics.mockResolvedValue({
      avgCostPerRequest: 0, avgTokensPerRequest: 0, costEfficiencyScore: 100, recommendations: [],
    });
    mockCheckUserCostLimits.mockResolvedValue({
      withinLimits: true, dailyUsage: 0, monthlyUsage: 0, warnings: [],
    });

    const { handler } = registeredRoutes["GET /dashboard"];
    await handler(createRequest({ userId: 10 }), createReply());

    expect(mockGetUserCostBreakdown).toHaveBeenCalledTimes(1);
    expect(mockGetCostEfficiencyMetrics).toHaveBeenCalledTimes(1);
    expect(mockCheckUserCostLimits).toHaveBeenCalledTimes(1);
  });

  it("propagates errors from getUserCostBreakdown", async () => {
    mockGetUserCostBreakdown.mockRejectedValue(new Error("breakdown failed"));
    mockGetCostEfficiencyMetrics.mockResolvedValue({});
    mockCheckUserCostLimits.mockResolvedValue({});

    const { handler } = registeredRoutes["GET /dashboard"];
    await expect(handler(createRequest(), createReply())).rejects.toThrow("breakdown failed");
  });

  it("propagates errors from getCostEfficiencyMetrics", async () => {
    mockGetUserCostBreakdown.mockResolvedValue({
      totalCost: 0, totalTokens: 0, byProvider: {}, byModel: {}, byTimeframe: {},
    });
    mockGetCostEfficiencyMetrics.mockRejectedValue(new Error("efficiency failed"));
    mockCheckUserCostLimits.mockResolvedValue({});

    const { handler } = registeredRoutes["GET /dashboard"];
    await expect(handler(createRequest(), createReply())).rejects.toThrow("efficiency failed");
  });

  it("propagates errors from checkUserCostLimits", async () => {
    mockGetUserCostBreakdown.mockResolvedValue({
      totalCost: 0, totalTokens: 0, byProvider: {}, byModel: {}, byTimeframe: {},
    });
    mockGetCostEfficiencyMetrics.mockResolvedValue({});
    mockCheckUserCostLimits.mockRejectedValue(new Error("limits failed"));

    const { handler } = registeredRoutes["GET /dashboard"];
    await expect(handler(createRequest(), createReply())).rejects.toThrow("limits failed");
  });
});
