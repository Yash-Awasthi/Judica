import { describe, it, expect, vi, beforeEach } from "vitest";

// ---- mocks ----

const mockEvaluateCouncilSession = vi.fn();
const mockGetUserEvaluationMetrics = vi.fn();
const mockBenchmarkCouncilPerformance = vi.fn();

vi.mock("../../src/lib/evaluation.js", () => ({
  evaluateCouncilSession: (...args: any[]) => mockEvaluateCouncilSession(...args),
  getUserEvaluationMetrics: (...args: any[]) => mockGetUserEvaluationMetrics(...args),
  benchmarkCouncilPerformance: (...args: any[]) => mockBenchmarkCouncilPerformance(...args),
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

const registeredRoutes: Record<string, { handler: Function; preHandler?: Function | Function[] }> = {};

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

function createRequest(overrides: Partial<{ userId: number; body: any; params: any; query: any; headers: Record<string, string> }> = {}): any {
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
    send: vi.fn(function (this: any, _b: any) {
      return this;
    }),
  };
  return reply;
}

// ---- import and register the plugin ----

let evaluationPlugin: any;

beforeEach(async () => {
  vi.clearAllMocks();
  for (const key of Object.keys(registeredRoutes)) delete registeredRoutes[key];

  const mod = await import("../../src/routes/evaluation.js");
  evaluationPlugin = mod.default;
  const fastify = createFastifyInstance();
  await evaluationPlugin(fastify);
});

// ---- sample data ----

const sampleAgentOutputs = [
  {
    name: "architect",
    answer: "This is a well-structured answer from the architect agent.",
    reasoning: "The reasoning behind the answer involves systems thinking.",
    key_points: ["Modularity is key", "Scalable design patterns"],
    assumptions: ["Standard deployment environment"],
    confidence: 0.85,
  },
  {
    name: "contrarian",
    answer: "This is a contrarian perspective that challenges assumptions.",
    reasoning: "The reasoning from the contrarian highlights potential flaws.",
    key_points: ["Potential bottleneck identified", "Alternative approach exists"],
    assumptions: ["High traffic scenario"],
    confidence: 0.72,
  },
];

const sampleEvaluationResult = {
  sessionId: "sess-123",
  conversationId: "conv-456",
  userId: 1,
  criteria: {
    coherence: 0.8,
    consensus: 0.75,
    diversity: 0.9,
    quality: 0.85,
    efficiency: 0.7,
  },
  overallScore: 80.5,
  recommendations: ["Increase council diversity"],
  strengths: ["High coherence"],
  weaknesses: ["Low efficiency"],
  timestamp: new Date(),
};

const sampleMetrics = {
  averageConsensus: 0.8,
  averageDiversity: 0.75,
  averageQuality: 0.85,
  averageEfficiency: 0.7,
  totalEvaluations: 42,
  improvementTrend: 0.05,
  userSatisfaction: 4.2,
};

const sampleBenchmark = {
  averageLatency: 1200,
  averageTokens: 3500,
  averageScore: 78,
};

// ---- route registration ----

describe("evaluation plugin registration", () => {
  it("registers all four routes", () => {
    expect(registeredRoutes["POST /session"]).toBeDefined();
    expect(registeredRoutes["GET /metrics"]).toBeDefined();
    expect(registeredRoutes["GET /benchmark"]).toBeDefined();
    expect(registeredRoutes["GET /dashboard"]).toBeDefined();
  });

  it("attaches preHandler auth to all routes", () => {
    for (const key of Object.keys(registeredRoutes)) {
      expect(registeredRoutes[key].preHandler).toBeDefined();
    }
  });
});

// ---- POST /session ----

describe("POST /session", () => {
  const getHandler = () => registeredRoutes["POST /session"].handler;

  it("returns evaluation result on success", async () => {
    mockEvaluateCouncilSession.mockResolvedValue(sampleEvaluationResult);

    const req = createRequest({
      body: {
        sessionId: "sess-123",
        conversationId: "conv-456",
        agentOutputs: sampleAgentOutputs,
        totalTokens: 5000,
        duration: 3000,
        userFeedback: 4,
      },
      userId: 1,
    });
    const reply = createReply();
    const result = await getHandler()(req, reply);

    expect(result).toEqual({
      success: true,
      evaluation: sampleEvaluationResult,
    });
    expect(mockEvaluateCouncilSession).toHaveBeenCalledWith(
      "sess-123",
      "conv-456",
      1,
      sampleAgentOutputs,
      5000,
      3000,
      4,
    );
  });

  it("passes undefined userFeedback when not provided", async () => {
    mockEvaluateCouncilSession.mockResolvedValue(sampleEvaluationResult);

    const req = createRequest({
      body: {
        sessionId: "sess-123",
        conversationId: "conv-456",
        agentOutputs: sampleAgentOutputs,
        totalTokens: 5000,
        duration: 3000,
      },
    });
    const reply = createReply();
    await getHandler()(req, reply);

    expect(mockEvaluateCouncilSession).toHaveBeenCalledWith(
      "sess-123",
      "conv-456",
      1,
      sampleAgentOutputs,
      5000,
      3000,
      undefined,
    );
  });

  it("throws AppError 400 when sessionId is missing", async () => {
    const req = createRequest({
      body: {
        conversationId: "conv-456",
        agentOutputs: sampleAgentOutputs,
        totalTokens: 5000,
        duration: 3000,
      },
    });
    const reply = createReply();

    await expect(getHandler()(req, reply)).rejects.toThrow(
      "Missing required fields: sessionId, conversationId, agentOutputs, totalTokens, duration",
    );
  });

  it("throws AppError 400 when conversationId is missing", async () => {
    const req = createRequest({
      body: {
        sessionId: "sess-123",
        agentOutputs: sampleAgentOutputs,
        totalTokens: 5000,
        duration: 3000,
      },
    });
    const reply = createReply();

    await expect(getHandler()(req, reply)).rejects.toThrow(
      "Missing required fields",
    );
  });

  it("throws AppError 400 when agentOutputs is missing", async () => {
    const req = createRequest({
      body: {
        sessionId: "sess-123",
        conversationId: "conv-456",
        totalTokens: 5000,
        duration: 3000,
      },
    });
    const reply = createReply();

    await expect(getHandler()(req, reply)).rejects.toThrow(
      "Missing required fields",
    );
  });

  it("throws AppError 400 when totalTokens is missing", async () => {
    const req = createRequest({
      body: {
        sessionId: "sess-123",
        conversationId: "conv-456",
        agentOutputs: sampleAgentOutputs,
        duration: 3000,
      },
    });
    const reply = createReply();

    await expect(getHandler()(req, reply)).rejects.toThrow(
      "Missing required fields",
    );
  });

  it("throws AppError 400 when duration is missing", async () => {
    const req = createRequest({
      body: {
        sessionId: "sess-123",
        conversationId: "conv-456",
        agentOutputs: sampleAgentOutputs,
        totalTokens: 5000,
      },
    });
    const reply = createReply();

    await expect(getHandler()(req, reply)).rejects.toThrow(
      "Missing required fields",
    );
  });

  it("throws AppError 400 when body is completely empty", async () => {
    const req = createRequest({ body: {} });
    const reply = createReply();

    await expect(getHandler()(req, reply)).rejects.toThrow(
      "Missing required fields",
    );
  });

  it("throws AppError with statusCode 400", async () => {
    const req = createRequest({ body: {} });
    const reply = createReply();

    try {
      await getHandler()(req, reply);
      expect.fail("should have thrown");
    } catch (err: any) {
      expect(err.statusCode).toBe(400);
    }
  });

  it("propagates errors from evaluateCouncilSession", async () => {
    mockEvaluateCouncilSession.mockRejectedValue(new Error("DB failure"));

    const req = createRequest({
      body: {
        sessionId: "sess-123",
        conversationId: "conv-456",
        agentOutputs: sampleAgentOutputs,
        totalTokens: 5000,
        duration: 3000,
      },
    });
    const reply = createReply();

    await expect(getHandler()(req, reply)).rejects.toThrow("DB failure");
  });
});

// ---- GET /metrics ----

describe("GET /metrics", () => {
  const getHandler = () => registeredRoutes["GET /metrics"].handler;

  it("returns metrics with default days=30", async () => {
    mockGetUserEvaluationMetrics.mockResolvedValue(sampleMetrics);

    const req = createRequest({ query: {} });
    const reply = createReply();
    const result = await getHandler()(req, reply);

    expect(result).toEqual({
      metrics: sampleMetrics,
      period: "30 days",
    });
    expect(mockGetUserEvaluationMetrics).toHaveBeenCalledWith(1, 30);
  });

  it("accepts custom days parameter", async () => {
    mockGetUserEvaluationMetrics.mockResolvedValue(sampleMetrics);

    const req = createRequest({ query: { days: "7" } });
    const reply = createReply();
    const result = await getHandler()(req, reply);

    expect(result).toEqual({
      metrics: sampleMetrics,
      period: "7 days",
    });
    expect(mockGetUserEvaluationMetrics).toHaveBeenCalledWith(1, 7);
  });

  it("passes the correct userId", async () => {
    mockGetUserEvaluationMetrics.mockResolvedValue(sampleMetrics);

    const req = createRequest({ userId: 99, query: {} });
    const reply = createReply();
    await getHandler()(req, reply);

    expect(mockGetUserEvaluationMetrics).toHaveBeenCalledWith(99, 30);
  });

  it("propagates errors from getUserEvaluationMetrics", async () => {
    mockGetUserEvaluationMetrics.mockRejectedValue(new Error("metrics error"));

    const req = createRequest({ query: {} });
    const reply = createReply();

    await expect(getHandler()(req, reply)).rejects.toThrow("metrics error");
  });
});

// ---- GET /benchmark ----

describe("GET /benchmark", () => {
  const getHandler = () => registeredRoutes["GET /benchmark"].handler;

  it("returns benchmark with defaults (councilSize=3, queryComplexity=moderate)", async () => {
    mockBenchmarkCouncilPerformance.mockResolvedValue(sampleBenchmark);

    const req = createRequest({ query: {} });
    const reply = createReply();
    const result = await getHandler()(req, reply);

    expect(result).toEqual({
      benchmark: sampleBenchmark,
      councilSize: 3,
      queryComplexity: "moderate",
    });
    expect(mockBenchmarkCouncilPerformance).toHaveBeenCalledWith(1, 3, "moderate");
  });

  it("accepts custom councilSize", async () => {
    mockBenchmarkCouncilPerformance.mockResolvedValue(sampleBenchmark);

    const req = createRequest({ query: { councilSize: "5" } });
    const reply = createReply();
    const result = await getHandler()(req, reply);

    expect(result).toEqual({
      benchmark: sampleBenchmark,
      councilSize: "5",
      queryComplexity: "moderate",
    });
    expect(mockBenchmarkCouncilPerformance).toHaveBeenCalledWith(1, 5, "moderate");
  });

  it("accepts custom queryComplexity", async () => {
    mockBenchmarkCouncilPerformance.mockResolvedValue(sampleBenchmark);

    const req = createRequest({ query: { queryComplexity: "complex" } });
    const reply = createReply();
    const result = await getHandler()(req, reply);

    expect(result).toEqual({
      benchmark: sampleBenchmark,
      councilSize: 3,
      queryComplexity: "complex",
    });
    expect(mockBenchmarkCouncilPerformance).toHaveBeenCalledWith(1, 3, "complex");
  });

  it("accepts both custom councilSize and queryComplexity", async () => {
    mockBenchmarkCouncilPerformance.mockResolvedValue(sampleBenchmark);

    const req = createRequest({ query: { councilSize: "7", queryComplexity: "simple" } });
    const reply = createReply();
    const result = await getHandler()(req, reply);

    expect(result).toEqual({
      benchmark: sampleBenchmark,
      councilSize: "7",
      queryComplexity: "simple",
    });
    expect(mockBenchmarkCouncilPerformance).toHaveBeenCalledWith(1, 7, "simple");
  });

  it("passes the correct userId", async () => {
    mockBenchmarkCouncilPerformance.mockResolvedValue(sampleBenchmark);

    const req = createRequest({ userId: 42, query: {} });
    const reply = createReply();
    await getHandler()(req, reply);

    expect(mockBenchmarkCouncilPerformance).toHaveBeenCalledWith(42, 3, "moderate");
  });

  it("propagates errors from benchmarkCouncilPerformance", async () => {
    mockBenchmarkCouncilPerformance.mockRejectedValue(new Error("benchmark error"));

    const req = createRequest({ query: {} });
    const reply = createReply();

    await expect(getHandler()(req, reply)).rejects.toThrow("benchmark error");
  });
});

// ---- GET /dashboard ----

describe("GET /dashboard", () => {
  const getHandler = () => registeredRoutes["GET /dashboard"].handler;

  it("returns combined dashboard data with default days=30", async () => {
    mockGetUserEvaluationMetrics.mockResolvedValue(sampleMetrics);
    mockBenchmarkCouncilPerformance.mockResolvedValue(sampleBenchmark);

    const req = createRequest({ query: {} });
    const reply = createReply();
    const result = await getHandler()(req, reply);

    const expectedOverall =
      sampleMetrics.averageConsensus * 25 +
      sampleMetrics.averageQuality * 25 +
      sampleMetrics.averageDiversity * 25 +
      sampleMetrics.averageEfficiency * 25;

    expect(result).toEqual({
      currentPerformance: {
        overallScore: expectedOverall,
        consensus: sampleMetrics.averageConsensus,
        quality: sampleMetrics.averageQuality,
        diversity: sampleMetrics.averageDiversity,
        efficiency: sampleMetrics.averageEfficiency,
        trend: sampleMetrics.improvementTrend,
      },
      benchmark: sampleBenchmark,
      totalEvaluations: sampleMetrics.totalEvaluations,
      period: "30 days",
    });
  });

  it("accepts custom days parameter", async () => {
    mockGetUserEvaluationMetrics.mockResolvedValue(sampleMetrics);
    mockBenchmarkCouncilPerformance.mockResolvedValue(sampleBenchmark);

    const req = createRequest({ query: { days: "14" } });
    const reply = createReply();
    const result = await getHandler()(req, reply);

    expect(mockGetUserEvaluationMetrics).toHaveBeenCalledWith(1, 14);
    expect(result.period).toBe("14 days");
  });

  it("calls benchmarkCouncilPerformance with defaults (3, moderate)", async () => {
    mockGetUserEvaluationMetrics.mockResolvedValue(sampleMetrics);
    mockBenchmarkCouncilPerformance.mockResolvedValue(sampleBenchmark);

    const req = createRequest({ query: {} });
    const reply = createReply();
    await getHandler()(req, reply);

    expect(mockBenchmarkCouncilPerformance).toHaveBeenCalledWith(1, 3, "moderate");
  });

  it("calls both data sources in parallel", async () => {
    const callOrder: string[] = [];

    mockGetUserEvaluationMetrics.mockImplementation(async () => {
      callOrder.push("metrics-start");
      await new Promise((r) => setTimeout(r, 10));
      callOrder.push("metrics-end");
      return sampleMetrics;
    });
    mockBenchmarkCouncilPerformance.mockImplementation(async () => {
      callOrder.push("benchmark-start");
      await new Promise((r) => setTimeout(r, 10));
      callOrder.push("benchmark-end");
      return sampleBenchmark;
    });

    const req = createRequest({ query: {} });
    const reply = createReply();
    await getHandler()(req, reply);

    // Both should start before either ends (Promise.all)
    expect(callOrder.indexOf("metrics-start")).toBeLessThan(callOrder.indexOf("metrics-end"));
    expect(callOrder.indexOf("benchmark-start")).toBeLessThan(callOrder.indexOf("benchmark-end"));
    expect(mockGetUserEvaluationMetrics).toHaveBeenCalledTimes(1);
    expect(mockBenchmarkCouncilPerformance).toHaveBeenCalledTimes(1);
  });

  it("computes overallScore correctly", async () => {
    const customMetrics = {
      averageConsensus: 1.0,
      averageDiversity: 0.5,
      averageQuality: 0.0,
      averageEfficiency: 0.2,
      totalEvaluations: 10,
      improvementTrend: -0.1,
      userSatisfaction: 3.0,
    };
    mockGetUserEvaluationMetrics.mockResolvedValue(customMetrics);
    mockBenchmarkCouncilPerformance.mockResolvedValue(sampleBenchmark);

    const req = createRequest({ query: {} });
    const reply = createReply();
    const result = await getHandler()(req, reply);

    // 1.0*25 + 0.0*25 + 0.5*25 + 0.2*25 = 25 + 0 + 12.5 + 5 = 42.5
    expect(result.currentPerformance.overallScore).toBe(42.5);
  });

  it("passes correct userId", async () => {
    mockGetUserEvaluationMetrics.mockResolvedValue(sampleMetrics);
    mockBenchmarkCouncilPerformance.mockResolvedValue(sampleBenchmark);

    const req = createRequest({ userId: 77, query: {} });
    const reply = createReply();
    await getHandler()(req, reply);

    expect(mockGetUserEvaluationMetrics).toHaveBeenCalledWith(77, 30);
    expect(mockBenchmarkCouncilPerformance).toHaveBeenCalledWith(77, 3, "moderate");
  });

  it("propagates errors from getUserEvaluationMetrics", async () => {
    mockGetUserEvaluationMetrics.mockRejectedValue(new Error("metrics fail"));
    mockBenchmarkCouncilPerformance.mockResolvedValue(sampleBenchmark);

    const req = createRequest({ query: {} });
    const reply = createReply();

    await expect(getHandler()(req, reply)).rejects.toThrow("metrics fail");
  });

  it("propagates errors from benchmarkCouncilPerformance", async () => {
    mockGetUserEvaluationMetrics.mockResolvedValue(sampleMetrics);
    mockBenchmarkCouncilPerformance.mockRejectedValue(new Error("bench fail"));

    const req = createRequest({ query: {} });
    const reply = createReply();

    await expect(getHandler()(req, reply)).rejects.toThrow("bench fail");
  });
});
