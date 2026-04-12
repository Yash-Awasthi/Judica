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
  users: { id: "users.id", email: "users.email", username: "users.username", role: "users.role", createdAt: "users.createdAt" },
}));

vi.mock("../../src/db/schema/social.js", () => ({
  userGroups: { id: "userGroups.id", name: "userGroups.name" },
  groupMemberships: { userId: "gm.userId", groupId: "gm.groupId" },
}));

vi.mock("../../src/db/schema/conversations.js", () => ({
  conversations: { id: "conversations.id" },
  chats: { id: "chats.id" },
}));

vi.mock("../../src/db/schema/council.js", () => ({
  customProviders: { id: "cp.id", authKey: "cp.authKey" },
}));

vi.mock("../../src/db/schema/memory.js", () => ({
  memoryBackends: { id: "mb.id", config: "mb.config" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: any[]) => args),
  and: vi.fn((...args: any[]) => args),
  desc: vi.fn((col: any) => col),
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

function createRequest(overrides: Partial<{ userId: number; body: any; params: any; headers: Record<string, string> }> = {}): any {
  return {
    userId: overrides.userId ?? 1,
    body: overrides.body ?? {},
    params: overrides.params ?? {},
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

    const chain = chainable({
      orderBy: vi.fn().mockResolvedValue(mockUsers),
    });
    mockDb.select = vi.fn(() => chain);

    const { handler } = registeredRoutes["GET /users"];
    const request = createRequest({ userId: 1 });
    const reply = createReply();

    const result = await handler(request, reply);
    expect(result).toEqual({ users: mockUsers });
    expect(mockDb.select).toHaveBeenCalled();
  });

  it("returns empty array when no users exist", async () => {
    const chain = chainable({
      orderBy: vi.fn().mockResolvedValue([]),
    });
    mockDb.select = vi.fn(() => chain);

    const { handler } = registeredRoutes["GET /users"];
    const result = await handler(createRequest(), createReply());
    expect(result).toEqual({ users: [] });
  });

  it("propagates db errors", async () => {
    const chain = chainable({
      orderBy: vi.fn().mockRejectedValue(new Error("db down")),
    });
    mockDb.select = vi.fn(() => chain);

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
    const chain = chainable({
      returning: vi.fn().mockResolvedValue([updatedUser]),
    });
    mockDb.update = vi.fn(() => chain);

    const { handler } = registeredRoutes["PUT /users/:id/role"];
    const request = createRequest({ body: { role: "viewer" }, params: { id: "5" } });
    const result = await handler(request, createReply());
    expect(result).toEqual(updatedUser);
  });

  it("accepts admin role", async () => {
    const chain = chainable({
      returning: vi.fn().mockResolvedValue([{ id: 1, email: "a@b.com", role: "admin" }]),
    });
    mockDb.update = vi.fn(() => chain);

    const { handler } = registeredRoutes["PUT /users/:id/role"];
    const result = await handler(createRequest({ body: { role: "admin" }, params: { id: "1" } }), createReply());
    expect(result).toEqual({ id: 1, email: "a@b.com", role: "admin" });
  });

  it("accepts member role", async () => {
    const chain = chainable({
      returning: vi.fn().mockResolvedValue([{ id: 1, email: "a@b.com", role: "member" }]),
    });
    mockDb.update = vi.fn(() => chain);

    const { handler } = registeredRoutes["PUT /users/:id/role"];
    const result = await handler(createRequest({ body: { role: "member" }, params: { id: "1" } }), createReply());
    expect(result.role).toBe("member");
  });

  it("throws AppError for invalid role", async () => {
    const { handler } = registeredRoutes["PUT /users/:id/role"];
    const request = createRequest({ body: { role: "superuser" }, params: { id: "1" } });

    await expect(handler(request, createReply())).rejects.toThrow("Role must be: admin, member, viewer");
  });

  it("throws AppError for empty role", async () => {
    const { handler } = registeredRoutes["PUT /users/:id/role"];
    const request = createRequest({ body: { role: "" }, params: { id: "1" } });

    await expect(handler(request, createReply())).rejects.toThrow("Role must be");
  });

  it("throws AppError for undefined role", async () => {
    const { handler } = registeredRoutes["PUT /users/:id/role"];
    const request = createRequest({ body: {}, params: { id: "1" } });

    await expect(handler(request, createReply())).rejects.toThrow("Role must be");
  });

  it("propagates db errors during update", async () => {
    const chain = chainable({
      returning: vi.fn().mockRejectedValue(new Error("update failed")),
    });
    mockDb.update = vi.fn(() => chain);

    const { handler } = registeredRoutes["PUT /users/:id/role"];
    const request = createRequest({ body: { role: "admin" }, params: { id: "1" } });
    await expect(handler(request, createReply())).rejects.toThrow("update failed");
  });
});

// ================================================================
// POST /groups
// ================================================================
describe("POST /groups", () => {
  it("creates group successfully and returns 201", async () => {
    const createdGroup = { id: "uuid-1", name: "Engineering" };
    const chain = chainable({
      returning: vi.fn().mockResolvedValue([createdGroup]),
    });
    mockDb.insert = vi.fn(() => chain);

    const { handler } = registeredRoutes["POST /groups"];
    const reply = createReply();
    const request = createRequest({ body: { name: "Engineering" } });

    const result = await handler(request, reply);
    expect(result).toEqual(createdGroup);
    expect(reply.code).toHaveBeenCalledWith(201);
  });

  it("throws AppError when name is missing", async () => {
    const { handler } = registeredRoutes["POST /groups"];
    const request = createRequest({ body: {} });

    await expect(handler(request, createReply())).rejects.toThrow("Name required");
  });

  it("throws AppError when name is empty string", async () => {
    const { handler } = registeredRoutes["POST /groups"];
    const request = createRequest({ body: { name: "" } });

    await expect(handler(request, createReply())).rejects.toThrow("Name required");
  });

  it("propagates db errors during insert", async () => {
    const chain = chainable({
      returning: vi.fn().mockRejectedValue(new Error("insert failed")),
    });
    mockDb.insert = vi.fn(() => chain);

    const { handler } = registeredRoutes["POST /groups"];
    const request = createRequest({ body: { name: "test" } });
    await expect(handler(request, createReply())).rejects.toThrow("insert failed");
  });
});

// ================================================================
// GET /groups
// ================================================================
describe("GET /groups", () => {
  it("returns groups with members mapped correctly", async () => {
    const groups = [
      { id: "g1", name: "Team A" },
      { id: "g2", name: "Team B" },
    ];
    const memberships = [
      { userId: 1, groupId: "g1", userIdRef: 1, email: "a@b.com", username: "alice" },
      { userId: 2, groupId: "g1", userIdRef: 2, email: "c@d.com", username: "bob" },
      { userId: 3, groupId: "g2", userIdRef: 3, email: "e@f.com", username: "charlie" },
    ];

    let selectCallCount = 0;
    mockDb.select = vi.fn(() => {
      selectCallCount++;
      if (selectCallCount === 1) {
        // First call: db.select().from(userGroups)
        return chainable({
          from: vi.fn().mockResolvedValue(groups),
        });
      }
      // Second call: db.select(...).from(groupMemberships).innerJoin(...)
      return chainable({
        from: vi.fn(() =>
          chainable({
            innerJoin: vi.fn().mockResolvedValue(memberships),
          })
        ),
      });
    });

    const { handler } = registeredRoutes["GET /groups"];
    const result = await handler(createRequest(), createReply());

    expect(result.groups).toHaveLength(2);
    expect(result.groups[0].id).toBe("g1");
    expect(result.groups[0].members).toHaveLength(2);
    expect(result.groups[0].members[0].user).toEqual({ id: 1, email: "a@b.com", username: "alice" });
    expect(result.groups[1].id).toBe("g2");
    expect(result.groups[1].members).toHaveLength(1);
    expect(result.groups[1].members[0].user).toEqual({ id: 3, email: "e@f.com", username: "charlie" });
  });

  it("returns empty groups array when no groups exist", async () => {
    let selectCallCount = 0;
    mockDb.select = vi.fn(() => {
      selectCallCount++;
      if (selectCallCount === 1) {
        return chainable({ from: vi.fn().mockResolvedValue([]) });
      }
      return chainable({
        from: vi.fn(() =>
          chainable({ innerJoin: vi.fn().mockResolvedValue([]) })
        ),
      });
    });

    const { handler } = registeredRoutes["GET /groups"];
    const result = await handler(createRequest(), createReply());
    expect(result.groups).toEqual([]);
  });

  it("returns groups with empty members when no memberships exist", async () => {
    const groups = [{ id: "g1", name: "Lonely Group" }];
    let selectCallCount = 0;
    mockDb.select = vi.fn(() => {
      selectCallCount++;
      if (selectCallCount === 1) {
        return chainable({ from: vi.fn().mockResolvedValue(groups) });
      }
      return chainable({
        from: vi.fn(() =>
          chainable({ innerJoin: vi.fn().mockResolvedValue([]) })
        ),
      });
    });

    const { handler } = registeredRoutes["GET /groups"];
    const result = await handler(createRequest(), createReply());
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].members).toEqual([]);
  });

  it("propagates db errors", async () => {
    mockDb.select = vi.fn(() =>
      chainable({ from: vi.fn().mockRejectedValue(new Error("db error")) })
    );

    const { handler } = registeredRoutes["GET /groups"];
    await expect(handler(createRequest(), createReply())).rejects.toThrow("db error");
  });
});

// ================================================================
// POST /groups/:id/members
// ================================================================
describe("POST /groups/:id/members", () => {
  it("adds member successfully", async () => {
    const chain = chainable({
      values: vi.fn().mockResolvedValue(undefined),
    });
    mockDb.insert = vi.fn(() => chain);

    const { handler } = registeredRoutes["POST /groups/:id/members"];
    const request = createRequest({ body: { userId: 42 }, params: { id: "g1" } });
    const result = await handler(request, createReply());

    expect(result).toEqual({ success: true });
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it("throws AppError when userId is missing", async () => {
    const { handler } = registeredRoutes["POST /groups/:id/members"];
    const request = createRequest({ body: {}, params: { id: "g1" } });

    await expect(handler(request, createReply())).rejects.toThrow("userId required");
  });

  it("throws AppError when userId is falsy (0)", async () => {
    const { handler } = registeredRoutes["POST /groups/:id/members"];
    const request = createRequest({ body: { userId: 0 }, params: { id: "g1" } });

    await expect(handler(request, createReply())).rejects.toThrow("userId required");
  });

  it("propagates db errors during insert", async () => {
    const chain = chainable({
      values: vi.fn().mockRejectedValue(new Error("constraint violation")),
    });
    mockDb.insert = vi.fn(() => chain);

    const { handler } = registeredRoutes["POST /groups/:id/members"];
    const request = createRequest({ body: { userId: 42 }, params: { id: "g1" } });
    await expect(handler(request, createReply())).rejects.toThrow("constraint violation");
  });
});

// ================================================================
// DELETE /groups/:id/members/:userId
// ================================================================
describe("DELETE /groups/:id/members/:userId", () => {
  it("removes member successfully", async () => {
    const chain = chainable({
      where: vi.fn().mockResolvedValue(undefined),
    });
    mockDb.delete = vi.fn(() => chain);

    const { handler } = registeredRoutes["DELETE /groups/:id/members/:userId"];
    const request = createRequest({ params: { id: "g1", userId: "42" } });
    const result = await handler(request, createReply());

    expect(result).toEqual({ success: true });
    expect(mockDb.delete).toHaveBeenCalled();
  });

  it("propagates db errors during delete", async () => {
    const chain = chainable({
      where: vi.fn().mockRejectedValue(new Error("delete failed")),
    });
    mockDb.delete = vi.fn(() => chain);

    const { handler } = registeredRoutes["DELETE /groups/:id/members/:userId"];
    const request = createRequest({ params: { id: "g1", userId: "42" } });
    await expect(handler(request, createReply())).rejects.toThrow("delete failed");
  });
});

// ================================================================
// GET /stats
// ================================================================
describe("GET /stats", () => {
  it("returns system stats", async () => {
    mockDb.select = vi.fn(() =>
      chainable({
        from: vi.fn().mockImplementation((table: any) => {
          if (table === "users.id" || JSON.stringify(table).includes("users")) {
            // Hack: we just resolve with appropriate count based on call order
            return Promise.resolve([{ value: 10 }]);
          }
          return Promise.resolve([{ value: 0 }]);
        }),
      })
    );

    // The stats handler uses Promise.all with three db.select().from() calls.
    // We need each call to resolve to a different value.
    let callIndex = 0;
    const counts = [
      [{ value: 100 }], // users
      [{ value: 50 }],  // conversations
      [{ value: 200 }], // chats
    ];

    mockDb.select = vi.fn(() =>
      chainable({
        from: vi.fn(() => counts[callIndex++] ?? [{ value: 0 }]),
      })
    );

    const { handler } = registeredRoutes["GET /stats"];
    const result = await handler(createRequest(), createReply());

    expect(result).toEqual({
      totalUsers: 100,
      totalConversations: 50,
      totalChats: 200,
    });
  });

  it("handles zero counts", async () => {
    let callIndex = 0;
    const counts = [
      [{ value: 0 }],
      [{ value: 0 }],
      [{ value: 0 }],
    ];

    mockDb.select = vi.fn(() =>
      chainable({
        from: vi.fn(() => counts[callIndex++] ?? [{ value: 0 }]),
      })
    );

    const { handler } = registeredRoutes["GET /stats"];
    const result = await handler(createRequest(), createReply());

    expect(result).toEqual({
      totalUsers: 0,
      totalConversations: 0,
      totalChats: 0,
    });
  });

  it("propagates db errors", async () => {
    mockDb.select = vi.fn(() =>
      chainable({
        from: vi.fn().mockRejectedValue(new Error("stats query failed")),
      })
    );

    const { handler } = registeredRoutes["GET /stats"];
    await expect(handler(createRequest(), createReply())).rejects.toThrow("stats query failed");
  });
});

// ================================================================
// POST /rotate-keys
// ================================================================
describe("POST /rotate-keys", () => {
  const validOldKey = "a".repeat(32);
  const validNewKey = "b".repeat(32);

  it("throws AppError when old_key is missing", async () => {
    const { handler } = registeredRoutes["POST /rotate-keys"];
    const request = createRequest({ body: { new_key: validNewKey } });

    await expect(handler(request, createReply())).rejects.toThrow("old_key and new_key are required");
  });

  it("throws AppError when new_key is missing", async () => {
    const { handler } = registeredRoutes["POST /rotate-keys"];
    const request = createRequest({ body: { old_key: validOldKey } });

    await expect(handler(request, createReply())).rejects.toThrow("old_key and new_key are required");
  });

  it("throws AppError when both keys are missing", async () => {
    const { handler } = registeredRoutes["POST /rotate-keys"];
    const request = createRequest({ body: {} });

    await expect(handler(request, createReply())).rejects.toThrow("old_key and new_key are required");
  });

  it("throws AppError when new_key is too short", async () => {
    const { handler } = registeredRoutes["POST /rotate-keys"];
    const request = createRequest({ body: { old_key: validOldKey, new_key: "short" } });

    await expect(handler(request, createReply())).rejects.toThrow("new_key must be at least 32 characters");
  });

  it("throws AppError when new_key is 31 characters", async () => {
    const { handler } = registeredRoutes["POST /rotate-keys"];
    const request = createRequest({ body: { old_key: validOldKey, new_key: "x".repeat(31) } });

    await expect(handler(request, createReply())).rejects.toThrow("new_key must be at least 32 characters");
  });

  it("rotates keys for providers and backends successfully", async () => {
    // Mock providers and backends as empty so no actual crypto is needed
    let selectCallIndex = 0;
    const selectResults = [
      [], // providers
      [], // backends
    ];

    mockDb.select = vi.fn(() =>
      chainable({
        from: vi.fn(() => selectResults[selectCallIndex++] ?? []),
      })
    );

    const { handler } = registeredRoutes["POST /rotate-keys"];
    const request = createRequest({
      userId: 1,
      body: { old_key: validOldKey, new_key: validNewKey },
    });

    const result = await handler(request, createReply());
    expect(result).toEqual({ message: "Key rotation complete", rotated: 0 });
  });

  it("counts rotated secrets correctly", async () => {
    // We need real encrypt/decrypt to work. Use the actual crypto module
    // to create encrypted values with the old key, then verify rotation.
    const { randomBytes, createCipheriv, scryptSync } = await import("crypto");
    const ALGO = "aes-256-gcm";

    function encryptWithKey(text: string, key: string): string {
      const iv = randomBytes(16);
      const derivedKey = scryptSync(key, iv, 32);
      const cipher = createCipheriv(ALGO, derivedKey, iv);
      const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
      const tag = cipher.getAuthTag();
      return Buffer.concat([iv, tag, encrypted]).toString("base64");
    }

    const encryptedProvider = encryptWithKey("provider-secret", validOldKey);
    const encryptedBackend = encryptWithKey("backend-secret", validOldKey);

    let selectCallIndex = 0;
    mockDb.select = vi.fn(() =>
      chainable({
        from: vi.fn(() => {
          const results = [
            [{ id: "p1", authKey: encryptedProvider }],
            [{ id: "b1", config: encryptedBackend }],
          ];
          return results[selectCallIndex++] ?? [];
        }),
      })
    );

    const updateChain = chainable({
      where: vi.fn().mockResolvedValue(undefined),
    });
    mockDb.update = vi.fn(() => updateChain);

    const { handler } = registeredRoutes["POST /rotate-keys"];
    const request = createRequest({
      userId: 1,
      body: { old_key: validOldKey, new_key: validNewKey },
    });

    const result = await handler(request, createReply());
    expect(result.message).toBe("Key rotation complete");
    expect(result.rotated).toBe(2);
    expect(mockDb.update).toHaveBeenCalledTimes(2);
  });

  it("continues rotation when individual record fails", async () => {
    // First provider will fail decrypt, second will succeed
    const { randomBytes, createCipheriv, scryptSync } = await import("crypto");
    const ALGO = "aes-256-gcm";

    function encryptWithKey(text: string, key: string): string {
      const iv = randomBytes(16);
      const derivedKey = scryptSync(key, iv, 32);
      const cipher = createCipheriv(ALGO, derivedKey, iv);
      const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
      const tag = cipher.getAuthTag();
      return Buffer.concat([iv, tag, encrypted]).toString("base64");
    }

    const goodEncrypted = encryptWithKey("secret", validOldKey);

    let selectCallIndex = 0;
    mockDb.select = vi.fn(() =>
      chainable({
        from: vi.fn(() => {
          const results = [
            [
              { id: "p1", authKey: "not-valid-base64-encrypted-data!!!" },
              { id: "p2", authKey: goodEncrypted },
            ],
            [], // no backends
          ];
          return results[selectCallIndex++] ?? [];
        }),
      })
    );

    const updateChain = chainable({
      where: vi.fn().mockResolvedValue(undefined),
    });
    mockDb.update = vi.fn(() => updateChain);

    const { handler } = registeredRoutes["POST /rotate-keys"];
    const request = createRequest({
      userId: 1,
      body: { old_key: validOldKey, new_key: validNewKey },
    });

    const result = await handler(request, createReply());
    // p1 fails, p2 succeeds = 1 rotated
    expect(result.rotated).toBe(1);
    expect(result.message).toBe("Key rotation complete");
  });
});

// ================================================================
// fastifyRequireRole (preHandler) registration
// ================================================================
describe("route registration", () => {
  it("registers all expected routes", () => {
    expect(registeredRoutes["GET /users"]).toBeDefined();
    expect(registeredRoutes["PUT /users/:id/role"]).toBeDefined();
    expect(registeredRoutes["POST /groups"]).toBeDefined();
    expect(registeredRoutes["GET /groups"]).toBeDefined();
    expect(registeredRoutes["POST /groups/:id/members"]).toBeDefined();
    expect(registeredRoutes["DELETE /groups/:id/members/:userId"]).toBeDefined();
    expect(registeredRoutes["GET /stats"]).toBeDefined();
    expect(registeredRoutes["POST /rotate-keys"]).toBeDefined();
  });

  it("all routes have a preHandler for role checking", () => {
    for (const key of Object.keys(registeredRoutes)) {
      expect(registeredRoutes[key].preHandler).toBeDefined();
    }
  });
});
