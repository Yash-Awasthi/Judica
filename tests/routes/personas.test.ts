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

vi.mock("../../src/db/schema/council.js", () => ({
  customPersonas: {
    id: "cp.id",
    userId: "cp.userId",
    name: "cp.name",
    systemPrompt: "cp.systemPrompt",
    temperature: "cp.temperature",
    critiqueStyle: "cp.critiqueStyle",
    domain: "cp.domain",
    aggressiveness: "cp.aggressiveness",
    createdAt: "cp.createdAt",
  },
}));

const mockBuiltInPersonas = [
  {
    id: "research_scientist",
    name: "Research Scientist",
    systemPrompt: "You are a methodical research scientist.",
    temperature: 0.3,
    critiqueStyle: "evidence_based",
    domain: "science",
    isBuiltIn: true,
  },
  {
    id: "devils_advocate",
    name: "Devil's Advocate",
    systemPrompt: "You are a professional contrarian.",
    temperature: 0.8,
    critiqueStyle: "adversarial",
    domain: "general",
    isBuiltIn: true,
  },
];

vi.mock("../../src/agents/personas.js", () => ({
  BUILT_IN_PERSONAS: mockBuiltInPersonas,
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: any[]) => args),
  and: vi.fn((...args: any[]) => args),
  desc: vi.fn((col: any) => col),
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

vi.mock("crypto", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    randomUUID: vi.fn(() => "mock-uuid-1234"),
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

function createRequest(
  overrides: Partial<{ userId: number; body: any; params: any; headers: Record<string, string> }> = {}
): any {
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
    send: vi.fn(function (this: any) {
      return this;
    }),
  };
  return reply;
}

// ---- import and register the plugin ----

let personasPlugin: any;

beforeEach(async () => {
  vi.clearAllMocks();
  for (const key of Object.keys(registeredRoutes)) {
    delete registeredRoutes[key];
  }

  const mod = await import("../../src/routes/personas.js");
  personasPlugin = mod.default;
  const fastify = createFastifyInstance();
  await personasPlugin(fastify);
});

// ================================================================
// Route registration
// ================================================================
describe("route registration", () => {
  it("registers all expected routes", () => {
    expect(registeredRoutes["GET /"]).toBeDefined();
    expect(registeredRoutes["POST /"]).toBeDefined();
    expect(registeredRoutes["PUT /:id"]).toBeDefined();
    expect(registeredRoutes["DELETE /:id"]).toBeDefined();
  });

  it("all routes have a preHandler for auth", () => {
    for (const key of Object.keys(registeredRoutes)) {
      expect(registeredRoutes[key].preHandler).toBeDefined();
    }
  });
});

// ================================================================
// GET / — list built-in + custom personas
// ================================================================
describe("GET /", () => {
  it("returns built-in personas combined with custom personas", async () => {
    const customRows = [
      {
        id: "custom-1",
        name: "My Custom",
        systemPrompt: "Custom prompt",
        temperature: 0.5,
        critiqueStyle: "balanced",
        domain: "tech",
        aggressiveness: 3,
        createdAt: new Date("2024-01-01"),
        userId: 1,
      },
    ];

    const chain = chainable({
      orderBy: vi.fn().mockResolvedValue(customRows),
    });
    mockDb.select = vi.fn(() => chain);

    const { handler } = registeredRoutes["GET /"];
    const result = await handler(createRequest(), createReply());

    expect(result.personas).toHaveLength(mockBuiltInPersonas.length + 1);
    // Built-in personas come first
    expect(result.personas[0]).toEqual(mockBuiltInPersonas[0]);
    expect(result.personas[1]).toEqual(mockBuiltInPersonas[1]);
    // Custom persona is mapped correctly
    const custom = result.personas[mockBuiltInPersonas.length];
    expect(custom.id).toBe("custom-1");
    expect(custom.name).toBe("My Custom");
    expect(custom.systemPrompt).toBe("Custom prompt");
    expect(custom.temperature).toBe(0.5);
    expect(custom.critiqueStyle).toBe("balanced");
    expect(custom.domain).toBe("tech");
    expect(custom.aggressiveness).toBe(3);
    expect(custom.isBuiltIn).toBe(false);
    expect(custom.createdAt).toEqual(new Date("2024-01-01"));
  });

  it("returns only built-in personas when user has no custom ones", async () => {
    const chain = chainable({
      orderBy: vi.fn().mockResolvedValue([]),
    });
    mockDb.select = vi.fn(() => chain);

    const { handler } = registeredRoutes["GET /"];
    const result = await handler(createRequest(), createReply());

    expect(result.personas).toHaveLength(mockBuiltInPersonas.length);
    expect(result.personas).toEqual(mockBuiltInPersonas);
  });

  it("returns multiple custom personas ordered by db result", async () => {
    const customRows = [
      {
        id: "c2",
        name: "Second",
        systemPrompt: "Prompt 2",
        temperature: 0.9,
        critiqueStyle: null,
        domain: null,
        aggressiveness: 7,
        createdAt: new Date("2024-06-01"),
        userId: 1,
      },
      {
        id: "c1",
        name: "First",
        systemPrompt: "Prompt 1",
        temperature: 0.4,
        critiqueStyle: "soft",
        domain: "finance",
        aggressiveness: 2,
        createdAt: new Date("2024-01-01"),
        userId: 1,
      },
    ];

    const chain = chainable({
      orderBy: vi.fn().mockResolvedValue(customRows),
    });
    mockDb.select = vi.fn(() => chain);

    const { handler } = registeredRoutes["GET /"];
    const result = await handler(createRequest(), createReply());

    expect(result.personas).toHaveLength(mockBuiltInPersonas.length + 2);
    expect(result.personas[mockBuiltInPersonas.length].id).toBe("c2");
    expect(result.personas[mockBuiltInPersonas.length + 1].id).toBe("c1");
  });

  it("does not include extraneous fields (e.g. userId) in the custom persona mapping", async () => {
    const customRows = [
      {
        id: "c1",
        name: "Test",
        systemPrompt: "Prompt",
        temperature: 0.7,
        critiqueStyle: null,
        domain: null,
        aggressiveness: 5,
        createdAt: new Date(),
        userId: 99,
        extraField: "should not appear",
      },
    ];

    const chain = chainable({
      orderBy: vi.fn().mockResolvedValue(customRows),
    });
    mockDb.select = vi.fn(() => chain);

    const { handler } = registeredRoutes["GET /"];
    const result = await handler(createRequest({ userId: 99 }), createReply());

    const custom = result.personas[mockBuiltInPersonas.length];
    expect(custom.userId).toBeUndefined();
    expect(custom.extraField).toBeUndefined();
    expect(custom.isBuiltIn).toBe(false);
  });

  it("queries with the correct userId from the request", async () => {
    const chain = chainable({
      orderBy: vi.fn().mockResolvedValue([]),
    });
    const whereMock = vi.fn(() => chain);
    chain.where = whereMock;
    mockDb.select = vi.fn(() => chain);

    const { handler } = registeredRoutes["GET /"];
    await handler(createRequest({ userId: 42 }), createReply());

    expect(whereMock).toHaveBeenCalled();
  });

  it("propagates db errors", async () => {
    const chain = chainable({
      orderBy: vi.fn().mockRejectedValue(new Error("db down")),
    });
    mockDb.select = vi.fn(() => chain);

    const { handler } = registeredRoutes["GET /"];
    await expect(handler(createRequest(), createReply())).rejects.toThrow("db down");
  });
});

// ================================================================
// POST / — create custom persona
// ================================================================
describe("POST /", () => {
  it("creates a persona successfully and returns 201", async () => {
    const createdPersona = {
      id: "mock-uuid-1234",
      userId: 1,
      name: "New Persona",
      systemPrompt: "You are helpful.",
      temperature: 0.7,
      critiqueStyle: null,
      domain: null,
      aggressiveness: 5,
    };

    const chain = chainable({
      returning: vi.fn().mockResolvedValue([createdPersona]),
    });
    mockDb.insert = vi.fn(() => chain);

    const { handler } = registeredRoutes["POST /"];
    const reply = createReply();
    const request = createRequest({
      body: { name: "New Persona", systemPrompt: "You are helpful." },
    });

    const result = await handler(request, reply);
    expect(result).toEqual(createdPersona);
    expect(reply.code).toHaveBeenCalledWith(201);
  });

  it("creates a persona with all optional fields", async () => {
    const createdPersona = {
      id: "mock-uuid-1234",
      userId: 1,
      name: "Full Persona",
      systemPrompt: "Full prompt",
      temperature: 0.9,
      critiqueStyle: "aggressive",
      domain: "engineering",
      aggressiveness: 8,
    };

    const chain = chainable({
      returning: vi.fn().mockResolvedValue([createdPersona]),
    });
    mockDb.insert = vi.fn(() => chain);

    const { handler } = registeredRoutes["POST /"];
    const reply = createReply();
    const request = createRequest({
      body: {
        name: "Full Persona",
        systemPrompt: "Full prompt",
        temperature: 0.9,
        critiqueStyle: "aggressive",
        domain: "engineering",
        aggressiveness: 8,
      },
    });

    const result = await handler(request, reply);
    expect(result).toEqual(createdPersona);
    expect(reply.code).toHaveBeenCalledWith(201);
  });

  it("trims name and systemPrompt", async () => {
    const chain = chainable({
      returning: vi.fn().mockResolvedValue([{}]),
    });
    const valuesMock = vi.fn(() => chain);
    chain.values = valuesMock;
    mockDb.insert = vi.fn(() => chain);

    const { handler } = registeredRoutes["POST /"];
    const request = createRequest({
      body: { name: "  Trimmed Name  ", systemPrompt: "  Trimmed Prompt  " },
    });

    await handler(request, createReply());

    expect(valuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Trimmed Name",
        systemPrompt: "Trimmed Prompt",
      })
    );
  });

  it("uses default temperature 0.7 when not provided", async () => {
    const chain = chainable({
      returning: vi.fn().mockResolvedValue([{}]),
    });
    const valuesMock = vi.fn(() => chain);
    chain.values = valuesMock;
    mockDb.insert = vi.fn(() => chain);

    const { handler } = registeredRoutes["POST /"];
    const request = createRequest({
      body: { name: "Test", systemPrompt: "Prompt" },
    });

    await handler(request, createReply());

    expect(valuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        temperature: 0.7,
      })
    );
  });

  it("uses default aggressiveness 5 when not provided", async () => {
    const chain = chainable({
      returning: vi.fn().mockResolvedValue([{}]),
    });
    const valuesMock = vi.fn(() => chain);
    chain.values = valuesMock;
    mockDb.insert = vi.fn(() => chain);

    const { handler } = registeredRoutes["POST /"];
    const request = createRequest({
      body: { name: "Test", systemPrompt: "Prompt" },
    });

    await handler(request, createReply());

    expect(valuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        aggressiveness: 5,
      })
    );
  });

  it("sets critiqueStyle to null when not provided", async () => {
    const chain = chainable({
      returning: vi.fn().mockResolvedValue([{}]),
    });
    const valuesMock = vi.fn(() => chain);
    chain.values = valuesMock;
    mockDb.insert = vi.fn(() => chain);

    const { handler } = registeredRoutes["POST /"];
    const request = createRequest({
      body: { name: "Test", systemPrompt: "Prompt" },
    });

    await handler(request, createReply());

    expect(valuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        critiqueStyle: null,
        domain: null,
      })
    );
  });

  it("sets critiqueStyle to null when empty string is provided", async () => {
    const chain = chainable({
      returning: vi.fn().mockResolvedValue([{}]),
    });
    const valuesMock = vi.fn(() => chain);
    chain.values = valuesMock;
    mockDb.insert = vi.fn(() => chain);

    const { handler } = registeredRoutes["POST /"];
    const request = createRequest({
      body: { name: "Test", systemPrompt: "Prompt", critiqueStyle: "", domain: "" },
    });

    await handler(request, createReply());

    expect(valuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        critiqueStyle: null,
        domain: null,
      })
    );
  });

  it("throws AppError when name is missing", async () => {
    const { handler } = registeredRoutes["POST /"];
    const request = createRequest({
      body: { systemPrompt: "Prompt" },
    });

    await expect(handler(request, createReply())).rejects.toThrow("Name is required");
  });

  it("throws AppError when name is empty string", async () => {
    const { handler } = registeredRoutes["POST /"];
    const request = createRequest({
      body: { name: "", systemPrompt: "Prompt" },
    });

    await expect(handler(request, createReply())).rejects.toThrow("Name is required");
  });

  it("throws AppError when name is whitespace only", async () => {
    const { handler } = registeredRoutes["POST /"];
    const request = createRequest({
      body: { name: "   ", systemPrompt: "Prompt" },
    });

    await expect(handler(request, createReply())).rejects.toThrow("Name is required");
  });

  it("throws AppError when name is not a string", async () => {
    const { handler } = registeredRoutes["POST /"];
    const request = createRequest({
      body: { name: 123, systemPrompt: "Prompt" },
    });

    await expect(handler(request, createReply())).rejects.toThrow("Name is required");
  });

  it("throws AppError when systemPrompt is missing", async () => {
    const { handler } = registeredRoutes["POST /"];
    const request = createRequest({
      body: { name: "Test" },
    });

    await expect(handler(request, createReply())).rejects.toThrow("System prompt is required");
  });

  it("throws AppError when systemPrompt is empty string", async () => {
    const { handler } = registeredRoutes["POST /"];
    const request = createRequest({
      body: { name: "Test", systemPrompt: "" },
    });

    await expect(handler(request, createReply())).rejects.toThrow("System prompt is required");
  });

  it("throws AppError when systemPrompt is whitespace only", async () => {
    const { handler } = registeredRoutes["POST /"];
    const request = createRequest({
      body: { name: "Test", systemPrompt: "   " },
    });

    await expect(handler(request, createReply())).rejects.toThrow("System prompt is required");
  });

  it("throws AppError when systemPrompt is not a string", async () => {
    const { handler } = registeredRoutes["POST /"];
    const request = createRequest({
      body: { name: "Test", systemPrompt: 42 },
    });

    await expect(handler(request, createReply())).rejects.toThrow("System prompt is required");
  });

  it("throws AppError with correct code for missing name", async () => {
    const { handler } = registeredRoutes["POST /"];
    const request = createRequest({
      body: { systemPrompt: "Prompt" },
    });

    try {
      await handler(request, createReply());
      expect.fail("should have thrown");
    } catch (err: any) {
      expect(err.statusCode).toBe(400);
      expect(err.code).toBe("PERSONA_NAME_REQUIRED");
    }
  });

  it("throws AppError with correct code for missing systemPrompt", async () => {
    const { handler } = registeredRoutes["POST /"];
    const request = createRequest({
      body: { name: "Test" },
    });

    try {
      await handler(request, createReply());
      expect.fail("should have thrown");
    } catch (err: any) {
      expect(err.statusCode).toBe(400);
      expect(err.code).toBe("PERSONA_PROMPT_REQUIRED");
    }
  });

  it("throws when both name and systemPrompt are missing (name checked first)", async () => {
    const { handler } = registeredRoutes["POST /"];
    const request = createRequest({ body: {} });

    try {
      await handler(request, createReply());
      expect.fail("should have thrown");
    } catch (err: any) {
      expect(err.code).toBe("PERSONA_NAME_REQUIRED");
    }
  });

  it("propagates db errors during insert", async () => {
    const chain = chainable({
      returning: vi.fn().mockRejectedValue(new Error("insert failed")),
    });
    mockDb.insert = vi.fn(() => chain);

    const { handler } = registeredRoutes["POST /"];
    const request = createRequest({
      body: { name: "Test", systemPrompt: "Prompt" },
    });

    await expect(handler(request, createReply())).rejects.toThrow("insert failed");
  });

  it("uses randomUUID for the persona id", async () => {
    const chain = chainable({
      returning: vi.fn().mockResolvedValue([{}]),
    });
    const valuesMock = vi.fn(() => chain);
    chain.values = valuesMock;
    mockDb.insert = vi.fn(() => chain);

    const { handler } = registeredRoutes["POST /"];
    const request = createRequest({
      body: { name: "Test", systemPrompt: "Prompt" },
    });

    await handler(request, createReply());

    expect(valuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "mock-uuid-1234",
      })
    );
  });

  it("passes the request userId to the insert", async () => {
    const chain = chainable({
      returning: vi.fn().mockResolvedValue([{}]),
    });
    const valuesMock = vi.fn(() => chain);
    chain.values = valuesMock;
    mockDb.insert = vi.fn(() => chain);

    const { handler } = registeredRoutes["POST /"];
    const request = createRequest({
      userId: 77,
      body: { name: "Test", systemPrompt: "Prompt" },
    });

    await handler(request, createReply());

    expect(valuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 77,
      })
    );
  });
});

// ================================================================
// PUT /:id — update custom persona
// ================================================================
describe("PUT /:id", () => {
  it("updates persona successfully when it exists", async () => {
    const existing = { id: "p1", userId: 1, name: "Old Name" };
    const updated = { id: "p1", userId: 1, name: "New Name" };

    // select for finding existing
    const selectChain = chainable({
      limit: vi.fn().mockResolvedValue([existing]),
    });
    mockDb.select = vi.fn(() => selectChain);

    // update
    const updateChain = chainable({
      returning: vi.fn().mockResolvedValue([updated]),
    });
    mockDb.update = vi.fn(() => updateChain);

    const { handler } = registeredRoutes["PUT /:id"];
    const request = createRequest({
      params: { id: "p1" },
      body: { name: "New Name" },
    });

    const result = await handler(request, createReply());
    expect(result).toEqual(updated);
  });

  it("throws AppError 404 when persona is not found", async () => {
    const selectChain = chainable({
      limit: vi.fn().mockResolvedValue([]),
    });
    mockDb.select = vi.fn(() => selectChain);

    const { handler } = registeredRoutes["PUT /:id"];
    const request = createRequest({
      params: { id: "nonexistent" },
      body: { name: "Whatever" },
    });

    try {
      await handler(request, createReply());
      expect.fail("should have thrown");
    } catch (err: any) {
      expect(err.statusCode).toBe(404);
      expect(err.message).toBe("Persona not found");
      expect(err.code).toBe("PERSONA_NOT_FOUND");
    }
  });

  it("updates only the name field when only name is provided", async () => {
    const existing = { id: "p1", userId: 1 };

    const selectChain = chainable({
      limit: vi.fn().mockResolvedValue([existing]),
    });
    mockDb.select = vi.fn(() => selectChain);

    const setMock = vi.fn(() =>
      chainable({
        returning: vi.fn().mockResolvedValue([{ id: "p1", name: "Updated" }]),
      })
    );
    const updateChain = chainable({ set: setMock });
    mockDb.update = vi.fn(() => updateChain);

    const { handler } = registeredRoutes["PUT /:id"];
    const request = createRequest({
      params: { id: "p1" },
      body: { name: "Updated" },
    });

    await handler(request, createReply());

    expect(setMock).toHaveBeenCalledWith({ name: "Updated" });
  });

  it("updates only systemPrompt when only systemPrompt is provided", async () => {
    const existing = { id: "p1", userId: 1 };

    const selectChain = chainable({
      limit: vi.fn().mockResolvedValue([existing]),
    });
    mockDb.select = vi.fn(() => selectChain);

    const setMock = vi.fn(() =>
      chainable({
        returning: vi.fn().mockResolvedValue([{}]),
      })
    );
    const updateChain = chainable({ set: setMock });
    mockDb.update = vi.fn(() => updateChain);

    const { handler } = registeredRoutes["PUT /:id"];
    const request = createRequest({
      params: { id: "p1" },
      body: { systemPrompt: "New Prompt" },
    });

    await handler(request, createReply());

    expect(setMock).toHaveBeenCalledWith({ systemPrompt: "New Prompt" });
  });

  it("updates all fields when all are provided", async () => {
    const existing = { id: "p1", userId: 1 };

    const selectChain = chainable({
      limit: vi.fn().mockResolvedValue([existing]),
    });
    mockDb.select = vi.fn(() => selectChain);

    const setMock = vi.fn(() =>
      chainable({
        returning: vi.fn().mockResolvedValue([{}]),
      })
    );
    const updateChain = chainable({ set: setMock });
    mockDb.update = vi.fn(() => updateChain);

    const { handler } = registeredRoutes["PUT /:id"];
    const request = createRequest({
      params: { id: "p1" },
      body: {
        name: "New Name",
        systemPrompt: "New Prompt",
        temperature: 0.9,
        critiqueStyle: "harsh",
        domain: "finance",
        aggressiveness: 10,
      },
    });

    await handler(request, createReply());

    expect(setMock).toHaveBeenCalledWith({
      name: "New Name",
      systemPrompt: "New Prompt",
      temperature: 0.9,
      critiqueStyle: "harsh",
      domain: "finance",
      aggressiveness: 10,
    });
  });

  it("trims name and systemPrompt in update", async () => {
    const existing = { id: "p1", userId: 1 };

    const selectChain = chainable({
      limit: vi.fn().mockResolvedValue([existing]),
    });
    mockDb.select = vi.fn(() => selectChain);

    const setMock = vi.fn(() =>
      chainable({
        returning: vi.fn().mockResolvedValue([{}]),
      })
    );
    const updateChain = chainable({ set: setMock });
    mockDb.update = vi.fn(() => updateChain);

    const { handler } = registeredRoutes["PUT /:id"];
    const request = createRequest({
      params: { id: "p1" },
      body: { name: "  Spaced  ", systemPrompt: "  Spaced Prompt  " },
    });

    await handler(request, createReply());

    expect(setMock).toHaveBeenCalledWith({
      name: "Spaced",
      systemPrompt: "Spaced Prompt",
    });
  });

  it("sends empty data object when no update fields are provided", async () => {
    const existing = { id: "p1", userId: 1 };

    const selectChain = chainable({
      limit: vi.fn().mockResolvedValue([existing]),
    });
    mockDb.select = vi.fn(() => selectChain);

    const setMock = vi.fn(() =>
      chainable({
        returning: vi.fn().mockResolvedValue([existing]),
      })
    );
    const updateChain = chainable({ set: setMock });
    mockDb.update = vi.fn(() => updateChain);

    const { handler } = registeredRoutes["PUT /:id"];
    const request = createRequest({
      params: { id: "p1" },
      body: {},
    });

    await handler(request, createReply());

    expect(setMock).toHaveBeenCalledWith({});
  });

  it("does not update persona belonging to another user", async () => {
    // The db query uses AND(id match, userId match), so an empty result means not found
    const selectChain = chainable({
      limit: vi.fn().mockResolvedValue([]),
    });
    mockDb.select = vi.fn(() => selectChain);

    const { handler } = registeredRoutes["PUT /:id"];
    const request = createRequest({
      userId: 999,
      params: { id: "p1" },
      body: { name: "Hacked" },
    });

    await expect(handler(request, createReply())).rejects.toThrow("Persona not found");
  });

  it("propagates db errors during select", async () => {
    const selectChain = chainable({
      limit: vi.fn().mockRejectedValue(new Error("select failed")),
    });
    mockDb.select = vi.fn(() => selectChain);

    const { handler } = registeredRoutes["PUT /:id"];
    const request = createRequest({
      params: { id: "p1" },
      body: { name: "Test" },
    });

    await expect(handler(request, createReply())).rejects.toThrow("select failed");
  });

  it("propagates db errors during update", async () => {
    const existing = { id: "p1", userId: 1 };

    const selectChain = chainable({
      limit: vi.fn().mockResolvedValue([existing]),
    });
    mockDb.select = vi.fn(() => selectChain);

    const updateChain = chainable({
      returning: vi.fn().mockRejectedValue(new Error("update failed")),
    });
    mockDb.update = vi.fn(() => updateChain);

    const { handler } = registeredRoutes["PUT /:id"];
    const request = createRequest({
      params: { id: "p1" },
      body: { name: "Test" },
    });

    await expect(handler(request, createReply())).rejects.toThrow("update failed");
  });
});

// ================================================================
// DELETE /:id — delete custom persona
// ================================================================
describe("DELETE /:id", () => {
  it("deletes persona successfully and returns success", async () => {
    const existing = { id: "p1", userId: 1, name: "To Delete" };

    const selectChain = chainable({
      limit: vi.fn().mockResolvedValue([existing]),
    });
    mockDb.select = vi.fn(() => selectChain);

    const deleteChain = chainable({
      where: vi.fn().mockResolvedValue(undefined),
    });
    mockDb.delete = vi.fn(() => deleteChain);

    const { handler } = registeredRoutes["DELETE /:id"];
    const request = createRequest({ params: { id: "p1" } });

    const result = await handler(request, createReply());
    expect(result).toEqual({ success: true });
    expect(mockDb.delete).toHaveBeenCalled();
  });

  it("throws AppError 404 when persona is not found", async () => {
    const selectChain = chainable({
      limit: vi.fn().mockResolvedValue([]),
    });
    mockDb.select = vi.fn(() => selectChain);

    const { handler } = registeredRoutes["DELETE /:id"];
    const request = createRequest({ params: { id: "nonexistent" } });

    try {
      await handler(request, createReply());
      expect.fail("should have thrown");
    } catch (err: any) {
      expect(err.statusCode).toBe(404);
      expect(err.message).toBe("Persona not found");
      expect(err.code).toBe("PERSONA_NOT_FOUND");
    }
  });

  it("does not delete persona belonging to another user", async () => {
    const selectChain = chainable({
      limit: vi.fn().mockResolvedValue([]),
    });
    mockDb.select = vi.fn(() => selectChain);

    const { handler } = registeredRoutes["DELETE /:id"];
    const request = createRequest({
      userId: 999,
      params: { id: "p1" },
    });

    await expect(handler(request, createReply())).rejects.toThrow("Persona not found");
  });

  it("propagates db errors during select", async () => {
    const selectChain = chainable({
      limit: vi.fn().mockRejectedValue(new Error("select exploded")),
    });
    mockDb.select = vi.fn(() => selectChain);

    const { handler } = registeredRoutes["DELETE /:id"];
    const request = createRequest({ params: { id: "p1" } });

    await expect(handler(request, createReply())).rejects.toThrow("select exploded");
  });

  it("propagates db errors during delete", async () => {
    const existing = { id: "p1", userId: 1 };

    const selectChain = chainable({
      limit: vi.fn().mockResolvedValue([existing]),
    });
    mockDb.select = vi.fn(() => selectChain);

    const deleteChain = chainable({
      where: vi.fn().mockRejectedValue(new Error("delete exploded")),
    });
    mockDb.delete = vi.fn(() => deleteChain);

    const { handler } = registeredRoutes["DELETE /:id"];
    const request = createRequest({ params: { id: "p1" } });

    await expect(handler(request, createReply())).rejects.toThrow("delete exploded");
  });
});
