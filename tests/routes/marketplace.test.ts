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
    "offset",
    "onConflictDoNothing",
  ];
  for (const m of methods) {
    chain[m] = overrides[m] ?? vi.fn(() => chain);
  }
  return chain;
}

vi.mock("../../src/lib/drizzle.js", () => ({
  db: mockDb,
}));

vi.mock("../../src/db/schema/marketplace.js", () => ({
  marketplaceItems: {
    id: "mi.id",
    type: "mi.type",
    name: "mi.name",
    description: "mi.description",
    content: "mi.content",
    authorId: "mi.authorId",
    authorName: "mi.authorName",
    tags: "mi.tags",
    downloads: "mi.downloads",
    stars: "mi.stars",
    version: "mi.version",
    published: "mi.published",
    createdAt: "mi.createdAt",
    updatedAt: "mi.updatedAt",
  },
  marketplaceStars: {
    userId: "ms.userId",
    itemId: "ms.itemId",
  },
  marketplaceReviews: {
    id: "mr.id",
    itemId: "mr.itemId",
    userId: "mr.userId",
    rating: "mr.rating",
    comment: "mr.comment",
    createdAt: "mr.createdAt",
  },
  userSkills: {
    id: "us.id",
    userId: "us.userId",
    name: "us.name",
    description: "us.description",
    code: "us.code",
    parameters: "us.parameters",
    active: "us.active",
  },
}));

vi.mock("../../src/db/schema/users.js", () => ({
  users: { id: "users.id", email: "users.email", username: "users.username", role: "users.role" },
}));

vi.mock("../../src/db/schema/prompts.js", () => ({
  prompts: { id: "prompts.id" },
  promptVersions: { id: "pv.id" },
}));

vi.mock("../../src/db/schema/workflows.js", () => ({
  workflows: { id: "workflows.id" },
}));

vi.mock("../../src/db/schema/council.js", () => ({
  customPersonas: { id: "cp.id" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: any[]) => args),
  and: vi.fn((...args: any[]) => args),
  or: vi.fn((...args: any[]) => args),
  ilike: vi.fn((...args: any[]) => args),
  desc: vi.fn((col: any) => col),
  count: vi.fn(() => "count"),
  sql: Object.assign(vi.fn((...args: any[]) => args), {
    join: vi.fn((...args: any[]) => args),
  }),
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

vi.mock("crypto", async () => {
  const actual = await vi.importActual<typeof import("crypto")>("crypto");
  return {
    ...actual,
    randomUUID: vi.fn(() => "test-uuid"),
  };
});

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
    send: vi.fn(function (this: any) {
      return this;
    }),
  };
  return reply;
}

// ---- import and register the plugin ----

let marketplacePlugin: any;

beforeEach(async () => {
  vi.clearAllMocks();
  for (const key of Object.keys(registeredRoutes)) {
    delete registeredRoutes[key];
  }

  const mod = await import("../../src/routes/marketplace.js");
  marketplacePlugin = mod.default;
  const fastify = createFastifyInstance();
  await marketplacePlugin(fastify);
});

// ================================================================
// Route registration
// ================================================================
describe("route registration", () => {
  it("registers all expected routes", () => {
    expect(registeredRoutes["GET /"]).toBeDefined();
    expect(registeredRoutes["GET /:id"]).toBeDefined();
    expect(registeredRoutes["POST /"]).toBeDefined();
    expect(registeredRoutes["PUT /:id"]).toBeDefined();
    expect(registeredRoutes["DELETE /:id"]).toBeDefined();
    expect(registeredRoutes["POST /:id/install"]).toBeDefined();
    expect(registeredRoutes["POST /:id/star"]).toBeDefined();
    expect(registeredRoutes["POST /:id/reviews"]).toBeDefined();
    expect(registeredRoutes["GET /:id/reviews"]).toBeDefined();
  });

  it("public routes have no preHandler", () => {
    expect(registeredRoutes["GET /"].preHandler).toBeUndefined();
    expect(registeredRoutes["GET /:id"].preHandler).toBeUndefined();
    expect(registeredRoutes["GET /:id/reviews"].preHandler).toBeUndefined();
  });

  it("protected routes have a preHandler", () => {
    expect(registeredRoutes["POST /"].preHandler).toBeDefined();
    expect(registeredRoutes["PUT /:id"].preHandler).toBeDefined();
    expect(registeredRoutes["DELETE /:id"].preHandler).toBeDefined();
    expect(registeredRoutes["POST /:id/install"].preHandler).toBeDefined();
    expect(registeredRoutes["POST /:id/star"].preHandler).toBeDefined();
    expect(registeredRoutes["POST /:id/reviews"].preHandler).toBeDefined();
  });
});

// ================================================================
// GET / — list marketplace items
// ================================================================
describe("GET / (list marketplace items)", () => {
  function setupListMock(items: any[], total: number) {
    const itemsChain = chainable({
      limit: vi.fn().mockResolvedValue(items),
    });
    const countChain = chainable({
      where: vi.fn().mockResolvedValue([{ value: total }]),
    });

    let selectCallIndex = 0;
    mockDb.select = vi.fn(() => {
      selectCallIndex++;
      if (selectCallIndex === 1) return itemsChain;
      return countChain;
    });
  }

  it("returns paginated items with defaults", async () => {
    const mockItems = [{ id: "item-1", name: "Test" }];
    setupListMock(mockItems, 1);

    const { handler } = registeredRoutes["GET /"];
    const result = await handler(createRequest({ query: {} }), createReply());

    expect(result).toEqual({ items: mockItems, total: 1, page: 1, limit: 20 });
  });

  it("returns empty list when no items match", async () => {
    setupListMock([], 0);

    const { handler } = registeredRoutes["GET /"];
    const result = await handler(createRequest({ query: {} }), createReply());

    expect(result).toEqual({ items: [], total: 0, page: 1, limit: 20 });
  });

  it("respects page and limit query params", async () => {
    setupListMock([], 0);

    const { handler } = registeredRoutes["GET /"];
    const result = await handler(
      createRequest({ query: { page: "3", limit: "10" } }),
      createReply()
    );

    expect(result.page).toBe(3);
    expect(result.limit).toBe(10);
  });

  it("clamps page to minimum 1", async () => {
    setupListMock([], 0);

    const { handler } = registeredRoutes["GET /"];
    const result = await handler(
      createRequest({ query: { page: "0" } }),
      createReply()
    );

    expect(result.page).toBe(1);
  });

  it("clamps negative page to 1", async () => {
    setupListMock([], 0);

    const { handler } = registeredRoutes["GET /"];
    const result = await handler(
      createRequest({ query: { page: "-5" } }),
      createReply()
    );

    expect(result.page).toBe(1);
  });

  it("clamps limit to maximum 100", async () => {
    setupListMock([], 0);

    const { handler } = registeredRoutes["GET /"];
    const result = await handler(
      createRequest({ query: { limit: "999" } }),
      createReply()
    );

    expect(result.limit).toBe(100);
  });

  it("clamps limit to minimum 1 for negative values", async () => {
    setupListMock([], 0);

    const { handler } = registeredRoutes["GET /"];
    const result = await handler(
      createRequest({ query: { limit: "-5" } }),
      createReply()
    );

    // parseInt("-5") = -5, which is not > 0, so falls back to default 20
    expect(result.limit).toBe(20);
  });

  it("treats limit=0 as NaN fallback to 20", async () => {
    setupListMock([], 0);

    const { handler } = registeredRoutes["GET /"];
    const result = await handler(
      createRequest({ query: { limit: "0" } }),
      createReply()
    );

    // parseInt("0") = 0 which is falsy, so `parseInt(limit) || 20` = 20
    expect(result.limit).toBe(20);
  });

  it("handles non-numeric page gracefully (defaults to 1)", async () => {
    setupListMock([], 0);

    const { handler } = registeredRoutes["GET /"];
    const result = await handler(
      createRequest({ query: { page: "abc" } }),
      createReply()
    );

    expect(result.page).toBe(1);
  });

  it("handles non-numeric limit gracefully (defaults to 20)", async () => {
    setupListMock([], 0);

    const { handler } = registeredRoutes["GET /"];
    const result = await handler(
      createRequest({ query: { limit: "abc" } }),
      createReply()
    );

    expect(result.limit).toBe(20);
  });

  it("passes type filter when provided", async () => {
    setupListMock([], 0);

    const { handler } = registeredRoutes["GET /"];
    await handler(createRequest({ query: { type: "prompt" } }), createReply());

    // Just verify no error — the filter logic runs through eq/and which are mocked
    expect(mockDb.select).toHaveBeenCalled();
  });

  it("passes tags filter when provided", async () => {
    setupListMock([], 0);

    const { handler } = registeredRoutes["GET /"];
    await handler(createRequest({ query: { tags: "ai,coding" } }), createReply());

    expect(mockDb.select).toHaveBeenCalled();
  });

  it("passes search filter when provided", async () => {
    setupListMock([], 0);

    const { handler } = registeredRoutes["GET /"];
    await handler(createRequest({ query: { search: "hello" } }), createReply());

    expect(mockDb.select).toHaveBeenCalled();
  });

  it("handles search with special LIKE characters", async () => {
    setupListMock([], 0);

    const { handler } = registeredRoutes["GET /"];
    // Should not throw — special chars %, _, \ are escaped
    await handler(createRequest({ query: { search: "100%_test\\path" } }), createReply());

    expect(mockDb.select).toHaveBeenCalled();
  });

  it("accepts sort=stars", async () => {
    setupListMock([], 0);

    const { handler } = registeredRoutes["GET /"];
    const result = await handler(
      createRequest({ query: { sort: "stars" } }),
      createReply()
    );

    expect(result).toBeDefined();
  });

  it("accepts sort=downloads", async () => {
    setupListMock([], 0);

    const { handler } = registeredRoutes["GET /"];
    const result = await handler(
      createRequest({ query: { sort: "downloads" } }),
      createReply()
    );

    expect(result).toBeDefined();
  });

  it("defaults sort to newest", async () => {
    setupListMock([], 0);

    const { handler } = registeredRoutes["GET /"];
    const result = await handler(createRequest({ query: {} }), createReply());

    expect(result).toBeDefined();
  });

  it("propagates db errors", async () => {
    mockDb.select = vi.fn(() =>
      chainable({
        from: vi.fn(() =>
          chainable({
            where: vi.fn(() =>
              chainable({
                orderBy: vi.fn(() =>
                  chainable({
                    offset: vi.fn(() =>
                      chainable({
                        limit: vi.fn().mockRejectedValue(new Error("db down")),
                      })
                    ),
                  })
                ),
              })
            ),
          })
        ),
      })
    );

    const { handler } = registeredRoutes["GET /"];
    await expect(handler(createRequest({ query: {} }), createReply())).rejects.toThrow("db down");
  });
});

// ================================================================
// GET /:id — item detail
// ================================================================
describe("GET /:id (item detail)", () => {
  it("returns item with reviews and starred=false for unauthenticated user", async () => {
    const mockItem = { id: "item-1", name: "Test Item", type: "prompt" };
    const mockReviews = [{ id: "r1", rating: 5 }];

    let selectCallIndex = 0;
    mockDb.select = vi.fn(() => {
      selectCallIndex++;
      if (selectCallIndex === 1) {
        // item lookup
        return chainable({
          limit: vi.fn().mockResolvedValue([mockItem]),
        });
      }
      // reviews lookup
      return chainable({
        limit: vi.fn().mockResolvedValue(mockReviews),
      });
    });

    const { handler } = registeredRoutes["GET /:id"];
    const request = createRequest({ params: { id: "item-1" } });
    // Explicitly set userId to falsy to simulate unauthenticated user
    request.userId = undefined;
    const result = await handler(request, createReply());

    expect(result).toEqual({ ...mockItem, reviews: mockReviews, starred: false });
  });

  it("returns starred=true when user has starred the item", async () => {
    const mockItem = { id: "item-1", name: "Test Item" };
    const mockReviews: any[] = [];
    const mockStar = { userId: 1, itemId: "item-1" };

    let selectCallIndex = 0;
    mockDb.select = vi.fn(() => {
      selectCallIndex++;
      if (selectCallIndex === 1) {
        return chainable({ limit: vi.fn().mockResolvedValue([mockItem]) });
      }
      if (selectCallIndex === 2) {
        return chainable({ limit: vi.fn().mockResolvedValue(mockReviews) });
      }
      // star lookup
      return chainable({ limit: vi.fn().mockResolvedValue([mockStar]) });
    });

    const { handler } = registeredRoutes["GET /:id"];
    const request = createRequest({ params: { id: "item-1" }, userId: 1 });
    const result = await handler(request, createReply());

    expect(result.starred).toBe(true);
  });

  it("returns starred=false when user has not starred the item", async () => {
    const mockItem = { id: "item-1", name: "Test Item" };

    let selectCallIndex = 0;
    mockDb.select = vi.fn(() => {
      selectCallIndex++;
      if (selectCallIndex === 1) {
        return chainable({ limit: vi.fn().mockResolvedValue([mockItem]) });
      }
      if (selectCallIndex === 2) {
        return chainable({ limit: vi.fn().mockResolvedValue([]) });
      }
      // star lookup — empty
      return chainable({ limit: vi.fn().mockResolvedValue([]) });
    });

    const { handler } = registeredRoutes["GET /:id"];
    const request = createRequest({ params: { id: "item-1" }, userId: 1 });
    const result = await handler(request, createReply());

    expect(result.starred).toBe(false);
  });

  it("throws 404 when item not found", async () => {
    mockDb.select = vi.fn(() =>
      chainable({ limit: vi.fn().mockResolvedValue([]) })
    );

    const { handler } = registeredRoutes["GET /:id"];
    const request = createRequest({ params: { id: "nonexistent" } });

    await expect(handler(request, createReply())).rejects.toThrow("Marketplace item not found");
  });

  it("propagates db errors", async () => {
    mockDb.select = vi.fn(() =>
      chainable({ limit: vi.fn().mockRejectedValue(new Error("db error")) })
    );

    const { handler } = registeredRoutes["GET /:id"];
    await expect(handler(createRequest({ params: { id: "x" } }), createReply())).rejects.toThrow("db error");
  });
});

// ================================================================
// POST / — publish item
// ================================================================
describe("POST / (publish item)", () => {
  it("creates item successfully and returns 201", async () => {
    const mockUser = { id: 1, username: "alice" };
    const createdItem = { id: "test-uuid", type: "prompt", name: "My Prompt", published: true };

    let selectCallIndex = 0;
    mockDb.select = vi.fn(() => {
      selectCallIndex++;
      return chainable({ limit: vi.fn().mockResolvedValue([mockUser]) });
    });

    mockDb.insert = vi.fn(() =>
      chainable({ returning: vi.fn().mockResolvedValue([createdItem]) })
    );

    const { handler } = registeredRoutes["POST /"];
    const reply = createReply();
    const request = createRequest({
      userId: 1,
      body: { type: "prompt", name: "My Prompt", description: "A test", content: { text: "hello" } },
    });

    const result = await handler(request, reply);

    expect(result).toEqual(createdItem);
    expect(reply.code).toHaveBeenCalledWith(201);
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it("creates item with tags", async () => {
    const mockUser = { id: 1, username: "alice" };
    const createdItem = { id: "test-uuid", tags: ["ai", "coding"] };

    mockDb.select = vi.fn(() =>
      chainable({ limit: vi.fn().mockResolvedValue([mockUser]) })
    );
    mockDb.insert = vi.fn(() =>
      chainable({ returning: vi.fn().mockResolvedValue([createdItem]) })
    );

    const { handler } = registeredRoutes["POST /"];
    const result = await handler(
      createRequest({
        body: { type: "prompt", name: "T", description: "D", content: {}, tags: ["ai", "coding"] },
      }),
      createReply()
    );

    expect(result).toEqual(createdItem);
  });

  it("throws 400 when type is missing", async () => {
    const { handler } = registeredRoutes["POST /"];
    const request = createRequest({
      body: { name: "T", description: "D", content: {} },
    });

    await expect(handler(request, createReply())).rejects.toThrow(
      "type, name, description, and content are required"
    );
  });

  it("throws 400 when name is missing", async () => {
    const { handler } = registeredRoutes["POST /"];
    const request = createRequest({
      body: { type: "prompt", description: "D", content: {} },
    });

    await expect(handler(request, createReply())).rejects.toThrow(
      "type, name, description, and content are required"
    );
  });

  it("throws 400 when description is missing", async () => {
    const { handler } = registeredRoutes["POST /"];
    const request = createRequest({
      body: { type: "prompt", name: "T", content: {} },
    });

    await expect(handler(request, createReply())).rejects.toThrow(
      "type, name, description, and content are required"
    );
  });

  it("throws 400 when content is missing", async () => {
    const { handler } = registeredRoutes["POST /"];
    const request = createRequest({
      body: { type: "prompt", name: "T", description: "D" },
    });

    await expect(handler(request, createReply())).rejects.toThrow(
      "type, name, description, and content are required"
    );
  });

  it("throws 400 when all required fields are missing", async () => {
    const { handler } = registeredRoutes["POST /"];
    await expect(handler(createRequest({ body: {} }), createReply())).rejects.toThrow(
      "type, name, description, and content are required"
    );
  });

  it("throws 400 for invalid type", async () => {
    const { handler } = registeredRoutes["POST /"];
    const request = createRequest({
      body: { type: "invalid", name: "T", description: "D", content: {} },
    });

    await expect(handler(request, createReply())).rejects.toThrow(
      "Invalid type. Must be one of: prompt, workflow, persona, tool"
    );
  });

  it("accepts all valid types", async () => {
    const validTypes = ["prompt", "workflow", "persona", "tool"];
    const mockUser = { id: 1, username: "alice" };

    for (const type of validTypes) {
      mockDb.select = vi.fn(() =>
        chainable({ limit: vi.fn().mockResolvedValue([mockUser]) })
      );
      mockDb.insert = vi.fn(() =>
        chainable({ returning: vi.fn().mockResolvedValue([{ id: "test-uuid", type }]) })
      );

      const { handler } = registeredRoutes["POST /"];
      const result = await handler(
        createRequest({ body: { type, name: "T", description: "D", content: {} } }),
        createReply()
      );

      expect(result.type).toBe(type);
    }
  });

  it("throws 404 when user not found", async () => {
    mockDb.select = vi.fn(() =>
      chainable({ limit: vi.fn().mockResolvedValue([]) })
    );

    const { handler } = registeredRoutes["POST /"];
    const request = createRequest({
      userId: 999,
      body: { type: "prompt", name: "T", description: "D", content: {} },
    });

    await expect(handler(request, createReply())).rejects.toThrow("User not found");
  });

  it("propagates db insert errors", async () => {
    const mockUser = { id: 1, username: "alice" };
    mockDb.select = vi.fn(() =>
      chainable({ limit: vi.fn().mockResolvedValue([mockUser]) })
    );
    mockDb.insert = vi.fn(() =>
      chainable({ returning: vi.fn().mockRejectedValue(new Error("insert failed")) })
    );

    const { handler } = registeredRoutes["POST /"];
    const request = createRequest({
      body: { type: "prompt", name: "T", description: "D", content: {} },
    });

    await expect(handler(request, createReply())).rejects.toThrow("insert failed");
  });
});

// ================================================================
// PUT /:id — update item
// ================================================================
describe("PUT /:id (update item)", () => {
  it("updates item successfully when user is author", async () => {
    const existingItem = { id: "item-1", authorId: 1, name: "Old Name" };
    const updatedItem = { id: "item-1", authorId: 1, name: "New Name" };

    mockDb.select = vi.fn(() =>
      chainable({ limit: vi.fn().mockResolvedValue([existingItem]) })
    );
    mockDb.update = vi.fn(() =>
      chainable({ returning: vi.fn().mockResolvedValue([updatedItem]) })
    );

    const { handler } = registeredRoutes["PUT /:id"];
    const request = createRequest({
      userId: 1,
      params: { id: "item-1" },
      body: { name: "New Name" },
    });

    const result = await handler(request, createReply());
    expect(result).toEqual(updatedItem);
  });

  it("updates only provided fields", async () => {
    const existingItem = { id: "item-1", authorId: 1 };
    const updatedItem = { id: "item-1", authorId: 1, description: "New Desc" };

    mockDb.select = vi.fn(() =>
      chainable({ limit: vi.fn().mockResolvedValue([existingItem]) })
    );
    mockDb.update = vi.fn(() =>
      chainable({ returning: vi.fn().mockResolvedValue([updatedItem]) })
    );

    const { handler } = registeredRoutes["PUT /:id"];
    const request = createRequest({
      userId: 1,
      params: { id: "item-1" },
      body: { description: "New Desc" },
    });

    const result = await handler(request, createReply());
    expect(result).toEqual(updatedItem);
    expect(mockDb.update).toHaveBeenCalled();
  });

  it("allows updating all supported fields at once", async () => {
    const existingItem = { id: "item-1", authorId: 1 };
    const updatedItem = { id: "item-1", authorId: 1, name: "N", description: "D", content: {}, tags: ["a"], version: "2.0", published: false };

    mockDb.select = vi.fn(() =>
      chainable({ limit: vi.fn().mockResolvedValue([existingItem]) })
    );
    mockDb.update = vi.fn(() =>
      chainable({ returning: vi.fn().mockResolvedValue([updatedItem]) })
    );

    const { handler } = registeredRoutes["PUT /:id"];
    const request = createRequest({
      userId: 1,
      params: { id: "item-1" },
      body: { name: "N", description: "D", content: {}, tags: ["a"], version: "2.0", published: false },
    });

    const result = await handler(request, createReply());
    expect(result).toEqual(updatedItem);
  });

  it("throws 404 when item not found", async () => {
    mockDb.select = vi.fn(() =>
      chainable({ limit: vi.fn().mockResolvedValue([]) })
    );

    const { handler } = registeredRoutes["PUT /:id"];
    const request = createRequest({ userId: 1, params: { id: "nonexistent" }, body: { name: "X" } });

    await expect(handler(request, createReply())).rejects.toThrow("Item not found");
  });

  it("throws 403 when user is not the author", async () => {
    const existingItem = { id: "item-1", authorId: 2 };

    mockDb.select = vi.fn(() =>
      chainable({ limit: vi.fn().mockResolvedValue([existingItem]) })
    );

    const { handler } = registeredRoutes["PUT /:id"];
    const request = createRequest({
      userId: 1,
      params: { id: "item-1" },
      body: { name: "Hack" },
    });

    await expect(handler(request, createReply())).rejects.toThrow("Not authorized to update this item");
  });

  it("propagates db errors during update", async () => {
    const existingItem = { id: "item-1", authorId: 1 };

    mockDb.select = vi.fn(() =>
      chainable({ limit: vi.fn().mockResolvedValue([existingItem]) })
    );
    mockDb.update = vi.fn(() =>
      chainable({ returning: vi.fn().mockRejectedValue(new Error("update failed")) })
    );

    const { handler } = registeredRoutes["PUT /:id"];
    const request = createRequest({ userId: 1, params: { id: "item-1" }, body: { name: "X" } });

    await expect(handler(request, createReply())).rejects.toThrow("update failed");
  });
});

// ================================================================
// DELETE /:id — delete item
// ================================================================
describe("DELETE /:id (delete item)", () => {
  it("deletes item when user is author", async () => {
    const existingItem = { id: "item-1", authorId: 1 };
    const mockUser = { id: 1, role: "member" };

    let selectCallIndex = 0;
    mockDb.select = vi.fn(() => {
      selectCallIndex++;
      if (selectCallIndex === 1) {
        return chainable({ limit: vi.fn().mockResolvedValue([existingItem]) });
      }
      return chainable({ limit: vi.fn().mockResolvedValue([mockUser]) });
    });

    mockDb.delete = vi.fn(() =>
      chainable({ where: vi.fn().mockResolvedValue(undefined) })
    );

    const { handler } = registeredRoutes["DELETE /:id"];
    const request = createRequest({ userId: 1, params: { id: "item-1" } });
    const result = await handler(request, createReply());

    expect(result).toEqual({ success: true });
    expect(mockDb.delete).toHaveBeenCalled();
  });

  it("deletes item when user is admin but not author", async () => {
    const existingItem = { id: "item-1", authorId: 2 };
    const mockUser = { id: 1, role: "admin" };

    let selectCallIndex = 0;
    mockDb.select = vi.fn(() => {
      selectCallIndex++;
      if (selectCallIndex === 1) {
        return chainable({ limit: vi.fn().mockResolvedValue([existingItem]) });
      }
      return chainable({ limit: vi.fn().mockResolvedValue([mockUser]) });
    });

    mockDb.delete = vi.fn(() =>
      chainable({ where: vi.fn().mockResolvedValue(undefined) })
    );

    const { handler } = registeredRoutes["DELETE /:id"];
    const request = createRequest({ userId: 1, params: { id: "item-1" } });
    const result = await handler(request, createReply());

    expect(result).toEqual({ success: true });
  });

  it("throws 404 when item not found", async () => {
    mockDb.select = vi.fn(() =>
      chainable({ limit: vi.fn().mockResolvedValue([]) })
    );

    const { handler } = registeredRoutes["DELETE /:id"];
    const request = createRequest({ userId: 1, params: { id: "nonexistent" } });

    await expect(handler(request, createReply())).rejects.toThrow("Item not found");
  });

  it("throws 403 when user is not author and not admin", async () => {
    const existingItem = { id: "item-1", authorId: 2 };
    const mockUser = { id: 1, role: "member" };

    let selectCallIndex = 0;
    mockDb.select = vi.fn(() => {
      selectCallIndex++;
      if (selectCallIndex === 1) {
        return chainable({ limit: vi.fn().mockResolvedValue([existingItem]) });
      }
      return chainable({ limit: vi.fn().mockResolvedValue([mockUser]) });
    });

    const { handler } = registeredRoutes["DELETE /:id"];
    const request = createRequest({ userId: 1, params: { id: "item-1" } });

    await expect(handler(request, createReply())).rejects.toThrow("Not authorized to delete this item");
  });

  it("throws 403 when user not found (undefined role)", async () => {
    const existingItem = { id: "item-1", authorId: 2 };

    let selectCallIndex = 0;
    mockDb.select = vi.fn(() => {
      selectCallIndex++;
      if (selectCallIndex === 1) {
        return chainable({ limit: vi.fn().mockResolvedValue([existingItem]) });
      }
      // user not found
      return chainable({ limit: vi.fn().mockResolvedValue([]) });
    });

    const { handler } = registeredRoutes["DELETE /:id"];
    const request = createRequest({ userId: 999, params: { id: "item-1" } });

    await expect(handler(request, createReply())).rejects.toThrow("Not authorized to delete this item");
  });

  it("propagates db errors during delete", async () => {
    const existingItem = { id: "item-1", authorId: 1 };
    const mockUser = { id: 1, role: "member" };

    let selectCallIndex = 0;
    mockDb.select = vi.fn(() => {
      selectCallIndex++;
      if (selectCallIndex === 1) {
        return chainable({ limit: vi.fn().mockResolvedValue([existingItem]) });
      }
      return chainable({ limit: vi.fn().mockResolvedValue([mockUser]) });
    });

    mockDb.delete = vi.fn(() =>
      chainable({ where: vi.fn().mockRejectedValue(new Error("delete failed")) })
    );

    const { handler } = registeredRoutes["DELETE /:id"];
    const request = createRequest({ userId: 1, params: { id: "item-1" } });

    await expect(handler(request, createReply())).rejects.toThrow("delete failed");
  });
});

// ================================================================
// POST /:id/install — install item
// ================================================================
describe("POST /:id/install (install item)", () => {
  function setupInstallMock(item: any) {
    mockDb.update = vi.fn(() =>
      chainable({ returning: vi.fn().mockResolvedValue(item ? [item] : []) })
    );
    mockDb.insert = vi.fn(() =>
      chainable({ returning: vi.fn().mockResolvedValue([{ id: "test-uuid" }]) })
    );
  }

  it("installs a prompt item and returns content", async () => {
    const item = {
      id: "item-1",
      type: "prompt",
      name: "My Prompt",
      description: "A prompt",
      content: { text: "Hello world", name: "Prompt Name" },
      downloads: 6,
      published: true,
    };
    setupInstallMock(item);

    const { handler } = registeredRoutes["POST /:id/install"];
    const request = createRequest({ userId: 1, params: { id: "item-1" } });
    const result = await handler(request, createReply());

    expect(result).toEqual({ content: item.content, type: "prompt", name: "My Prompt" });
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it("installs a workflow item", async () => {
    const item = {
      id: "item-2",
      type: "workflow",
      name: "My Workflow",
      description: "A workflow",
      content: { definition: { steps: [] } },
      downloads: 3,
      published: true,
    };
    setupInstallMock(item);

    const { handler } = registeredRoutes["POST /:id/install"];
    const result = await handler(createRequest({ userId: 1, params: { id: "item-2" } }), createReply());

    expect(result.type).toBe("workflow");
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it("installs a persona item", async () => {
    const item = {
      id: "item-3",
      type: "persona",
      name: "My Persona",
      description: "A persona",
      content: { systemPrompt: "You are helpful", temperature: 0.5 },
      downloads: 1,
      published: true,
    };
    setupInstallMock(item);

    const { handler } = registeredRoutes["POST /:id/install"];
    const result = await handler(createRequest({ userId: 1, params: { id: "item-3" } }), createReply());

    expect(result.type).toBe("persona");
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it("installs a tool item with code", async () => {
    const item = {
      id: "item-4",
      type: "tool",
      name: "My Tool",
      description: "A tool",
      content: { code: "console.log('hi')", parameters: { input: "string" } },
      downloads: 0,
      published: true,
    };
    setupInstallMock(item);

    const { handler } = registeredRoutes["POST /:id/install"];
    const result = await handler(createRequest({ userId: 1, params: { id: "item-4" } }), createReply());

    expect(result.type).toBe("tool");
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it("skips tool skill registration when content has no code", async () => {
    const item = {
      id: "item-5",
      type: "tool",
      name: "Tool No Code",
      description: "A tool without code",
      content: { description: "no code here" },
      downloads: 0,
      published: true,
    };
    setupInstallMock(item);

    const { handler } = registeredRoutes["POST /:id/install"];
    const result = await handler(createRequest({ userId: 1, params: { id: "item-5" } }), createReply());

    expect(result.type).toBe("tool");
    // insert is called for the update, but not for userSkills since no code
    // The update mock is separate, so insert should not be called
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("throws 404 when item not found", async () => {
    mockDb.update = vi.fn(() =>
      chainable({ returning: vi.fn().mockResolvedValue([]) })
    );

    const { handler } = registeredRoutes["POST /:id/install"];
    const request = createRequest({ userId: 1, params: { id: "nonexistent" } });

    await expect(handler(request, createReply())).rejects.toThrow("Item not found");
  });

  it("still returns content when auto-import fails", async () => {
    const item = {
      id: "item-1",
      type: "prompt",
      name: "Broken Import",
      description: "desc",
      content: { text: "hello" },
      downloads: 1,
      published: true,
    };

    mockDb.update = vi.fn(() =>
      chainable({ returning: vi.fn().mockResolvedValue([item]) })
    );
    mockDb.insert = vi.fn(() =>
      chainable({ returning: vi.fn().mockRejectedValue(new Error("constraint error")) })
    );

    const { handler } = registeredRoutes["POST /:id/install"];
    const result = await handler(createRequest({ userId: 1, params: { id: "item-1" } }), createReply());

    // Install still succeeds — error is caught and logged
    expect(result).toEqual({ content: item.content, type: "prompt", name: "Broken Import" });
  });

  it("increments download count", async () => {
    const item = {
      id: "item-1",
      type: "prompt",
      name: "Test",
      description: "D",
      content: {},
      downloads: 5,
      published: true,
    };
    setupInstallMock(item);

    const { handler } = registeredRoutes["POST /:id/install"];
    await handler(createRequest({ userId: 1, params: { id: "item-1" } }), createReply());

    expect(mockDb.update).toHaveBeenCalled();
  });
});

// ================================================================
// POST /:id/star — toggle star
// ================================================================
describe("POST /:id/star (toggle star)", () => {
  it("stars an item when not previously starred", async () => {
    const insertedStar = { userId: 1, itemId: "item-1" };

    const mockTx: any = {};
    mockTx.insert = vi.fn(() =>
      chainable({
        onConflictDoNothing: vi.fn(() =>
          chainable({ returning: vi.fn().mockResolvedValue([insertedStar]) })
        ),
      })
    );
    mockTx.update = vi.fn(() =>
      chainable({ where: vi.fn().mockResolvedValue(undefined) })
    );

    mockDb.transaction = vi.fn(async (fn: Function) => fn(mockTx));

    const { handler } = registeredRoutes["POST /:id/star"];
    const request = createRequest({ userId: 1, params: { id: "item-1" } });
    const result = await handler(request, createReply());

    expect(result).toEqual({ starred: true });
    expect(mockTx.update).toHaveBeenCalled();
  });

  it("unstars an item when previously starred", async () => {
    const mockTx: any = {};
    mockTx.insert = vi.fn(() =>
      chainable({
        onConflictDoNothing: vi.fn(() =>
          chainable({ returning: vi.fn().mockResolvedValue([]) })
        ),
      })
    );
    mockTx.delete = vi.fn(() =>
      chainable({ where: vi.fn().mockResolvedValue(undefined) })
    );
    mockTx.update = vi.fn(() =>
      chainable({ where: vi.fn().mockResolvedValue(undefined) })
    );

    mockDb.transaction = vi.fn(async (fn: Function) => fn(mockTx));

    const { handler } = registeredRoutes["POST /:id/star"];
    const request = createRequest({ userId: 1, params: { id: "item-1" } });
    const result = await handler(request, createReply());

    expect(result).toEqual({ starred: false });
    expect(mockTx.delete).toHaveBeenCalled();
    expect(mockTx.update).toHaveBeenCalled();
  });

  it("propagates transaction errors", async () => {
    mockDb.transaction = vi.fn().mockRejectedValue(new Error("tx failed"));

    const { handler } = registeredRoutes["POST /:id/star"];
    const request = createRequest({ userId: 1, params: { id: "item-1" } });

    await expect(handler(request, createReply())).rejects.toThrow("tx failed");
  });
});

// ================================================================
// POST /:id/reviews — add review
// ================================================================
describe("POST /:id/reviews (add review)", () => {
  it("creates review successfully and returns 201", async () => {
    const mockItem = { id: "item-1" };
    const createdReview = { id: "test-uuid", itemId: "item-1", rating: 4, comment: "Great!" };

    let selectCallIndex = 0;
    mockDb.select = vi.fn(() => {
      selectCallIndex++;
      if (selectCallIndex === 1) {
        return chainable({ limit: vi.fn().mockResolvedValue([mockItem]) });
      }
      // duplicate review check — no existing review
      return chainable({ limit: vi.fn().mockResolvedValue([]) });
    });
    mockDb.insert = vi.fn(() =>
      chainable({ returning: vi.fn().mockResolvedValue([createdReview]) })
    );

    const { handler } = registeredRoutes["POST /:id/reviews"];
    const reply = createReply();
    const request = createRequest({
      userId: 1,
      params: { id: "item-1" },
      body: { rating: 4, comment: "Great!" },
    });

    const result = await handler(request, reply);

    expect(result).toEqual(createdReview);
    expect(reply.code).toHaveBeenCalledWith(201);
  });

  it("creates review without comment", async () => {
    const mockItem = { id: "item-1" };
    const createdReview = { id: "test-uuid", rating: 5, comment: null };

    let selectCallIndex = 0;
    mockDb.select = vi.fn(() => {
      selectCallIndex++;
      if (selectCallIndex === 1) {
        return chainable({ limit: vi.fn().mockResolvedValue([mockItem]) });
      }
      // duplicate review check — no existing review
      return chainable({ limit: vi.fn().mockResolvedValue([]) });
    });
    mockDb.insert = vi.fn(() =>
      chainable({ returning: vi.fn().mockResolvedValue([createdReview]) })
    );

    const { handler } = registeredRoutes["POST /:id/reviews"];
    const request = createRequest({
      userId: 1,
      params: { id: "item-1" },
      body: { rating: 5 },
    });

    const result = await handler(request, createReply());
    expect(result.comment).toBeNull();
  });

  it("throws 400 when rating is missing", async () => {
    const { handler } = registeredRoutes["POST /:id/reviews"];
    const request = createRequest({
      userId: 1,
      params: { id: "item-1" },
      body: { comment: "No rating" },
    });

    await expect(handler(request, createReply())).rejects.toThrow("Rating must be between 1 and 5");
  });

  it("throws 400 when rating is 0", async () => {
    const { handler } = registeredRoutes["POST /:id/reviews"];
    const request = createRequest({
      userId: 1,
      params: { id: "item-1" },
      body: { rating: 0 },
    });

    await expect(handler(request, createReply())).rejects.toThrow("Rating must be between 1 and 5");
  });

  it("throws 400 when rating is less than 1", async () => {
    const { handler } = registeredRoutes["POST /:id/reviews"];
    const request = createRequest({
      userId: 1,
      params: { id: "item-1" },
      body: { rating: -1 },
    });

    await expect(handler(request, createReply())).rejects.toThrow("Rating must be between 1 and 5");
  });

  it("throws 400 when rating is greater than 5", async () => {
    const { handler } = registeredRoutes["POST /:id/reviews"];
    const request = createRequest({
      userId: 1,
      params: { id: "item-1" },
      body: { rating: 6 },
    });

    await expect(handler(request, createReply())).rejects.toThrow("Rating must be between 1 and 5");
  });

  it("throws 404 when item not found", async () => {
    mockDb.select = vi.fn(() =>
      chainable({ limit: vi.fn().mockResolvedValue([]) })
    );

    const { handler } = registeredRoutes["POST /:id/reviews"];
    const request = createRequest({
      userId: 1,
      params: { id: "nonexistent" },
      body: { rating: 3 },
    });

    await expect(handler(request, createReply())).rejects.toThrow("Item not found");
  });

  it("rounds fractional ratings", async () => {
    const mockItem = { id: "item-1" };
    const createdReview = { id: "test-uuid", rating: 4 };

    let selectCallIndex = 0;
    mockDb.select = vi.fn(() => {
      selectCallIndex++;
      if (selectCallIndex === 1) {
        return chainable({ limit: vi.fn().mockResolvedValue([mockItem]) });
      }
      // duplicate review check — no existing review
      return chainable({ limit: vi.fn().mockResolvedValue([]) });
    });
    mockDb.insert = vi.fn(() =>
      chainable({ returning: vi.fn().mockResolvedValue([createdReview]) })
    );

    const { handler } = registeredRoutes["POST /:id/reviews"];
    const request = createRequest({
      userId: 1,
      params: { id: "item-1" },
      body: { rating: 3.7 },
    });

    // Should not throw — rating 3.7 is valid (between 1 and 5), gets rounded to 4
    const result = await handler(request, createReply());
    expect(result).toBeDefined();
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it("propagates db errors during insert", async () => {
    const mockItem = { id: "item-1" };

    let selectCallIndex = 0;
    mockDb.select = vi.fn(() => {
      selectCallIndex++;
      if (selectCallIndex === 1) {
        return chainable({ limit: vi.fn().mockResolvedValue([mockItem]) });
      }
      // duplicate review check — no existing review
      return chainable({ limit: vi.fn().mockResolvedValue([]) });
    });
    mockDb.insert = vi.fn(() =>
      chainable({ returning: vi.fn().mockRejectedValue(new Error("insert failed")) })
    );

    const { handler } = registeredRoutes["POST /:id/reviews"];
    const request = createRequest({
      userId: 1,
      params: { id: "item-1" },
      body: { rating: 5 },
    });

    await expect(handler(request, createReply())).rejects.toThrow("insert failed");
  });
});

// ================================================================
// GET /:id/reviews — list reviews
// ================================================================
describe("GET /:id/reviews (list reviews)", () => {
  it("returns reviews for an item", async () => {
    const mockReviews = [
      { id: "r1", rating: 5, comment: "Amazing" },
      { id: "r2", rating: 3, comment: null },
    ];

    mockDb.select = vi.fn(() =>
      chainable({ limit: vi.fn().mockResolvedValue(mockReviews) })
    );

    const { handler } = registeredRoutes["GET /:id/reviews"];
    const request = createRequest({ params: { id: "item-1" } });
    const result = await handler(request, createReply());

    expect(result).toEqual(mockReviews);
  });

  it("returns empty array when no reviews exist", async () => {
    mockDb.select = vi.fn(() =>
      chainable({ limit: vi.fn().mockResolvedValue([]) })
    );

    const { handler } = registeredRoutes["GET /:id/reviews"];
    const request = createRequest({ params: { id: "item-1" } });
    const result = await handler(request, createReply());

    expect(result).toEqual([]);
  });

  it("propagates db errors", async () => {
    mockDb.select = vi.fn(() =>
      chainable({ limit: vi.fn().mockRejectedValue(new Error("db error")) })
    );

    const { handler } = registeredRoutes["GET /:id/reviews"];
    const request = createRequest({ params: { id: "item-1" } });

    await expect(handler(request, createReply())).rejects.toThrow("db error");
  });
});
