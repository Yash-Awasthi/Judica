import { describe, it, expect, vi, beforeEach } from "vitest";

// ---- mocks ----

const mockDb: any = {
  select: vi.fn(),
};

function chainable(results: any = []): any {
  const chain: any = {};
  const methods = [
    "select", "from", "where", "limit", "orderBy", "update", "set",
    "insert", "values", "returning", "delete", "innerJoin",
    "leftJoin", "groupBy", "offset",
  ];
  for (const m of methods) {
    chain[m] = vi.fn(() => chain);
  }
  chain.then = (onRes: any) => Promise.resolve(results).then(onRes);
  return chain;
}

vi.mock("../../src/lib/drizzle.js", () => ({
  db: mockDb,
}));

vi.mock("../../src/db/schema/traces.js", () => ({
  traces: {
    id: "traces.id",
    conversationId: "traces.conversationId",
    userId: "traces.userId",
    type: "traces.type",
    steps: "traces.steps",
    totalLatencyMs: "traces.totalLatencyMs",
    totalTokens: "traces.totalTokens",
    totalCostUsd: "traces.totalCostUsd",
    createdAt: "traces.createdAt",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: any[]) => args),
  and: vi.fn((...args: any[]) => args),
  desc: vi.fn((col: any) => col),
  sql: vi.fn((parts: any, ...args: any[]) => parts),
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

// ---- helpers ----

const registeredRoutes: Record<string, { handler: Function; preHandler?: Function }> = {};

function createFastifyInstance(): any {
  const register = (method: string) =>
    vi.fn((path: string, opts: any, handler?: Function) => {
      const h = handler ?? opts;
      const pre = handler ? opts?.preHandler : undefined;
      registeredRoutes[`${method.toUpperCase()} ${path}`] = { handler: h, preHandler: pre };
    });

  return {
    register: vi.fn().mockResolvedValue(undefined),
    addHook: vi.fn().mockReturnThis(),
    get: register("GET"),
    post: register("POST"),
    put: register("PUT"),
    delete: register("DELETE"),
  };
}

function createRequest(overrides: any = {}): any {
  return {
    params: {},
    body: {},
    query: {},
    userId: 1,
    headers: { authorization: "Bearer token" },
    ...overrides,
  };
}

function createReply(): any {
  let sentData: any;
  const reply: any = {
    statusCode: 200,
    code: vi.fn(function (this: any, c: number) {
      this.statusCode = c;
      return this;
    }),
    send: vi.fn(function (this: any, b: any) {
      sentData = b;
      return b;
    }),
  };
  reply._getSent = () => sentData;
  return reply;
}

// ---- import and register the plugin ----

let deliberationsPlugin: any;

beforeEach(async () => {
  vi.clearAllMocks();
  for (const key of Object.keys(registeredRoutes)) {
    delete registeredRoutes[key];
  }

  mockDb.select.mockReturnValue(chainable([]));

  const mod = await import("../../src/routes/deliberations.js");
  deliberationsPlugin = mod.default;
  const fastify = createFastifyInstance();
  await deliberationsPlugin(fastify);
});

// ================================================================
// GET /:id/scoring
// ================================================================
describe("GET /:id/scoring", () => {
  it("returns 401 without auth (preHandler is fastifyRequireAuth)", () => {
    const route = registeredRoutes["GET /:id/scoring"];
    expect(route).toBeDefined();
    expect(route.preHandler).toBeDefined();
  });

  it("returns 404 when trace not found", async () => {
    mockDb.select.mockReturnValue(chainable([]));

    const { handler } = registeredRoutes["GET /:id/scoring"];
    const request = createRequest({ params: { id: "nonexistent" }, userId: 1 });
    const reply = createReply();
    await expect(handler(request, reply)).rejects.toThrow("Deliberation not found");
  });

  it("returns scoring breakdown for valid trace", async () => {
    const trace = {
      id: "trace-1",
      userId: 1,
      type: "deliberation",
      payload: {
        scoredOpinions: [
          {
            name: "GPT-4",
            scores: {
              confidence: 0.9,
              agreement: 0.85,
              peerRanking: 0.7,
              validationPenalty: 0,
              adversarialPenalty: -0.1,
              groundingPenalty: 0,
              final: 0.78,
            },
          },
          {
            name: "Claude",
            scores: {
              confidence: 0.8,
              agreement: 0.9,
              peerRanking: 0.6,
              validationPenalty: -0.05,
              adversarialPenalty: 0,
              groundingPenalty: 0,
              final: 0.72,
            },
          },
        ],
        consensusReached: true,
        consensusScore: 0.85,
      },
      createdAt: new Date(),
    };
    mockDb.select.mockReturnValue(chainable([trace]));

    const { handler } = registeredRoutes["GET /:id/scoring"];
    const request = createRequest({ params: { id: "trace-1" }, userId: 1 });
    const reply = createReply();
    const result = await handler(request, reply);

    expect(reply.send).toHaveBeenCalled();
    const sent = reply.send.mock.calls[0][0];
    expect(sent.deliberationId).toBe("trace-1");
    expect(sent.members).toHaveLength(2);
    expect(sent.members[0].name).toBe("GPT-4");
    expect(sent.members[0].finalScore).toBe(0.78);
    expect(sent.members[0].agreement).toBe(0.85);
    expect(sent.consensus.reached).toBe(true);
    expect(sent.consensus.score).toBe(0.85);
    expect(sent.scoringWeights).toBeDefined();
  });

  it("handles missing scored opinions gracefully", async () => {
    const trace = {
      id: "trace-2",
      userId: 1,
      type: "deliberation",
      payload: {
        // No scoredOpinions or scored field
        consensusReached: false,
      },
      createdAt: new Date(),
    };
    mockDb.select.mockReturnValue(chainable([trace]));

    const { handler } = registeredRoutes["GET /:id/scoring"];
    const request = createRequest({ params: { id: "trace-2" }, userId: 1 });
    const reply = createReply();
    await handler(request, reply);

    const sent = reply.send.mock.calls[0][0];
    expect(sent.members).toHaveLength(0);
    expect(sent.consensus.reached).toBe(false);
    expect(sent.consensus.score).toBeNull();
  });

  it("handles trace with null payload gracefully", async () => {
    const trace = {
      id: "trace-3",
      userId: 1,
      type: "deliberation",
      createdAt: new Date(),
      // No payload field
    };
    mockDb.select.mockReturnValue(chainable([trace]));

    const { handler } = registeredRoutes["GET /:id/scoring"];
    const request = createRequest({ params: { id: "trace-3" }, userId: 1 });
    const reply = createReply();
    await handler(request, reply);

    const sent = reply.send.mock.calls[0][0];
    expect(sent.members).toHaveLength(0);
    expect(sent.consensus.reached).toBeNull();
    expect(sent.consensus.score).toBeNull();
  });
});

// ================================================================
// GET /:id/replay
// ================================================================
describe("GET /:id/replay", () => {
  it("returns 404 when trace not found", async () => {
    mockDb.select.mockReturnValue(chainable([]));

    const { handler } = registeredRoutes["GET /:id/replay"];
    const request = createRequest({ params: { id: "missing" }, userId: 1 });
    const reply = createReply();
    await expect(handler(request, reply)).rejects.toThrow("Deliberation not found");
  });

  it("returns correct timeline structure", async () => {
    const trace = {
      id: "trace-replay-1",
      userId: 1,
      type: "deliberation",
      createdAt: new Date("2025-01-01"),
      payload: {
        opinions: [
          { name: "GPT-4", opinion: "I think X is the answer." },
          { name: "Claude", opinion: "I agree with X." },
        ],
        peerReviews: [
          { reviewer: "GPT-4", reviewed: "Claude", score: 0.8 },
        ],
        scoredOpinions: [
          { name: "GPT-4", scores: { final: 0.9 } },
          { name: "Claude", scores: { final: 0.85 } },
        ],
        consensusReached: true,
        consensusScore: 0.87,
        round: 2,
        verdict: "X is the consensus answer.",
      },
    };
    mockDb.select.mockReturnValue(chainable([trace]));

    const { handler } = registeredRoutes["GET /:id/replay"];
    const request = createRequest({ params: { id: "trace-replay-1" }, userId: 1 });
    const reply = createReply();
    await handler(request, reply);

    const sent = reply.send.mock.calls[0][0];
    expect(sent.deliberationId).toBe("trace-replay-1");
    expect(sent.type).toBe("deliberation");
    expect(sent.timeline).toBeInstanceOf(Array);

    const phases = sent.timeline.map((t: any) => t.phase);
    expect(phases).toContain("gather_opinions");
    expect(phases).toContain("peer_review");
    expect(phases).toContain("scoring");
    expect(phases).toContain("consensus_check");
    expect(phases).toContain("synthesis");

    expect(sent.metadata.totalPhases).toBe(5);
    expect(sent.metadata.memberCount).toBe(2);
  });

  it("handles missing phases gracefully", async () => {
    const trace = {
      id: "trace-replay-2",
      userId: 1,
      type: "deliberation",
      createdAt: new Date("2025-01-01"),
      payload: {
        // Only opinions, no peer reviews, no scoring, no consensus
        opinions: [
          { name: "GPT-4", opinion: "Just one opinion." },
        ],
      },
    };
    mockDb.select.mockReturnValue(chainable([trace]));

    const { handler } = registeredRoutes["GET /:id/replay"];
    const request = createRequest({ params: { id: "trace-replay-2" }, userId: 1 });
    const reply = createReply();
    await handler(request, reply);

    const sent = reply.send.mock.calls[0][0];
    expect(sent.timeline).toHaveLength(1);
    expect(sent.timeline[0].phase).toBe("gather_opinions");
    expect(sent.metadata.totalPhases).toBe(1);
    expect(sent.metadata.memberCount).toBe(1);
  });

  it("truncates long opinions to 500 chars", async () => {
    const longOpinion = "a".repeat(1000);
    const trace = {
      id: "trace-replay-3",
      userId: 1,
      type: "deliberation",
      createdAt: new Date(),
      payload: {
        opinions: [{ name: "GPT-4", opinion: longOpinion }],
      },
    };
    mockDb.select.mockReturnValue(chainable([trace]));

    const { handler } = registeredRoutes["GET /:id/replay"];
    const request = createRequest({ params: { id: "trace-replay-3" }, userId: 1 });
    const reply = createReply();
    await handler(request, reply);

    const sent = reply.send.mock.calls[0][0];
    const opinionData = sent.timeline[0].data[0];
    expect(opinionData.opinion.length).toBe(500);
  });
});

describe("route registration", () => {
  it("registers scoring and replay routes", () => {
    expect(registeredRoutes["GET /:id/scoring"]).toBeDefined();
    expect(registeredRoutes["GET /:id/replay"]).toBeDefined();
  });
});
