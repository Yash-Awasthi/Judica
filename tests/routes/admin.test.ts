import { describe, it, expect, vi, beforeEach } from "vitest";

// ---- mocks ----

const mockDb: any = {
  select: vi.fn(),
  update: vi.fn(),
  insert: vi.fn(),
  delete: vi.fn(),
};

function chainable(results: any = []): any {
  const chain: any = {};
  const methods = [
    "select", "from", "where", "limit", "orderBy", "update", "set",
    "insert", "values", "returning", "delete", "innerJoin",
    "leftJoin", "groupBy", "offset", "onConflictDoUpdate"
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
  users: { id: "users.id", username: "users.username", role: "users.role", createdAt: "users.createdAt" },
  usageLogs: { userId: "usageLogs.userId", promptTokens: "usageLogs.promptTokens", completionTokens: "usageLogs.completionTokens" }
}));

vi.mock("../../src/db/schema/social.js", () => ({
  sharedConversations: { id: "sc.id" },
}));

vi.mock("../../src/db/schema/conversations.js", () => ({
  conversations: { id: "conversations.id" },
  chats: { id: "chats.id" },
}));

vi.mock("../../src/db/schema/council.js", () => ({
  customProviders: { id: "cp.id", name: "cp.name", baseUrl: "cp.baseUrl", authKey: "cp.authKey", models: "cp.models" },
}));

vi.mock("../../src/db/schema/memory.js", () => ({
  memoryBackends: { id: "mb.id", config: "mb.config" },
}));

vi.mock("../../src/db/schema/admin.js", () => ({
  systemConfigs: { key: "sc.key", value: "sc.value" },
  orgGroups: { id: "g.id", name: "g.name", description: "g.description", createdAt: "g.createdAt" },
  orgGroupMemberships: { groupId: "gm.groupId", userId: "gm.userId" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: any[]) => args),
  and: vi.fn((...args: any[]) => args),
  desc: vi.fn((col: any) => col),
  count: vi.fn(() => "count"),
  sql: vi.fn((parts: any, ...args: any[]) => parts),
  ilike: vi.fn((...args: any[]) => args),
  or: vi.fn((...args: any[]) => args),
}));

vi.mock("../../src/middleware/fastifyAuth.js", () => ({
  fastifyRequireAuth: vi.fn(),
  fastifyRequireAdmin: vi.fn(),
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

vi.mock("../../src/lib/redis.js", () => ({
  default: {
    set: vi.fn(),
    get: vi.fn(),
    del: vi.fn(),
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
    addHook: vi.fn().mockReturnThis(),
    get: register("GET"),
    post: register("POST"),
    put: register("PUT"),
    patch: register("PATCH"),
    delete: register("DELETE"),
  };
}

function createRequest(overrides: any = {}) {
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

let adminPlugin: any;

beforeEach(async () => {
  vi.clearAllMocks();
  // Clear registered routes
  for (const key of Object.keys(registeredRoutes)) {
    delete registeredRoutes[key];
  }

  // Set default mock returns
  mockDb.select.mockReturnValue(chainable([]));
  mockDb.update.mockReturnValue(chainable([]));
  mockDb.insert.mockReturnValue(chainable([]));
  mockDb.delete.mockReturnValue(chainable([]));

  // Re-import to register routes fresh
  const mod = await import("../../src/routes/admin.js");
  adminPlugin = mod.default;
  const fastify = createFastifyInstance();
  await adminPlugin(fastify);
});

// ================================================================
// GET /users
// ================================================================
describe("GET /users", () => {
  it("returns list of all users", async () => {
    const mockUsers = [
      { id: 1, email: "a@b.com", username: "alice", role: "admin", createdAt: new Date() },
      { id: 2, email: "c@d.com", username: "bob", role: "member", createdAt: new Date() },
    ];

    mockDb.select.mockReturnValue(chainable(mockUsers));

    const { handler } = registeredRoutes["GET /users"];
    const result = await handler(createRequest(), createReply());
    expect(result.users).toHaveLength(2);
    expect(result.users[0].username).toBe("alice");
  });

  it("propagates db errors", async () => {
      mockDb.select.mockImplementation(() => {
      throw new Error("db down");
    });

    const { handler } = registeredRoutes["GET /users"];
    await expect(handler(createRequest(), createReply())).rejects.toThrow("db down");
  });
});

// ================================================================
// PUT /users/:id/role
// ================================================================
describe("PUT /users/:id/role", () => {
  it("updates role successfully", async () => {
    const updatedUser = { id: 5, email: "u@v.com", role: "viewer" };
    mockDb.select.mockReturnValue(chainable([{ id: 5, email: "u@v.com", role: "viewer" }]));
    mockDb.update.mockReturnValue(chainable([{ id: 5, role: "viewer" }]));

    const { handler } = registeredRoutes["PUT /users/:id/role"];
    const request = createRequest({ body: { role: "viewer" }, params: { id: "5" } });
    const result = await handler(request, createReply());
    expect(result).toEqual({ success: true, role: "viewer" });
  });

  it("throws AppError for invalid role", async () => {
    const { handler } = registeredRoutes["PUT /users/:id/role"];
    const request = createRequest({ body: { role: "superuser" }, params: { id: "1" } });

    await expect(handler(request, createReply())).rejects.toThrow("Role must be: admin, member, viewer");
  });
});

// ================================================================
// POST /groups
// ================================================================
describe("POST /groups", () => {
  it("creates group successfully and returns 201", async () => {
    const createdGroup = { id: "uuid-1", name: "Engineering" };
    mockDb.insert.mockReturnValue(chainable([createdGroup]));

    const { handler } = registeredRoutes["POST /groups"];
    const reply = createReply();
    const request = createRequest({ body: { name: "Engineering" } });

    const result = await handler(request, reply);
    expect(result).toEqual({ success: true, group: createdGroup });
    expect(reply.code).toHaveBeenCalledWith(201);
  });
});

// ================================================================
// GET /groups
// ================================================================
describe("GET /groups", () => {
  it("returns list of groups", async () => {
    mockDb.select.mockReturnValue(chainable([
      { id: "g1", name: "Group 1", description: "Desc 1", createdAt: new Date(), memberCount: 2 },
      { id: "g2", name: "Group 2", description: "Desc 2", createdAt: new Date(), memberCount: 1 },
    ]));

    const { handler } = registeredRoutes["GET /groups"];
    const result = await handler(createRequest(), createReply());
    expect(result.groups).toHaveLength(2);
  });
});

// ================================================================
// POST /rotate-keys
// ================================================================
describe("POST /rotate-keys", () => {
  const validOldKey = "a".repeat(32);
  const validNewKey = "b".repeat(32);

  it("rotates keys for providers and backends successfully", async () => {
    const { randomBytes, createCipheriv, createHash } = await import("crypto");
    const ALGO = "aes-256-gcm";

    function encryptWithKey(text: string, keyStr: string): string {
      const iv = randomBytes(12);
      const key = createHash("sha256").update(keyStr).digest();
      const cipher = createCipheriv(ALGO, key, iv);
      let encrypted = cipher.update(text, "utf8", "hex");
      encrypted += cipher.final("hex");
      const tag = cipher.getAuthTag().toString("hex");
      return `${iv.toString("hex")}:${tag}:${encrypted}`;
    }

    const encryptedProvider = encryptWithKey("provider-secret", validOldKey);
    const encryptedBackend = encryptWithKey("backend-secret", validOldKey);

    mockDb.select
      .mockReturnValueOnce(chainable([{ id: "p1", authKey: encryptedProvider }])) // providers
      .mockReturnValueOnce(chainable([{ id: "b1", config: encryptedBackend }]))  // backends
      .mockReturnValueOnce(chainable([{ value: "1" }])); // config version

    mockDb.update.mockReturnValue(chainable());

    const { handler } = registeredRoutes["POST /security/key-rotation"];
    const request = createRequest({
      userId: 1,
      body: { old_key: validOldKey, new_key: validNewKey },
    });

    const result = await handler(request, createReply());
    expect(result.success).toBe(true);
    expect(result.rotatedCount).toBe(2);
  });

  it("continues rotation when individual record fails", async () => {
    const { randomBytes, createCipheriv, createHash } = await import("crypto");
    const ALGO = "aes-256-gcm";
    function encryptWithKey(text: string, keyStr: string): string {
      const iv = randomBytes(12);
      const key = createHash("sha256").update(keyStr).digest();
      const cipher = createCipheriv(ALGO, key, iv);
      let encrypted = cipher.update(text, "utf8", "hex");
      encrypted += cipher.final("hex");
      const tag = cipher.getAuthTag().toString("hex");
      return `${iv.toString("hex")}:${tag}:${encrypted}`;
    }
    const goodEncrypted = encryptWithKey("secret", validOldKey);

    mockDb.select
      .mockReturnValueOnce(chainable([
        { id: "p1", authKey: "corrupt-data" },
        { id: "p2", authKey: goodEncrypted }
      ])) // 1 fail, 1 success
      .mockReturnValueOnce(chainable([])) // 0 backends
      .mockReturnValueOnce(chainable([{ value: "1" }]));

    const { handler } = registeredRoutes["POST /security/key-rotation"];
    const request = createRequest({
      userId: 1,
      body: { old_key: validOldKey, new_key: validNewKey },
    });

    const result = await handler(request, createReply());
    expect(result.rotatedCount).toBe(1);
    expect(result.failedCount).toBe(1);
  });
});

describe("route registration", () => {
  it("registers all expected routes", () => {
    expect(registeredRoutes["GET /users"]).toBeDefined();
    expect(registeredRoutes["PUT /users/:id/role"]).toBeDefined();
    expect(registeredRoutes["POST /groups"]).toBeDefined();
    expect(registeredRoutes["GET /groups"]).toBeDefined();
    expect(registeredRoutes["POST /groups/:id/members"]).toBeDefined();
    expect(registeredRoutes["DELETE /groups/:id/members/:userId"]).toBeDefined();
    expect(registeredRoutes["GET /analytics/metrics"]).toBeDefined();
    expect(registeredRoutes["POST /security/key-rotation"]).toBeDefined();
  });
});
