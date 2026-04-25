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

vi.mock("../../src/db/schema/users.js", () => ({
  users: {
    id: "users.id",
    username: "users.username",
    role: "users.role",
    createdAt: "users.createdAt",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: any[]) => args),
  and: vi.fn((...args: any[]) => args),
  desc: vi.fn((col: any) => col),
  sql: vi.fn((parts: any, ...args: any[]) => parts),
}));

const mockFastifyRequireAuth = vi.fn();

vi.mock("../../src/middleware/fastifyAuth.js", () => ({
  fastifyRequireAuth: (...args: any[]) => mockFastifyRequireAuth(...args),
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

const mockListAvailableProviders = vi.fn();
const mockGetAdapterOrNull = vi.fn();

vi.mock("../../src/adapters/registry.js", () => ({
  listAvailableProviders: (...args: any[]) => mockListAvailableProviders(...args),
  getAdapterOrNull: (...args: any[]) => mockGetAdapterOrNull(...args),
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
  const reply: any = {
    statusCode: 200,
    sent: false,
    code: vi.fn(function (this: any, c: number) {
      this.statusCode = c;
      return this;
    }),
    send: vi.fn(function (this: any, b: any) {
      this.sent = true;
      return b;
    }),
  };
  return reply;
}

// ---- import and register ----

let providerHealthPlugin: any;

beforeEach(async () => {
  vi.clearAllMocks();
  for (const key of Object.keys(registeredRoutes)) {
    delete registeredRoutes[key];
  }

  mockDb.select.mockReturnValue(chainable([]));
  mockFastifyRequireAuth.mockResolvedValue(undefined);
  mockListAvailableProviders.mockReturnValue([]);
  mockGetAdapterOrNull.mockReturnValue(null);

  const mod = await import("../../src/routes/providerHealth.js");
  providerHealthPlugin = mod.default;
  const fastify = createFastifyInstance();
  await providerHealthPlugin(fastify);
});

describe("GET /provider-health", () => {
  it("registers the route with preHandler", () => {
    const route = registeredRoutes["GET /provider-health"];
    expect(route).toBeDefined();
    expect(route.preHandler).toBeDefined();
  });

  it("returns 401 without auth (requireAuth rejects)", async () => {
    // Simulate fastifyRequireAuth sending 401
    mockFastifyRequireAuth.mockImplementation(async (req: any, rep: any) => {
      rep.code(401).send({ error: "Not authenticated" });
      rep.sent = true;
    });

    const route = registeredRoutes["GET /provider-health"];
    const request = createRequest({ userId: undefined });
    const reply = createReply();

    // The preHandler (requireAdmin) calls fastifyRequireAuth, then checks reply.sent
    await route.preHandler!(request, reply);
    expect(reply.code).toHaveBeenCalledWith(401);
    expect(reply.sent).toBe(true);
  });

  it("returns 403 for non-admin users", async () => {
    // fastifyRequireAuth passes, but user is not admin
    mockFastifyRequireAuth.mockResolvedValue(undefined);
    mockDb.select.mockReturnValue(chainable([{ role: "member" }]));

    const route = registeredRoutes["GET /provider-health"];
    const request = createRequest({ userId: 5 });
    const reply = createReply();

    await expect(route.preHandler!(request, reply)).rejects.toThrow("Admin access required");
  });

  it("returns provider health statuses for admin", async () => {
    // Setup admin auth
    mockFastifyRequireAuth.mockResolvedValue(undefined);
    mockDb.select.mockReturnValue(chainable([{ role: "admin" }]));

    // Setup providers
    mockListAvailableProviders.mockReturnValue(["openai", "anthropic", "groq"]);
    mockGetAdapterOrNull.mockImplementation((name: string) => {
      if (name === "openai" || name === "anthropic") return { name };
      return null; // groq not registered
    });

    const route = registeredRoutes["GET /provider-health"];
    const request = createRequest({ userId: 1 });
    const reply = createReply();

    // First run preHandler (requireAdmin) successfully
    // For the actual test we call handler directly since admin check passes
    const result = await route.handler(request, reply);
    const sent = reply.send.mock.calls[0][0];

    expect(sent.providers).toHaveLength(3);
    expect(sent.totalRegistered).toBe(3);
    expect(sent.timestamp).toBeDefined();

    // openai and anthropic are registered and available
    const openai = sent.providers.find((p: any) => p.provider === "openai");
    expect(openai.registered).toBe(true);
    expect(openai.available).toBe(true);
    expect(openai.circuitState).toBe("closed");

    // groq is not registered
    const groq = sent.providers.find((p: any) => p.provider === "groq");
    expect(groq.registered).toBe(false);
    expect(groq.available).toBe(false);
    expect(groq.circuitState).toBe("unknown");
  });

  it("returns empty providers array when none registered", async () => {
    mockListAvailableProviders.mockReturnValue([]);

    const route = registeredRoutes["GET /provider-health"];
    const request = createRequest({ userId: 1 });
    const reply = createReply();

    await route.handler(request, reply);
    const sent = reply.send.mock.calls[0][0];
    expect(sent.providers).toHaveLength(0);
    expect(sent.totalRegistered).toBe(0);
  });
});
