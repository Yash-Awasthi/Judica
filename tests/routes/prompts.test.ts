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
  ];
  for (const m of methods) {
    chain[m] = overrides[m] ?? vi.fn(() => chain);
  }
  return chain;
}

vi.mock("../../src/lib/drizzle.js", () => ({
  db: mockDb,
}));

vi.mock("../../src/db/schema/prompts.js", () => ({
  prompts: {
    id: "prompts.id",
    userId: "prompts.userId",
    name: "prompts.name",
    description: "prompts.description",
    createdAt: "prompts.createdAt",
  },
  promptVersions: {
    id: "promptVersions.id",
    promptId: "promptVersions.promptId",
    versionNum: "promptVersions.versionNum",
    content: "promptVersions.content",
    model: "promptVersions.model",
    temperature: "promptVersions.temperature",
    notes: "promptVersions.notes",
    createdAt: "promptVersions.createdAt",
  },
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
    eq: vi.fn((...args: any[]) => args),
    and: vi.fn((...args: any[]) => args),
    desc: vi.fn((col: any) => col),
    max: vi.fn((col: any) => col),
    relations: vi.fn(),
  };
});

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

vi.mock("../../src/router/index.js", () => ({
  routeAndCollect: vi.fn(),
}));

vi.mock("../../src/lib/logger.js", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("crypto", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    randomUUID: vi.fn(() => "mock-uuid"),
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
    send: vi.fn(function (this: any, _b: any) {
      return this;
    }),
  };
  return reply;
}

// ---- import and register the plugin ----

let promptsPlugin: any;

beforeEach(async () => {
  vi.clearAllMocks();
  for (const key of Object.keys(registeredRoutes)) {
    delete registeredRoutes[key];
  }

  const mod = await import("../../src/routes/prompts.js");
  promptsPlugin = mod.default;
  const fastify = createFastifyInstance();
  await promptsPlugin(fastify);
});

// ================================================================
// Route registration
// ================================================================
describe("route registration", () => {
  it("registers all expected routes", () => {
    expect(registeredRoutes["GET /"]).toBeDefined();
    expect(registeredRoutes["POST /"]).toBeDefined();
    expect(registeredRoutes["GET /:id"]).toBeDefined();
    expect(registeredRoutes["DELETE /:id"]).toBeDefined();
    expect(registeredRoutes["GET /:id/versions"]).toBeDefined();
    expect(registeredRoutes["POST /:id/versions"]).toBeDefined();
    expect(registeredRoutes["GET /:id/versions/:versionNum"]).toBeDefined();
    expect(registeredRoutes["POST /test"]).toBeDefined();
  });

  it("all routes have a preHandler for auth", () => {
    for (const key of Object.keys(registeredRoutes)) {
      expect(registeredRoutes[key].preHandler).toBeDefined();
    }
  });
});

// ================================================================
// GET / — list user's prompts
// ================================================================
describe("GET /", () => {
  it("returns prompts with their latest version", async () => {
    const mockPrompts = [
      { id: "p1", userId: 1, name: "Prompt 1", description: null, createdAt: new Date() },
      { id: "p2", userId: 1, name: "Prompt 2", description: "desc", createdAt: new Date() },
    ];
    const mockVersion1 = [{ id: "v1", versionNum: 3, createdAt: new Date() }];
    const mockVersion2 = [{ id: "v2", versionNum: 1, createdAt: new Date() }];

    // First select: list prompts
    let selectCallIndex = 0;
    mockDb.select = vi.fn(() => {
      selectCallIndex++;
      if (selectCallIndex === 1) {
        // prompts query
        return chainable({
          from: vi.fn(() =>
            chainable({
              where: vi.fn(() =>
                chainable({
                  orderBy: vi.fn().mockResolvedValue(mockPrompts),
                }),
              ),
            }),
          ),
        });
      }
      if (selectCallIndex === 2) {
        // versions query for p1
        return chainable({
          from: vi.fn(() =>
            chainable({
              where: vi.fn(() =>
                chainable({
                  orderBy: vi.fn(() =>
                    chainable({
                      limit: vi.fn().mockResolvedValue(mockVersion1),
                    }),
                  ),
                }),
              ),
            }),
          ),
        });
      }
      // versions query for p2
      return chainable({
        from: vi.fn(() =>
          chainable({
            where: vi.fn(() =>
              chainable({
                orderBy: vi.fn(() =>
                  chainable({
                    limit: vi.fn().mockResolvedValue(mockVersion2),
                  }),
                ),
              }),
            ),
          }),
        ),
      });
    });

    const { handler } = registeredRoutes["GET /"];
    const result = await handler(createRequest(), createReply());

    expect(result.prompts).toHaveLength(2);
    expect(result.prompts[0]).toEqual({ ...mockPrompts[0], versions: mockVersion1 });
    expect(result.prompts[1]).toEqual({ ...mockPrompts[1], versions: mockVersion2 });
  });

  it("returns empty array when user has no prompts", async () => {
    mockDb.select = vi.fn(() =>
      chainable({
        from: vi.fn(() =>
          chainable({
            where: vi.fn(() =>
              chainable({
                orderBy: vi.fn().mockResolvedValue([]),
              }),
            ),
          }),
        ),
      }),
    );

    const { handler } = registeredRoutes["GET /"];
    const result = await handler(createRequest(), createReply());
    expect(result).toEqual({ prompts: [] });
  });

  it("propagates db errors", async () => {
    mockDb.select = vi.fn(() =>
      chainable({
        from: vi.fn(() =>
          chainable({
            where: vi.fn(() =>
              chainable({
                orderBy: vi.fn().mockRejectedValue(new Error("db down")),
              }),
            ),
          }),
        ),
      }),
    );

    const { handler } = registeredRoutes["GET /"];
    await expect(handler(createRequest(), createReply())).rejects.toThrow("db down");
  });
});

// ================================================================
// POST / — create prompt + first version
// ================================================================
describe("POST /", () => {
  it("creates prompt and first version, returns 201", async () => {
    const newPrompt = { id: "mock-uuid", userId: 1, name: "My Prompt", description: null, createdAt: new Date() };
    const newVersion = { id: "mock-uuid", promptId: "mock-uuid", versionNum: 1, content: "Hello", model: null, temperature: null, createdAt: new Date() };

    let insertCallIndex = 0;
    mockDb.insert = vi.fn(() => {
      insertCallIndex++;
      const returnVal = insertCallIndex === 1 ? [newPrompt] : [newVersion];
      return chainable({
        values: vi.fn(() =>
          chainable({
            returning: vi.fn().mockResolvedValue(returnVal),
          }),
        ),
      });
    });

    const { handler } = registeredRoutes["POST /"];
    const reply = createReply();
    const request = createRequest({
      body: { name: "My Prompt", content: "Hello" },
    });

    const result = await handler(request, reply);
    expect(reply.code).toHaveBeenCalledWith(201);
    expect(result).toEqual({ ...newPrompt, versions: [newVersion] });
  });

  it("trims name, description, and content", async () => {
    const newPrompt = { id: "mock-uuid", name: "Trimmed" };
    const newVersion = { id: "mock-uuid", content: "trimmed content" };

    let insertCallIndex = 0;
    const capturedValues: any[] = [];

    mockDb.insert = vi.fn(() => {
      insertCallIndex++;
      return chainable({
        values: vi.fn((vals: any) => {
          capturedValues.push(vals);
          return chainable({
            returning: vi.fn().mockResolvedValue(
              insertCallIndex === 1 ? [newPrompt] : [newVersion],
            ),
          });
        }),
      });
    });

    const { handler } = registeredRoutes["POST /"];
    await handler(
      createRequest({
        body: { name: "  Trimmed  ", description: "  desc  ", content: "  trimmed content  " },
      }),
      createReply(),
    );

    expect(capturedValues[0].name).toBe("Trimmed");
    expect(capturedValues[0].description).toBe("desc");
    expect(capturedValues[1].content).toBe("trimmed content");
  });

  it("sets description to null when not provided", async () => {
    const capturedValues: any[] = [];

    mockDb.insert = vi.fn(() =>
      chainable({
        values: vi.fn((vals: any) => {
          capturedValues.push(vals);
          return chainable({
            returning: vi.fn().mockResolvedValue([{ id: "mock-uuid" }]),
          });
        }),
      }),
    );

    const { handler } = registeredRoutes["POST /"];
    await handler(
      createRequest({ body: { name: "Test", content: "Content" } }),
      createReply(),
    );

    expect(capturedValues[0].description).toBeNull();
  });

  it("passes model and temperature to version", async () => {
    const capturedValues: any[] = [];

    mockDb.insert = vi.fn(() =>
      chainable({
        values: vi.fn((vals: any) => {
          capturedValues.push(vals);
          return chainable({
            returning: vi.fn().mockResolvedValue([{ id: "mock-uuid" }]),
          });
        }),
      }),
    );

    const { handler } = registeredRoutes["POST /"];
    await handler(
      createRequest({ body: { name: "Test", content: "Content", model: "gpt-4", temperature: 0.7 } }),
      createReply(),
    );

    // Second insert call is the version
    expect(capturedValues[1].model).toBe("gpt-4");
    expect(capturedValues[1].temperature).toBe(0.7);
  });

  it("sets model to null when not provided", async () => {
    const capturedValues: any[] = [];

    mockDb.insert = vi.fn(() =>
      chainable({
        values: vi.fn((vals: any) => {
          capturedValues.push(vals);
          return chainable({
            returning: vi.fn().mockResolvedValue([{ id: "mock-uuid" }]),
          });
        }),
      }),
    );

    const { handler } = registeredRoutes["POST /"];
    await handler(
      createRequest({ body: { name: "Test", content: "Content" } }),
      createReply(),
    );

    expect(capturedValues[1].model).toBeNull();
    expect(capturedValues[1].temperature).toBeNull();
  });

  it("preserves temperature of 0", async () => {
    const capturedValues: any[] = [];

    mockDb.insert = vi.fn(() =>
      chainable({
        values: vi.fn((vals: any) => {
          capturedValues.push(vals);
          return chainable({
            returning: vi.fn().mockResolvedValue([{ id: "mock-uuid" }]),
          });
        }),
      }),
    );

    const { handler } = registeredRoutes["POST /"];
    await handler(
      createRequest({ body: { name: "Test", content: "Content", temperature: 0 } }),
      createReply(),
    );

    expect(capturedValues[1].temperature).toBe(0);
  });

  it("throws AppError when name is missing", async () => {
    const { handler } = registeredRoutes["POST /"];
    await expect(
      handler(createRequest({ body: { content: "Hello" } }), createReply()),
    ).rejects.toThrow("Name is required");
  });

  it("throws AppError when name is empty string", async () => {
    const { handler } = registeredRoutes["POST /"];
    await expect(
      handler(createRequest({ body: { name: "", content: "Hello" } }), createReply()),
    ).rejects.toThrow("Name is required");
  });

  it("throws AppError when name is whitespace only", async () => {
    const { handler } = registeredRoutes["POST /"];
    await expect(
      handler(createRequest({ body: { name: "   ", content: "Hello" } }), createReply()),
    ).rejects.toThrow("Name is required");
  });

  it("throws AppError when name is not a string", async () => {
    const { handler } = registeredRoutes["POST /"];
    await expect(
      handler(createRequest({ body: { name: 123, content: "Hello" } }), createReply()),
    ).rejects.toThrow("Name is required");
  });

  it("throws AppError when content is missing", async () => {
    const { handler } = registeredRoutes["POST /"];
    await expect(
      handler(createRequest({ body: { name: "Test" } }), createReply()),
    ).rejects.toThrow("Content is required");
  });

  it("throws AppError when content is empty string", async () => {
    const { handler } = registeredRoutes["POST /"];
    await expect(
      handler(createRequest({ body: { name: "Test", content: "" } }), createReply()),
    ).rejects.toThrow("Content is required");
  });

  it("throws AppError when content is whitespace only", async () => {
    const { handler } = registeredRoutes["POST /"];
    await expect(
      handler(createRequest({ body: { name: "Test", content: "   " } }), createReply()),
    ).rejects.toThrow("Content is required");
  });

  it("throws AppError when content is not a string", async () => {
    const { handler } = registeredRoutes["POST /"];
    await expect(
      handler(createRequest({ body: { name: "Test", content: 42 } }), createReply()),
    ).rejects.toThrow("Content is required");
  });

  it("propagates db errors during insert", async () => {
    mockDb.insert = vi.fn(() =>
      chainable({
        values: vi.fn(() =>
          chainable({
            returning: vi.fn().mockRejectedValue(new Error("insert failed")),
          }),
        ),
      }),
    );

    const { handler } = registeredRoutes["POST /"];
    await expect(
      handler(createRequest({ body: { name: "Test", content: "Hello" } }), createReply()),
    ).rejects.toThrow("insert failed");
  });
});

// ================================================================
// GET /:id — get prompt detail with latest version
// ================================================================
describe("GET /:id", () => {
  it("returns prompt with latest version", async () => {
    const mockPrompt = { id: "p1", userId: 1, name: "Prompt", description: null, createdAt: new Date() };
    const mockVersions = [{ id: "v1", versionNum: 2, content: "v2 content" }];

    let selectCallIndex = 0;
    mockDb.select = vi.fn(() => {
      selectCallIndex++;
      if (selectCallIndex === 1) {
        return chainable({
          from: vi.fn(() =>
            chainable({
              where: vi.fn().mockResolvedValue([mockPrompt]),
            }),
          ),
        });
      }
      return chainable({
        from: vi.fn(() =>
          chainable({
            where: vi.fn(() =>
              chainable({
                orderBy: vi.fn(() =>
                  chainable({
                    limit: vi.fn().mockResolvedValue(mockVersions),
                  }),
                ),
              }),
            ),
          }),
        ),
      });
    });

    const { handler } = registeredRoutes["GET /:id"];
    const result = await handler(
      createRequest({ params: { id: "p1" } }),
      createReply(),
    );

    expect(result).toEqual({ ...mockPrompt, versions: mockVersions });
  });

  it("throws 404 when prompt not found", async () => {
    mockDb.select = vi.fn(() =>
      chainable({
        from: vi.fn(() =>
          chainable({
            where: vi.fn().mockResolvedValue([]),
          }),
        ),
      }),
    );

    const { handler } = registeredRoutes["GET /:id"];
    await expect(
      handler(createRequest({ params: { id: "nonexistent" } }), createReply()),
    ).rejects.toThrow("Prompt not found");
  });

  it("scopes query to authenticated user", async () => {
    // When prompt exists for different user, it should not be found
    mockDb.select = vi.fn(() =>
      chainable({
        from: vi.fn(() =>
          chainable({
            where: vi.fn().mockResolvedValue([]),
          }),
        ),
      }),
    );

    const { handler } = registeredRoutes["GET /:id"];
    await expect(
      handler(createRequest({ userId: 99, params: { id: "p1" } }), createReply()),
    ).rejects.toThrow("Prompt not found");
  });

  it("propagates db errors", async () => {
    mockDb.select = vi.fn(() =>
      chainable({
        from: vi.fn(() =>
          chainable({
            where: vi.fn().mockRejectedValue(new Error("db error")),
          }),
        ),
      }),
    );

    const { handler } = registeredRoutes["GET /:id"];
    await expect(
      handler(createRequest({ params: { id: "p1" } }), createReply()),
    ).rejects.toThrow("db error");
  });
});

// ================================================================
// DELETE /:id — delete prompt
// ================================================================
describe("DELETE /:id", () => {
  it("deletes prompt and returns success", async () => {
    const mockPrompt = { id: "p1", userId: 1, name: "To Delete" };

    mockDb.select = vi.fn(() =>
      chainable({
        from: vi.fn(() =>
          chainable({
            where: vi.fn().mockResolvedValue([mockPrompt]),
          }),
        ),
      }),
    );
    mockDb.delete = vi.fn(() =>
      chainable({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    );

    const { handler } = registeredRoutes["DELETE /:id"];
    const result = await handler(
      createRequest({ params: { id: "p1" } }),
      createReply(),
    );

    expect(result).toEqual({ success: true });
    expect(mockDb.delete).toHaveBeenCalled();
  });

  it("throws 404 when prompt not found", async () => {
    mockDb.select = vi.fn(() =>
      chainable({
        from: vi.fn(() =>
          chainable({
            where: vi.fn().mockResolvedValue([]),
          }),
        ),
      }),
    );

    const { handler } = registeredRoutes["DELETE /:id"];
    await expect(
      handler(createRequest({ params: { id: "nonexistent" } }), createReply()),
    ).rejects.toThrow("Prompt not found");
  });

  it("does not call delete when prompt not found", async () => {
    mockDb.select = vi.fn(() =>
      chainable({
        from: vi.fn(() =>
          chainable({
            where: vi.fn().mockResolvedValue([]),
          }),
        ),
      }),
    );
    mockDb.delete = vi.fn();

    const { handler } = registeredRoutes["DELETE /:id"];
    await expect(
      handler(createRequest({ params: { id: "nonexistent" } }), createReply()),
    ).rejects.toThrow("Prompt not found");
    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it("propagates db errors during select", async () => {
    mockDb.select = vi.fn(() =>
      chainable({
        from: vi.fn(() =>
          chainable({
            where: vi.fn().mockRejectedValue(new Error("select failed")),
          }),
        ),
      }),
    );

    const { handler } = registeredRoutes["DELETE /:id"];
    await expect(
      handler(createRequest({ params: { id: "p1" } }), createReply()),
    ).rejects.toThrow("select failed");
  });

  it("propagates db errors during delete", async () => {
    const mockPrompt = { id: "p1", userId: 1, name: "Prompt" };

    mockDb.select = vi.fn(() =>
      chainable({
        from: vi.fn(() =>
          chainable({
            where: vi.fn().mockResolvedValue([mockPrompt]),
          }),
        ),
      }),
    );
    mockDb.delete = vi.fn(() =>
      chainable({
        where: vi.fn().mockRejectedValue(new Error("delete failed")),
      }),
    );

    const { handler } = registeredRoutes["DELETE /:id"];
    await expect(
      handler(createRequest({ params: { id: "p1" } }), createReply()),
    ).rejects.toThrow("delete failed");
  });
});

// ================================================================
// GET /:id/versions — list all versions for prompt
// ================================================================
describe("GET /:id/versions", () => {
  it("returns all versions for a prompt", async () => {
    const mockPrompt = { id: "p1", userId: 1, name: "Prompt" };
    const mockVersions = [
      { id: "v2", versionNum: 2, content: "v2" },
      { id: "v1", versionNum: 1, content: "v1" },
    ];

    let selectCallIndex = 0;
    mockDb.select = vi.fn(() => {
      selectCallIndex++;
      if (selectCallIndex === 1) {
        return chainable({
          from: vi.fn(() =>
            chainable({
              where: vi.fn().mockResolvedValue([mockPrompt]),
            }),
          ),
        });
      }
      return chainable({
        from: vi.fn(() =>
          chainable({
            where: vi.fn(() =>
              chainable({
                orderBy: vi.fn().mockResolvedValue(mockVersions),
              }),
            ),
          }),
        ),
      });
    });

    const { handler } = registeredRoutes["GET /:id/versions"];
    const result = await handler(
      createRequest({ params: { id: "p1" } }),
      createReply(),
    );

    expect(result).toEqual({ versions: mockVersions });
  });

  it("returns empty versions array when prompt has no versions", async () => {
    const mockPrompt = { id: "p1", userId: 1, name: "Prompt" };

    let selectCallIndex = 0;
    mockDb.select = vi.fn(() => {
      selectCallIndex++;
      if (selectCallIndex === 1) {
        return chainable({
          from: vi.fn(() =>
            chainable({
              where: vi.fn().mockResolvedValue([mockPrompt]),
            }),
          ),
        });
      }
      return chainable({
        from: vi.fn(() =>
          chainable({
            where: vi.fn(() =>
              chainable({
                orderBy: vi.fn().mockResolvedValue([]),
              }),
            ),
          }),
        ),
      });
    });

    const { handler } = registeredRoutes["GET /:id/versions"];
    const result = await handler(
      createRequest({ params: { id: "p1" } }),
      createReply(),
    );

    expect(result).toEqual({ versions: [] });
  });

  it("throws 404 when prompt not found", async () => {
    mockDb.select = vi.fn(() =>
      chainable({
        from: vi.fn(() =>
          chainable({
            where: vi.fn().mockResolvedValue([]),
          }),
        ),
      }),
    );

    const { handler } = registeredRoutes["GET /:id/versions"];
    await expect(
      handler(createRequest({ params: { id: "nonexistent" } }), createReply()),
    ).rejects.toThrow("Prompt not found");
  });

  it("propagates db errors", async () => {
    mockDb.select = vi.fn(() =>
      chainable({
        from: vi.fn(() =>
          chainable({
            where: vi.fn().mockRejectedValue(new Error("db error")),
          }),
        ),
      }),
    );

    const { handler } = registeredRoutes["GET /:id/versions"];
    await expect(
      handler(createRequest({ params: { id: "p1" } }), createReply()),
    ).rejects.toThrow("db error");
  });
});

// ================================================================
// POST /:id/versions — create new version
// ================================================================
describe("POST /:id/versions", () => {
  it("creates a new version with auto-incremented versionNum and returns 201", async () => {
    const mockPrompt = { id: "p1", userId: 1, name: "Prompt" };
    const newVersion = { id: "mock-uuid", promptId: "p1", versionNum: 4, content: "New content" };

    mockDb.select = vi.fn(() =>
      chainable({
        from: vi.fn(() =>
          chainable({
            where: vi.fn().mockResolvedValue([mockPrompt]),
          }),
        ),
      }),
    );

    // Mock transaction
    mockDb.transaction = vi.fn(async (cb: Function) => {
      const tx: any = {};
      // tx.select().from().where() returns maxVersion
      tx.select = vi.fn(() =>
        chainable({
          from: vi.fn(() =>
            chainable({
              where: vi.fn().mockResolvedValue([{ maxVersion: 3 }]),
            }),
          ),
        }),
      );
      // tx.insert().values().returning() returns new version
      tx.insert = vi.fn(() =>
        chainable({
          values: vi.fn(() =>
            chainable({
              returning: vi.fn().mockResolvedValue([newVersion]),
            }),
          ),
        }),
      );
      return cb(tx);
    });

    const { handler } = registeredRoutes["POST /:id/versions"];
    const reply = createReply();
    const result = await handler(
      createRequest({ params: { id: "p1" }, body: { content: "New content" } }),
      reply,
    );

    expect(reply.code).toHaveBeenCalledWith(201);
    expect(result).toEqual(newVersion);
  });

  it("starts at version 1 when no previous versions exist", async () => {
    const mockPrompt = { id: "p1", userId: 1, name: "Prompt" };

    mockDb.select = vi.fn(() =>
      chainable({
        from: vi.fn(() =>
          chainable({
            where: vi.fn().mockResolvedValue([mockPrompt]),
          }),
        ),
      }),
    );

    const capturedValues: any[] = [];
    mockDb.transaction = vi.fn(async (cb: Function) => {
      const tx: any = {};
      tx.select = vi.fn(() =>
        chainable({
          from: vi.fn(() =>
            chainable({
              where: vi.fn().mockResolvedValue([{ maxVersion: null }]),
            }),
          ),
        }),
      );
      tx.insert = vi.fn(() =>
        chainable({
          values: vi.fn((vals: any) => {
            capturedValues.push(vals);
            return chainable({
              returning: vi.fn().mockResolvedValue([{ id: "mock-uuid", versionNum: 1 }]),
            });
          }),
        }),
      );
      return cb(tx);
    });

    const { handler } = registeredRoutes["POST /:id/versions"];
    await handler(
      createRequest({ params: { id: "p1" }, body: { content: "First" } }),
      createReply(),
    );

    expect(capturedValues[0].versionNum).toBe(1);
  });

  it("trims content and notes", async () => {
    const mockPrompt = { id: "p1", userId: 1, name: "Prompt" };

    mockDb.select = vi.fn(() =>
      chainable({
        from: vi.fn(() =>
          chainable({
            where: vi.fn().mockResolvedValue([mockPrompt]),
          }),
        ),
      }),
    );

    const capturedValues: any[] = [];
    mockDb.transaction = vi.fn(async (cb: Function) => {
      const tx: any = {};
      tx.select = vi.fn(() =>
        chainable({
          from: vi.fn(() =>
            chainable({
              where: vi.fn().mockResolvedValue([{ maxVersion: 1 }]),
            }),
          ),
        }),
      );
      tx.insert = vi.fn(() =>
        chainable({
          values: vi.fn((vals: any) => {
            capturedValues.push(vals);
            return chainable({
              returning: vi.fn().mockResolvedValue([{ id: "mock-uuid" }]),
            });
          }),
        }),
      );
      return cb(tx);
    });

    const { handler } = registeredRoutes["POST /:id/versions"];
    await handler(
      createRequest({
        params: { id: "p1" },
        body: { content: "  trimmed  ", notes: "  note  ", model: "gpt-4", temperature: 0.5 },
      }),
      createReply(),
    );

    expect(capturedValues[0].content).toBe("trimmed");
    expect(capturedValues[0].notes).toBe("note");
    expect(capturedValues[0].model).toBe("gpt-4");
    expect(capturedValues[0].temperature).toBe(0.5);
  });

  it("sets model to null when empty string", async () => {
    const mockPrompt = { id: "p1", userId: 1, name: "Prompt" };

    mockDb.select = vi.fn(() =>
      chainable({
        from: vi.fn(() =>
          chainable({
            where: vi.fn().mockResolvedValue([mockPrompt]),
          }),
        ),
      }),
    );

    const capturedValues: any[] = [];
    mockDb.transaction = vi.fn(async (cb: Function) => {
      const tx: any = {};
      tx.select = vi.fn(() =>
        chainable({
          from: vi.fn(() =>
            chainable({
              where: vi.fn().mockResolvedValue([{ maxVersion: 1 }]),
            }),
          ),
        }),
      );
      tx.insert = vi.fn(() =>
        chainable({
          values: vi.fn((vals: any) => {
            capturedValues.push(vals);
            return chainable({
              returning: vi.fn().mockResolvedValue([{ id: "mock-uuid" }]),
            });
          }),
        }),
      );
      return cb(tx);
    });

    const { handler } = registeredRoutes["POST /:id/versions"];
    await handler(
      createRequest({ params: { id: "p1" }, body: { content: "Hello", model: "" } }),
      createReply(),
    );

    expect(capturedValues[0].model).toBeNull();
  });

  it("sets notes to null when not provided", async () => {
    const mockPrompt = { id: "p1", userId: 1, name: "Prompt" };

    mockDb.select = vi.fn(() =>
      chainable({
        from: vi.fn(() =>
          chainable({
            where: vi.fn().mockResolvedValue([mockPrompt]),
          }),
        ),
      }),
    );

    const capturedValues: any[] = [];
    mockDb.transaction = vi.fn(async (cb: Function) => {
      const tx: any = {};
      tx.select = vi.fn(() =>
        chainable({
          from: vi.fn(() =>
            chainable({
              where: vi.fn().mockResolvedValue([{ maxVersion: 0 }]),
            }),
          ),
        }),
      );
      tx.insert = vi.fn(() =>
        chainable({
          values: vi.fn((vals: any) => {
            capturedValues.push(vals);
            return chainable({
              returning: vi.fn().mockResolvedValue([{ id: "mock-uuid" }]),
            });
          }),
        }),
      );
      return cb(tx);
    });

    const { handler } = registeredRoutes["POST /:id/versions"];
    await handler(
      createRequest({ params: { id: "p1" }, body: { content: "Hello" } }),
      createReply(),
    );

    expect(capturedValues[0].notes).toBeNull();
  });

  it("throws 404 when prompt not found", async () => {
    mockDb.select = vi.fn(() =>
      chainable({
        from: vi.fn(() =>
          chainable({
            where: vi.fn().mockResolvedValue([]),
          }),
        ),
      }),
    );

    const { handler } = registeredRoutes["POST /:id/versions"];
    await expect(
      handler(
        createRequest({ params: { id: "nonexistent" }, body: { content: "Hello" } }),
        createReply(),
      ),
    ).rejects.toThrow("Prompt not found");
  });

  it("throws AppError when content is missing", async () => {
    const mockPrompt = { id: "p1", userId: 1, name: "Prompt" };

    mockDb.select = vi.fn(() =>
      chainable({
        from: vi.fn(() =>
          chainable({
            where: vi.fn().mockResolvedValue([mockPrompt]),
          }),
        ),
      }),
    );

    const { handler } = registeredRoutes["POST /:id/versions"];
    await expect(
      handler(createRequest({ params: { id: "p1" }, body: {} }), createReply()),
    ).rejects.toThrow("Content is required");
  });

  it("throws AppError when content is empty string", async () => {
    const mockPrompt = { id: "p1", userId: 1, name: "Prompt" };

    mockDb.select = vi.fn(() =>
      chainable({
        from: vi.fn(() =>
          chainable({
            where: vi.fn().mockResolvedValue([mockPrompt]),
          }),
        ),
      }),
    );

    const { handler } = registeredRoutes["POST /:id/versions"];
    await expect(
      handler(createRequest({ params: { id: "p1" }, body: { content: "" } }), createReply()),
    ).rejects.toThrow("Content is required");
  });

  it("throws AppError when content is whitespace only", async () => {
    const mockPrompt = { id: "p1", userId: 1, name: "Prompt" };

    mockDb.select = vi.fn(() =>
      chainable({
        from: vi.fn(() =>
          chainable({
            where: vi.fn().mockResolvedValue([mockPrompt]),
          }),
        ),
      }),
    );

    const { handler } = registeredRoutes["POST /:id/versions"];
    await expect(
      handler(createRequest({ params: { id: "p1" }, body: { content: "   " } }), createReply()),
    ).rejects.toThrow("Content is required");
  });

  it("throws AppError when content is not a string", async () => {
    const mockPrompt = { id: "p1", userId: 1, name: "Prompt" };

    mockDb.select = vi.fn(() =>
      chainable({
        from: vi.fn(() =>
          chainable({
            where: vi.fn().mockResolvedValue([mockPrompt]),
          }),
        ),
      }),
    );

    const { handler } = registeredRoutes["POST /:id/versions"];
    await expect(
      handler(createRequest({ params: { id: "p1" }, body: { content: 123 } }), createReply()),
    ).rejects.toThrow("Content is required");
  });

  it("propagates db errors during transaction", async () => {
    const mockPrompt = { id: "p1", userId: 1, name: "Prompt" };

    mockDb.select = vi.fn(() =>
      chainable({
        from: vi.fn(() =>
          chainable({
            where: vi.fn().mockResolvedValue([mockPrompt]),
          }),
        ),
      }),
    );
    mockDb.transaction = vi.fn().mockRejectedValue(new Error("transaction failed"));

    const { handler } = registeredRoutes["POST /:id/versions"];
    await expect(
      handler(
        createRequest({ params: { id: "p1" }, body: { content: "Hello" } }),
        createReply(),
      ),
    ).rejects.toThrow("transaction failed");
  });
});

// ================================================================
// GET /:id/versions/:versionNum — get specific version
// ================================================================
describe("GET /:id/versions/:versionNum", () => {
  it("returns the specific version", async () => {
    const mockPrompt = { id: "p1", userId: 1, name: "Prompt" };
    const mockVersion = { id: "v1", promptId: "p1", versionNum: 2, content: "v2 content" };

    let selectCallIndex = 0;
    mockDb.select = vi.fn(() => {
      selectCallIndex++;
      if (selectCallIndex === 1) {
        return chainable({
          from: vi.fn(() =>
            chainable({
              where: vi.fn().mockResolvedValue([mockPrompt]),
            }),
          ),
        });
      }
      return chainable({
        from: vi.fn(() =>
          chainable({
            where: vi.fn().mockResolvedValue([mockVersion]),
          }),
        ),
      });
    });

    const { handler } = registeredRoutes["GET /:id/versions/:versionNum"];
    const result = await handler(
      createRequest({ params: { id: "p1", versionNum: "2" } }),
      createReply(),
    );

    expect(result).toEqual(mockVersion);
  });

  it("throws 404 when prompt not found", async () => {
    mockDb.select = vi.fn(() =>
      chainable({
        from: vi.fn(() =>
          chainable({
            where: vi.fn().mockResolvedValue([]),
          }),
        ),
      }),
    );

    const { handler } = registeredRoutes["GET /:id/versions/:versionNum"];
    await expect(
      handler(createRequest({ params: { id: "nonexistent", versionNum: "1" } }), createReply()),
    ).rejects.toThrow("Prompt not found");
  });

  it("throws 404 when version not found", async () => {
    const mockPrompt = { id: "p1", userId: 1, name: "Prompt" };

    let selectCallIndex = 0;
    mockDb.select = vi.fn(() => {
      selectCallIndex++;
      if (selectCallIndex === 1) {
        return chainable({
          from: vi.fn(() =>
            chainable({
              where: vi.fn().mockResolvedValue([mockPrompt]),
            }),
          ),
        });
      }
      return chainable({
        from: vi.fn(() =>
          chainable({
            where: vi.fn().mockResolvedValue([]),
          }),
        ),
      });
    });

    const { handler } = registeredRoutes["GET /:id/versions/:versionNum"];
    await expect(
      handler(createRequest({ params: { id: "p1", versionNum: "999" } }), createReply()),
    ).rejects.toThrow("Version not found");
  });

  it("throws 400 for invalid (non-numeric) versionNum", async () => {
    const mockPrompt = { id: "p1", userId: 1, name: "Prompt" };

    mockDb.select = vi.fn(() =>
      chainable({
        from: vi.fn(() =>
          chainable({
            where: vi.fn().mockResolvedValue([mockPrompt]),
          }),
        ),
      }),
    );

    const { handler } = registeredRoutes["GET /:id/versions/:versionNum"];
    await expect(
      handler(createRequest({ params: { id: "p1", versionNum: "abc" } }), createReply()),
    ).rejects.toThrow("Invalid version number");
  });

  it("throws 400 for NaN versionNum", async () => {
    const mockPrompt = { id: "p1", userId: 1, name: "Prompt" };

    mockDb.select = vi.fn(() =>
      chainable({
        from: vi.fn(() =>
          chainable({
            where: vi.fn().mockResolvedValue([mockPrompt]),
          }),
        ),
      }),
    );

    const { handler } = registeredRoutes["GET /:id/versions/:versionNum"];
    await expect(
      handler(createRequest({ params: { id: "p1", versionNum: "NaN" } }), createReply()),
    ).rejects.toThrow("Invalid version number");
  });

  it("propagates db errors", async () => {
    mockDb.select = vi.fn(() =>
      chainable({
        from: vi.fn(() =>
          chainable({
            where: vi.fn().mockRejectedValue(new Error("db error")),
          }),
        ),
      }),
    );

    const { handler } = registeredRoutes["GET /:id/versions/:versionNum"];
    await expect(
      handler(createRequest({ params: { id: "p1", versionNum: "1" } }), createReply()),
    ).rejects.toThrow("db error");
  });
});

// ================================================================
// POST /test — test a prompt against LLM
// ================================================================
describe("POST /test", () => {
  it("sends prompt to LLM and returns response with latency and usage", async () => {
    const { routeAndCollect } = await import("../../src/router/index.js");
    const mockRouteAndCollect = routeAndCollect as ReturnType<typeof vi.fn>;

    mockRouteAndCollect.mockResolvedValue({
      text: "Hello from LLM",
      usage: { promptTokens: 10, completionTokens: 20 },
    });

    const { handler } = registeredRoutes["POST /test"];
    const result = await handler(
      createRequest({ body: { content: "Say hello" } }),
      createReply(),
    );

    expect(result.response).toBe("Hello from LLM");
    expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 20 });
    expect(typeof result.latency_ms).toBe("number");
    expect(result.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it("replaces {{input}} placeholder with test_input", async () => {
    const { routeAndCollect } = await import("../../src/router/index.js");
    const mockRouteAndCollect = routeAndCollect as ReturnType<typeof vi.fn>;

    mockRouteAndCollect.mockResolvedValue({ text: "response", usage: {} });

    const { handler } = registeredRoutes["POST /test"];
    await handler(
      createRequest({
        body: { content: "Translate {{input}} to French", test_input: "hello" },
      }),
      createReply(),
    );

    expect(mockRouteAndCollect).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [{ role: "user", content: "Translate hello to French" }],
      }),
      expect.any(Object),
    );
  });

  it("replaces multiple {{input}} placeholders", async () => {
    const { routeAndCollect } = await import("../../src/router/index.js");
    const mockRouteAndCollect = routeAndCollect as ReturnType<typeof vi.fn>;

    mockRouteAndCollect.mockResolvedValue({ text: "response", usage: {} });

    const { handler } = registeredRoutes["POST /test"];
    await handler(
      createRequest({
        body: { content: "{{input}} and {{input}}", test_input: "word" },
      }),
      createReply(),
    );

    expect(mockRouteAndCollect).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [{ role: "user", content: "word and word" }],
      }),
      expect.any(Object),
    );
  });

  it("does not replace {{input}} when test_input is not provided", async () => {
    const { routeAndCollect } = await import("../../src/router/index.js");
    const mockRouteAndCollect = routeAndCollect as ReturnType<typeof vi.fn>;

    mockRouteAndCollect.mockResolvedValue({ text: "response", usage: {} });

    const { handler } = registeredRoutes["POST /test"];
    await handler(
      createRequest({ body: { content: "Hello {{input}}" } }),
      createReply(),
    );

    expect(mockRouteAndCollect).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [{ role: "user", content: "Hello {{input}}" }],
      }),
      expect.any(Object),
    );
  });

  it("uses provided model", async () => {
    const { routeAndCollect } = await import("../../src/router/index.js");
    const mockRouteAndCollect = routeAndCollect as ReturnType<typeof vi.fn>;

    mockRouteAndCollect.mockResolvedValue({ text: "response", usage: {} });

    const { handler } = registeredRoutes["POST /test"];
    await handler(
      createRequest({ body: { content: "Hello", model: "gpt-4" } }),
      createReply(),
    );

    expect(mockRouteAndCollect).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-4" }),
      expect.objectContaining({ preferredModel: "gpt-4" }),
    );
  });

  it("defaults model to 'auto' when not provided", async () => {
    const { routeAndCollect } = await import("../../src/router/index.js");
    const mockRouteAndCollect = routeAndCollect as ReturnType<typeof vi.fn>;

    mockRouteAndCollect.mockResolvedValue({ text: "response", usage: {} });

    const { handler } = registeredRoutes["POST /test"];
    await handler(
      createRequest({ body: { content: "Hello" } }),
      createReply(),
    );

    expect(mockRouteAndCollect).toHaveBeenCalledWith(
      expect.objectContaining({ model: "auto" }),
      expect.objectContaining({ preferredModel: undefined }),
    );
  });

  it("passes temperature when provided", async () => {
    const { routeAndCollect } = await import("../../src/router/index.js");
    const mockRouteAndCollect = routeAndCollect as ReturnType<typeof vi.fn>;

    mockRouteAndCollect.mockResolvedValue({ text: "response", usage: {} });

    const { handler } = registeredRoutes["POST /test"];
    await handler(
      createRequest({ body: { content: "Hello", temperature: 0.8 } }),
      createReply(),
    );

    expect(mockRouteAndCollect).toHaveBeenCalledWith(
      expect.objectContaining({ temperature: 0.8 }),
      expect.any(Object),
    );
  });

  it("passes undefined temperature when not provided", async () => {
    const { routeAndCollect } = await import("../../src/router/index.js");
    const mockRouteAndCollect = routeAndCollect as ReturnType<typeof vi.fn>;

    mockRouteAndCollect.mockResolvedValue({ text: "response", usage: {} });

    const { handler } = registeredRoutes["POST /test"];
    await handler(
      createRequest({ body: { content: "Hello" } }),
      createReply(),
    );

    expect(mockRouteAndCollect).toHaveBeenCalledWith(
      expect.objectContaining({ temperature: undefined }),
      expect.any(Object),
    );
  });

  it("throws AppError when content is missing", async () => {
    const { handler } = registeredRoutes["POST /test"];
    await expect(
      handler(createRequest({ body: {} }), createReply()),
    ).rejects.toThrow("Content is required");
  });

  it("throws AppError when content is empty string", async () => {
    const { handler } = registeredRoutes["POST /test"];
    await expect(
      handler(createRequest({ body: { content: "" } }), createReply()),
    ).rejects.toThrow("Content is required");
  });

  it("throws AppError when content is whitespace only", async () => {
    const { handler } = registeredRoutes["POST /test"];
    await expect(
      handler(createRequest({ body: { content: "   " } }), createReply()),
    ).rejects.toThrow("Content is required");
  });

  it("throws AppError when content is not a string", async () => {
    const { handler } = registeredRoutes["POST /test"];
    await expect(
      handler(createRequest({ body: { content: 42 } }), createReply()),
    ).rejects.toThrow("Content is required");
  });

  it("propagates LLM errors", async () => {
    const { routeAndCollect } = await import("../../src/router/index.js");
    const mockRouteAndCollect = routeAndCollect as ReturnType<typeof vi.fn>;

    mockRouteAndCollect.mockRejectedValue(new Error("LLM unavailable"));

    const { handler } = registeredRoutes["POST /test"];
    await expect(
      handler(createRequest({ body: { content: "Hello" } }), createReply()),
    ).rejects.toThrow("LLM unavailable");
  });
});
