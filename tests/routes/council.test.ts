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

vi.mock("../../src/db/schema/auth.js", () => ({
  councilConfigs: {
    id: "councilConfigs.id",
    userId: "councilConfigs.userId",
    config: "councilConfigs.config",
    updatedAt: "councilConfigs.updatedAt",
  },
}));

vi.mock("../../src/config/archetypes.js", () => ({
  ARCHETYPES: {
    architect: {
      id: "architect",
      name: "The Architect",
      thinkingStyle: "Systems thinking",
      asks: "What's the underlying structure?",
      blindSpot: "Can over-engineer",
      systemPrompt: "You are the Architect.",
      icon: "building",
      colorBg: "#123456",
    },
    contrarian: {
      id: "contrarian",
      name: "The Contrarian",
      thinkingStyle: "Adversarial thinking",
      asks: "What if we're wrong?",
      blindSpot: "Can be negative",
      systemPrompt: "You are the Contrarian.",
      icon: "scale",
      colorBg: "#654321",
    },
  },
  SUMMONS: {
    debate: ["contrarian", "architect"],
    research: ["architect", "contrarian"],
  },
  COUNCIL_TEMPLATES: {
    debate: {
      id: "debate",
      name: "Debate Council",
      masterPrompt: "You are a neutral judge.",
      memberPrompts: [],
    },
    research: {
      id: "research",
      name: "Research Council",
      masterPrompt: "Synthesize findings.",
      memberPrompts: [],
    },
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: any[]) => args),
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

let councilPlugin: any;

beforeEach(async () => {
  vi.clearAllMocks();
  for (const key of Object.keys(registeredRoutes)) {
    delete registeredRoutes[key];
  }

  const mod = await import("../../src/routes/council.js");
  councilPlugin = mod.default;
  const fastify = createFastifyInstance();
  await councilPlugin(fastify);
});

// ================================================================
// Route registration
// ================================================================
describe("route registration", () => {
  it("registers all expected routes", () => {
    expect(registeredRoutes["GET /archetypes"]).toBeDefined();
    expect(registeredRoutes["GET /summons"]).toBeDefined();
    expect(registeredRoutes["GET /templates"]).toBeDefined();
    expect(registeredRoutes["GET /config"]).toBeDefined();
    expect(registeredRoutes["PUT /config"]).toBeDefined();
    expect(registeredRoutes["DELETE /config"]).toBeDefined();
    expect(registeredRoutes["GET /archetypes/:id"]).toBeDefined();
  });

  it("authenticated routes have preHandler", () => {
    expect(registeredRoutes["GET /config"].preHandler).toBeDefined();
    expect(registeredRoutes["PUT /config"].preHandler).toBeDefined();
    expect(registeredRoutes["DELETE /config"].preHandler).toBeDefined();
  });

  it("public routes do not have preHandler", () => {
    expect(registeredRoutes["GET /archetypes"].preHandler).toBeUndefined();
    expect(registeredRoutes["GET /summons"].preHandler).toBeUndefined();
    expect(registeredRoutes["GET /templates"].preHandler).toBeUndefined();
    expect(registeredRoutes["GET /archetypes/:id"].preHandler).toBeUndefined();
  });
});

// ================================================================
// GET /archetypes
// ================================================================
describe("GET /archetypes", () => {
  it("returns all archetypes with expected fields", async () => {
    const { handler } = registeredRoutes["GET /archetypes"];
    const result = await handler(createRequest(), createReply());

    expect(result.archetypes).toHaveLength(2);
    const ids = result.archetypes.map((a: any) => a.id);
    expect(ids).toContain("architect");
    expect(ids).toContain("contrarian");
  });

  it("maps archetype fields correctly", async () => {
    const { handler } = registeredRoutes["GET /archetypes"];
    const result = await handler(createRequest(), createReply());

    const architect = result.archetypes.find((a: any) => a.id === "architect");
    expect(architect).toEqual({
      id: "architect",
      name: "The Architect",
      thinkingStyle: "Systems thinking",
      asks: "What's the underlying structure?",
      blindSpot: "Can over-engineer",
      icon: "building",
      colorBg: "#123456",
    });
  });

  it("does not include systemPrompt in the response", async () => {
    const { handler } = registeredRoutes["GET /archetypes"];
    const result = await handler(createRequest(), createReply());

    for (const archetype of result.archetypes) {
      expect(archetype).not.toHaveProperty("systemPrompt");
    }
  });

  it("does not include tools in the response", async () => {
    const { handler } = registeredRoutes["GET /archetypes"];
    const result = await handler(createRequest(), createReply());

    for (const archetype of result.archetypes) {
      expect(archetype).not.toHaveProperty("tools");
    }
  });
});

// ================================================================
// GET /summons
// ================================================================
describe("GET /summons", () => {
  it("returns all summons", async () => {
    const { handler } = registeredRoutes["GET /summons"];
    const result = await handler(createRequest(), createReply());

    expect(result.summons).toBeDefined();
    expect(result.summons.debate).toEqual(["contrarian", "architect"]);
    expect(result.summons.research).toEqual(["architect", "contrarian"]);
  });

  it("returns the full SUMMONS object unchanged", async () => {
    const { handler } = registeredRoutes["GET /summons"];
    const result = await handler(createRequest(), createReply());

    expect(Object.keys(result.summons)).toHaveLength(2);
  });
});

// ================================================================
// GET /templates
// ================================================================
describe("GET /templates", () => {
  it("returns all council templates", async () => {
    const { handler } = registeredRoutes["GET /templates"];
    const result = await handler(createRequest(), createReply());

    expect(result.templates).toBeDefined();
    expect(Object.keys(result.templates)).toHaveLength(2);
    expect(result.templates.debate.name).toBe("Debate Council");
    expect(result.templates.research.name).toBe("Research Council");
  });
});

// ================================================================
// GET /config
// ================================================================
describe("GET /config", () => {
  it("returns user config when it exists", async () => {
    const mockConfig = { defaultRounds: 3, defaultSummon: "debate" };
    const chain = chainable({
      limit: vi.fn().mockResolvedValue([{ config: mockConfig }]),
    });
    mockDb.select = vi.fn(() => chain);

    const { handler } = registeredRoutes["GET /config"];
    const result = await handler(createRequest({ userId: 42 }), createReply());

    expect(result).toEqual({ config: mockConfig });
    expect(mockDb.select).toHaveBeenCalled();
  });

  it("returns null when no config exists", async () => {
    const chain = chainable({
      limit: vi.fn().mockResolvedValue([]),
    });
    mockDb.select = vi.fn(() => chain);

    const { handler } = registeredRoutes["GET /config"];
    const result = await handler(createRequest({ userId: 42 }), createReply());

    expect(result).toEqual({ config: null });
  });

  it("returns null when config row exists but config field is null/undefined", async () => {
    const chain = chainable({
      limit: vi.fn().mockResolvedValue([{ config: null }]),
    });
    mockDb.select = vi.fn(() => chain);

    const { handler } = registeredRoutes["GET /config"];
    const result = await handler(createRequest(), createReply());

    expect(result).toEqual({ config: null });
  });

  it("throws AppError 500 on db failure", async () => {
    const chain = chainable({
      limit: vi.fn().mockRejectedValue(new Error("db down")),
    });
    mockDb.select = vi.fn(() => chain);

    const { handler } = registeredRoutes["GET /config"];
    await expect(handler(createRequest(), createReply())).rejects.toThrow(
      "Failed to get council config"
    );
  });

  it("logs error on db failure", async () => {
    const chain = chainable({
      limit: vi.fn().mockRejectedValue(new Error("connection lost")),
    });
    mockDb.select = vi.fn(() => chain);

    const logger = (await import("../../src/lib/logger.js")).default;

    const { handler } = registeredRoutes["GET /config"];
    await expect(handler(createRequest(), createReply())).rejects.toThrow();

    expect(logger.error).toHaveBeenCalledWith(
      { err: "connection lost" },
      "Failed to get council config"
    );
  });
});

// ================================================================
// PUT /config
// ================================================================
describe("PUT /config", () => {
  it("updates existing config via upsert (update path)", async () => {
    const updatedConfig = { defaultRounds: 3 };
    const selectChain = chainable({
      limit: vi.fn().mockResolvedValue([{ id: "existing-id" }]),
    });
    mockDb.select = vi.fn(() => selectChain);

    const updateChain = chainable({
      returning: vi.fn().mockResolvedValue([{ config: updatedConfig }]),
    });
    mockDb.update = vi.fn(() => updateChain);

    const { handler } = registeredRoutes["PUT /config"];
    const request = createRequest({
      userId: 42,
      body: { defaultRounds: 3 },
    });
    const result = await handler(request, createReply());

    expect(result).toEqual({ config: updatedConfig });
    expect(mockDb.update).toHaveBeenCalled();
    expect(mockDb.insert).toBeUndefined(); // insert should not be called
  });

  it("inserts new config via upsert (insert path)", async () => {
    const newConfig = { defaultSummon: "research" };
    const selectChain = chainable({
      limit: vi.fn().mockResolvedValue([]),
    });
    mockDb.select = vi.fn(() => selectChain);

    const insertChain = chainable({
      returning: vi.fn().mockResolvedValue([{ config: newConfig }]),
    });
    mockDb.insert = vi.fn(() => insertChain);

    const { handler } = registeredRoutes["PUT /config"];
    const request = createRequest({
      userId: 42,
      body: { defaultSummon: "research" },
    });
    const result = await handler(request, createReply());

    expect(result).toEqual({ config: newConfig });
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it("throws AppError 500 on db failure during select", async () => {
    const selectChain = chainable({
      limit: vi.fn().mockRejectedValue(new Error("select failed")),
    });
    mockDb.select = vi.fn(() => selectChain);

    const { handler } = registeredRoutes["PUT /config"];
    const request = createRequest({ body: { defaultRounds: 2 } });

    await expect(handler(request, createReply())).rejects.toThrow(
      "Failed to update council config"
    );
  });

  it("throws AppError 500 on db failure during update", async () => {
    const selectChain = chainable({
      limit: vi.fn().mockResolvedValue([{ id: "existing-id" }]),
    });
    mockDb.select = vi.fn(() => selectChain);

    const updateChain = chainable({
      returning: vi.fn().mockRejectedValue(new Error("update failed")),
    });
    mockDb.update = vi.fn(() => updateChain);

    const { handler } = registeredRoutes["PUT /config"];
    const request = createRequest({ body: { defaultRounds: 2 } });

    await expect(handler(request, createReply())).rejects.toThrow(
      "Failed to update council config"
    );
  });

  it("throws AppError 500 on db failure during insert", async () => {
    const selectChain = chainable({
      limit: vi.fn().mockResolvedValue([]),
    });
    mockDb.select = vi.fn(() => selectChain);

    const insertChain = chainable({
      returning: vi.fn().mockRejectedValue(new Error("insert failed")),
    });
    mockDb.insert = vi.fn(() => insertChain);

    const { handler } = registeredRoutes["PUT /config"];
    const request = createRequest({ body: { defaultSummon: "debate" } });

    await expect(handler(request, createReply())).rejects.toThrow(
      "Failed to update council config"
    );
  });

  it("logs error on failure", async () => {
    const selectChain = chainable({
      limit: vi.fn().mockRejectedValue(new Error("boom")),
    });
    mockDb.select = vi.fn(() => selectChain);

    const logger = (await import("../../src/lib/logger.js")).default;

    const { handler } = registeredRoutes["PUT /config"];
    await expect(handler(createRequest({ body: {} }), createReply())).rejects.toThrow();

    expect(logger.error).toHaveBeenCalledWith(
      { err: "boom" },
      "Failed to update council config"
    );
  });

  it("has preHandler with both auth and validation", () => {
    const route = registeredRoutes["PUT /config"];
    expect(route.preHandler).toBeDefined();
    // PUT /config has preHandler as an array [fastifyRequireAuth, fastifyValidate(...)]
    expect(Array.isArray(route.preHandler)).toBe(true);
    expect((route.preHandler as Function[]).length).toBe(2);
  });
});

// ================================================================
// PUT /config - validation via fastifyValidate preHandler
// ================================================================
describe("PUT /config validation (fastifyValidate preHandler)", () => {
  it("passes valid body through validation", async () => {
    const route = registeredRoutes["PUT /config"];
    const preHandlers = route.preHandler as Function[];
    // The second preHandler is the fastifyValidate function
    const validateHandler = preHandlers[1];

    const request = createRequest({
      body: {
        defaultRounds: 3,
        defaultSummon: "debate",
        customArchetypes: [
          {
            id: "test",
            name: "Test",
            thinkingStyle: "testing",
            asks: "why?",
            blindSpot: "none",
            systemPrompt: "test prompt",
          },
        ],
      },
    });
    const reply = createReply();

    await validateHandler(request, reply);

    // Should not send a 400 error
    expect(reply.code).not.toHaveBeenCalled();
    expect(reply.send).not.toHaveBeenCalled();
    // Body should be set to parsed data
    expect(request.body.defaultRounds).toBe(3);
  });

  it("rejects invalid body with 400", async () => {
    const route = registeredRoutes["PUT /config"];
    const preHandlers = route.preHandler as Function[];
    const validateHandler = preHandlers[1];

    const request = createRequest({
      body: {
        defaultRounds: 10, // max is 5
      },
    });
    const reply = createReply();

    await validateHandler(request, reply);

    expect(reply.code).toHaveBeenCalledWith(400);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({
        error: "Validation failed",
        details: expect.arrayContaining([
          expect.objectContaining({
            field: expect.any(String),
            message: expect.any(String),
          }),
        ]),
      })
    );
  });

  it("rejects defaultRounds below minimum (0)", async () => {
    const route = registeredRoutes["PUT /config"];
    const preHandlers = route.preHandler as Function[];
    const validateHandler = preHandlers[1];

    const request = createRequest({
      body: { defaultRounds: 0 },
    });
    const reply = createReply();

    await validateHandler(request, reply);

    expect(reply.code).toHaveBeenCalledWith(400);
  });

  it("rejects defaultRounds above maximum (6)", async () => {
    const route = registeredRoutes["PUT /config"];
    const preHandlers = route.preHandler as Function[];
    const validateHandler = preHandlers[1];

    const request = createRequest({
      body: { defaultRounds: 6 },
    });
    const reply = createReply();

    await validateHandler(request, reply);

    expect(reply.code).toHaveBeenCalledWith(400);
  });

  it("rejects customArchetypes with missing required fields", async () => {
    const route = registeredRoutes["PUT /config"];
    const preHandlers = route.preHandler as Function[];
    const validateHandler = preHandlers[1];

    const request = createRequest({
      body: {
        customArchetypes: [{ id: "test" }], // missing name, thinkingStyle, etc.
      },
    });
    const reply = createReply();

    await validateHandler(request, reply);

    expect(reply.code).toHaveBeenCalledWith(400);
  });

  it("accepts empty body (all fields optional)", async () => {
    const route = registeredRoutes["PUT /config"];
    const preHandlers = route.preHandler as Function[];
    const validateHandler = preHandlers[1];

    const request = createRequest({ body: {} });
    const reply = createReply();

    await validateHandler(request, reply);

    expect(reply.code).not.toHaveBeenCalled();
  });

  it("accepts customArchetypes with optional fields", async () => {
    const route = registeredRoutes["PUT /config"];
    const preHandlers = route.preHandler as Function[];
    const validateHandler = preHandlers[1];

    const request = createRequest({
      body: {
        customArchetypes: [
          {
            id: "custom1",
            name: "Custom",
            thinkingStyle: "creative",
            asks: "what if?",
            blindSpot: "bias",
            systemPrompt: "be creative",
            tools: ["search", "code"],
            icon: "star",
            colorBg: "#ff0000",
          },
        ],
      },
    });
    const reply = createReply();

    await validateHandler(request, reply);

    expect(reply.code).not.toHaveBeenCalled();
    expect(request.body.customArchetypes[0].tools).toEqual(["search", "code"]);
  });

  it("rejects non-numeric defaultRounds", async () => {
    const route = registeredRoutes["PUT /config"];
    const preHandlers = route.preHandler as Function[];
    const validateHandler = preHandlers[1];

    const request = createRequest({
      body: { defaultRounds: "three" },
    });
    const reply = createReply();

    await validateHandler(request, reply);

    expect(reply.code).toHaveBeenCalledWith(400);
  });
});

// ================================================================
// DELETE /config
// ================================================================
describe("DELETE /config", () => {
  it("deletes user config and returns success message", async () => {
    const chain = chainable({
      where: vi.fn().mockResolvedValue(undefined),
    });
    mockDb.delete = vi.fn(() => chain);

    const { handler } = registeredRoutes["DELETE /config"];
    const result = await handler(createRequest({ userId: 42 }), createReply());

    expect(result).toEqual({ message: "Council config deleted" });
    expect(mockDb.delete).toHaveBeenCalled();
  });

  it("throws AppError 500 on db failure", async () => {
    const chain = chainable({
      where: vi.fn().mockRejectedValue(new Error("delete failed")),
    });
    mockDb.delete = vi.fn(() => chain);

    const { handler } = registeredRoutes["DELETE /config"];
    await expect(handler(createRequest(), createReply())).rejects.toThrow(
      "Failed to delete council config"
    );
  });

  it("logs error on db failure", async () => {
    const chain = chainable({
      where: vi.fn().mockRejectedValue(new Error("disk full")),
    });
    mockDb.delete = vi.fn(() => chain);

    const logger = (await import("../../src/lib/logger.js")).default;

    const { handler } = registeredRoutes["DELETE /config"];
    await expect(handler(createRequest(), createReply())).rejects.toThrow();

    expect(logger.error).toHaveBeenCalledWith(
      { err: "disk full" },
      "Failed to delete council config"
    );
  });

  it("succeeds even if no config existed (delete of zero rows)", async () => {
    const chain = chainable({
      where: vi.fn().mockResolvedValue(undefined),
    });
    mockDb.delete = vi.fn(() => chain);

    const { handler } = registeredRoutes["DELETE /config"];
    const result = await handler(createRequest({ userId: 999 }), createReply());

    expect(result).toEqual({ message: "Council config deleted" });
  });
});

// ================================================================
// GET /archetypes/:id
// ================================================================
describe("GET /archetypes/:id", () => {
  it("returns archetype when found", async () => {
    const { handler } = registeredRoutes["GET /archetypes/:id"];
    const request = createRequest({ params: { id: "architect" } });
    const reply = createReply();
    const result = await handler(request, reply);

    expect(result.archetype).toBeDefined();
    expect(result.archetype.id).toBe("architect");
    expect(result.archetype.name).toBe("The Architect");
  });

  it("returns full archetype object including systemPrompt", async () => {
    const { handler } = registeredRoutes["GET /archetypes/:id"];
    const request = createRequest({ params: { id: "architect" } });
    const result = await handler(request, createReply());

    expect(result.archetype.systemPrompt).toBe("You are the Architect.");
  });

  it("returns 404 for non-existent archetype", async () => {
    const { handler } = registeredRoutes["GET /archetypes/:id"];
    const request = createRequest({ params: { id: "nonexistent" } });
    const reply = createReply();
    const result = await handler(request, reply);

    expect(reply.code).toHaveBeenCalledWith(404);
    expect(result).toEqual({ error: "Archetype not found" });
  });

  it("returns 404 for empty string id", async () => {
    const { handler } = registeredRoutes["GET /archetypes/:id"];
    const request = createRequest({ params: { id: "" } });
    const reply = createReply();
    const result = await handler(request, reply);

    expect(reply.code).toHaveBeenCalledWith(404);
    expect(result).toEqual({ error: "Archetype not found" });
  });

  it("handles numeric id by converting to string", async () => {
    const { handler } = registeredRoutes["GET /archetypes/:id"];
    const request = createRequest({ params: { id: 123 } });
    const reply = createReply();
    const result = await handler(request, reply);

    // 123 is not a valid archetype id, so it should be 404
    expect(reply.code).toHaveBeenCalledWith(404);
    expect(result).toEqual({ error: "Archetype not found" });
  });

  it("returns contrarian archetype correctly", async () => {
    const { handler } = registeredRoutes["GET /archetypes/:id"];
    const request = createRequest({ params: { id: "contrarian" } });
    const result = await handler(request, createReply());

    expect(result.archetype.id).toBe("contrarian");
    expect(result.archetype.name).toBe("The Contrarian");
  });
});
