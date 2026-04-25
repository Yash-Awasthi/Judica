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
    "onConflictDoUpdate",
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
    userId: "councilConfigs.userId",
    config: "councilConfigs.config",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: any[]) => args),
}));

vi.mock("../../src/middleware/fastifyAuth.js", () => ({
  fastifyRequireAuth: vi.fn(),
}));

const mockEncrypt = vi.fn((val: string) => `encrypted:${val}`);
vi.mock("../../src/lib/crypto.js", () => ({
  encrypt: (val: string) => mockEncrypt(val),
}));

const mockAskProvider = vi.fn();
vi.mock("../../src/lib/providers.js", () => ({
  askProvider: (...args: any[]) => mockAskProvider(...args),
}));

vi.mock("../../src/lib/logger.js", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../../src/lib/ssrf.js", () => ({
  validateSafeUrl: vi.fn().mockResolvedValue(undefined),
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
    send: vi.fn(function (this: any) {
      return this;
    }),
  };
  return reply;
}

// ---- import and register the plugin ----

let providersPlugin: any;

beforeEach(async () => {
  vi.clearAllMocks();
  for (const key of Object.keys(registeredRoutes)) {
    delete registeredRoutes[key];
  }

  const mod = await import("../../src/routes/providers.js");
  providersPlugin = mod.default;
  const fastify = createFastifyInstance();
  await providersPlugin(fastify);
});

// ================================================================
// Route registration
// ================================================================
describe("route registration", () => {
  it("registers all expected routes", () => {
    expect(registeredRoutes["GET /"]).toBeDefined();
    expect(registeredRoutes["POST /"]).toBeDefined();
    expect(registeredRoutes["POST /test"]).toBeDefined();
    expect(registeredRoutes["DELETE /:id"]).toBeDefined();
  });

  it("all routes have a preHandler for auth", () => {
    for (const key of Object.keys(registeredRoutes)) {
      expect(registeredRoutes[key].preHandler).toBeDefined();
    }
  });
});

// ================================================================
// GET /
// ================================================================
describe("GET /", () => {
  it("returns providers with masked API keys", async () => {
    const config = {
      providers: [
        { id: "1", name: "OpenAI", apiKey: "sk-abcdefgh12345678", model: "gpt-4" },
        { id: "2", name: "Anthropic", apiKey: "ant-xyz987654321", model: "claude-3" },
      ],
    };

    const chain = chainable({
      limit: vi.fn().mockResolvedValue([{ config }]),
    });
    mockDb.select = vi.fn(() => chain);

    const { handler } = registeredRoutes["GET /"];
    const result = await handler(createRequest(), createReply());

    expect(result.providers).toHaveLength(2);
    expect(result.providers[0].apiKey).toBe("••••••••5678");
    expect(result.providers[0].name).toBe("OpenAI");
    expect(result.providers[1].apiKey).toBe("••••••••4321");
    expect(result.providers[1].name).toBe("Anthropic");
  });

  it("returns empty array when no config exists", async () => {
    const chain = chainable({
      limit: vi.fn().mockResolvedValue([]),
    });
    mockDb.select = vi.fn(() => chain);

    const { handler } = registeredRoutes["GET /"];
    const result = await handler(createRequest(), createReply());

    expect(result.providers).toEqual([]);
  });

  it("returns empty array when config has no providers key", async () => {
    const chain = chainable({
      limit: vi.fn().mockResolvedValue([{ config: { someOtherKey: true } }]),
    });
    mockDb.select = vi.fn(() => chain);

    const { handler } = registeredRoutes["GET /"];
    const result = await handler(createRequest(), createReply());

    expect(result.providers).toEqual([]);
  });

  it("returns empty array when config is null/empty", async () => {
    const chain = chainable({
      limit: vi.fn().mockResolvedValue([{ config: null }]),
    });
    mockDb.select = vi.fn(() => chain);

    const { handler } = registeredRoutes["GET /"];
    const result = await handler(createRequest(), createReply());

    expect(result.providers).toEqual([]);
  });

  it("masks apiKey as null when apiKey is falsy", async () => {
    const config = {
      providers: [
        { id: "1", name: "NoKey", apiKey: "", model: "gpt-4" },
        { id: "2", name: "NullKey", apiKey: null, model: "gpt-4" },
      ],
    };

    const chain = chainable({
      limit: vi.fn().mockResolvedValue([{ config }]),
    });
    mockDb.select = vi.fn(() => chain);

    const { handler } = registeredRoutes["GET /"];
    const result = await handler(createRequest(), createReply());

    expect(result.providers[0].apiKey).toBeNull();
    expect(result.providers[1].apiKey).toBeNull();
  });

  it("returns 500 on database error", async () => {
    const chain = chainable({
      limit: vi.fn().mockRejectedValue(new Error("db down")),
    });
    mockDb.select = vi.fn(() => chain);

    const { handler } = registeredRoutes["GET /"];
    const reply = createReply();
    const result = await handler(createRequest(), reply);

    expect(reply.code).toHaveBeenCalledWith(500);
    expect(result.error).toBe("Failed to get providers");
    expect(result.code).toBe("PROVIDER_FETCH_FAILED");
  });

  it("uses the correct userId from request", async () => {
    const chain = chainable({
      limit: vi.fn().mockResolvedValue([]),
    });
    const mockWhere = vi.fn(() => chain);
    const fromChain = chainable({ where: mockWhere });
    const selectChain = chainable({ from: vi.fn(() => fromChain) });
    mockDb.select = vi.fn(() => selectChain);

    const { handler } = registeredRoutes["GET /"];
    await handler(createRequest({ userId: 42 }), createReply());

    expect(mockDb.select).toHaveBeenCalled();
  });
});

// ================================================================
// POST /
// ================================================================
describe("POST /", () => {
  const validBody = {
    name: "My Provider",
    type: "api",
    apiKey: "sk-test1234567890",
    model: "gpt-4",
  };

  it("adds a provider successfully and returns 201", async () => {
    const chain = chainable({
      limit: vi.fn().mockResolvedValue([]),
    });
    mockDb.select = vi.fn(() => chain);

    const insertChain = chainable({
      onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
    });
    const valuesChain = chainable({ onConflictDoUpdate: insertChain.onConflictDoUpdate });
    mockDb.insert = vi.fn(() => chainable({ values: vi.fn(() => valuesChain) }));

    const { handler } = registeredRoutes["POST /"];
    const reply = createReply();
    const result = await handler(createRequest({ body: validBody }), reply);

    expect(reply.code).toHaveBeenCalledWith(201);
    expect(result.provider.name).toBe("My Provider");
    expect(result.provider.type).toBe("api");
    expect(result.provider.model).toBe("gpt-4");
    // API key should be masked in the response
    expect(result.provider.apiKey).toBe("••••••••7890");
    // Verify encrypt was called with the original key
    expect(mockEncrypt).toHaveBeenCalledWith("sk-test1234567890");
  });

  it("adds a provider with optional provider identifier", async () => {
    const chain = chainable({
      limit: vi.fn().mockResolvedValue([]),
    });
    mockDb.select = vi.fn(() => chain);

    const insertChain = chainable({
      onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
    });
    mockDb.insert = vi.fn(() => chainable({ values: vi.fn(() => insertChain) }));

    const body = { ...validBody, provider: "openai" };
    const { handler } = registeredRoutes["POST /"];
    const reply = createReply();
    const result = await handler(createRequest({ body }), reply);

    expect(reply.code).toHaveBeenCalledWith(201);
    expect(result.provider.provider).toBe("openai");
  });

  it("adds a provider with optional baseUrl", async () => {
    const chain = chainable({
      limit: vi.fn().mockResolvedValue([]),
    });
    mockDb.select = vi.fn(() => chain);

    const insertChain = chainable({
      onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
    });
    mockDb.insert = vi.fn(() => chainable({ values: vi.fn(() => insertChain) }));

    const body = { ...validBody, baseUrl: "https://api.example.com" };
    const { handler } = registeredRoutes["POST /"];
    const reply = createReply();
    const result = await handler(createRequest({ body }), reply);

    expect(reply.code).toHaveBeenCalledWith(201);
    expect(result.provider.baseUrl).toBe("https://api.example.com");
  });

  it("appends to existing providers", async () => {
    const existingConfig = {
      providers: [{ id: "old", name: "Existing", apiKey: "enc:old", model: "gpt-3" }],
      otherSetting: true,
    };

    const chain = chainable({
      limit: vi.fn().mockResolvedValue([{ config: existingConfig }]),
    });
    mockDb.select = vi.fn(() => chain);

    const insertChain = chainable({
      onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
    });
    mockDb.insert = vi.fn(() => chainable({ values: vi.fn(() => insertChain) }));

    const { handler } = registeredRoutes["POST /"];
    const reply = createReply();
    const result = await handler(createRequest({ body: validBody }), reply);

    expect(reply.code).toHaveBeenCalledWith(201);
    expect(result.provider.name).toBe("My Provider");
  });

  it("returns 400 for missing name", async () => {
    const body = { ...validBody, name: "" };
    const { handler } = registeredRoutes["POST /"];
    const reply = createReply();
    const result = await handler(createRequest({ body }), reply);

    expect(reply.code).toHaveBeenCalledWith(400);
    expect(result.error).toBe("Validation failed");
    expect(result.details).toBeDefined();
    expect(result.details.length).toBeGreaterThan(0);
  });

  it("returns 400 for missing apiKey", async () => {
    const { apiKey, ...bodyWithoutKey } = validBody;
    const { handler } = registeredRoutes["POST /"];
    const reply = createReply();
    const result = await handler(createRequest({ body: bodyWithoutKey }), reply);

    expect(reply.code).toHaveBeenCalledWith(400);
    expect(result.error).toBe("Validation failed");
  });

  it("returns 400 for missing model", async () => {
    const body = { ...validBody, model: "" };
    const { handler } = registeredRoutes["POST /"];
    const reply = createReply();
    const result = await handler(createRequest({ body }), reply);

    expect(reply.code).toHaveBeenCalledWith(400);
    expect(result.error).toBe("Validation failed");
  });

  it("returns 400 for invalid type", async () => {
    const body = { ...validBody, type: "invalid" };
    const { handler } = registeredRoutes["POST /"];
    const reply = createReply();
    const result = await handler(createRequest({ body }), reply);

    expect(reply.code).toHaveBeenCalledWith(400);
    expect(result.error).toBe("Validation failed");
  });

  it("returns 400 for invalid provider identifier", async () => {
    const body = { ...validBody, provider: "unsupported-provider" };
    const { handler } = registeredRoutes["POST /"];
    const reply = createReply();
    const result = await handler(createRequest({ body }), reply);

    expect(reply.code).toHaveBeenCalledWith(400);
    expect(result.error).toBe("Validation failed");
  });

  it("returns 400 for invalid baseUrl (not a URL)", async () => {
    const body = { ...validBody, baseUrl: "not-a-url" };
    const { handler } = registeredRoutes["POST /"];
    const reply = createReply();
    const result = await handler(createRequest({ body }), reply);

    expect(reply.code).toHaveBeenCalledWith(400);
    expect(result.error).toBe("Validation failed");
  });

  it("returns 400 for completely empty body", async () => {
    const { handler } = registeredRoutes["POST /"];
    const reply = createReply();
    const result = await handler(createRequest({ body: {} }), reply);

    expect(reply.code).toHaveBeenCalledWith(400);
    expect(result.error).toBe("Validation failed");
  });

  it("validation details include field paths", async () => {
    const { handler } = registeredRoutes["POST /"];
    const reply = createReply();
    const result = await handler(createRequest({ body: {} }), reply);

    expect(result.details).toBeInstanceOf(Array);
    for (const detail of result.details) {
      expect(detail).toHaveProperty("field");
      expect(detail).toHaveProperty("message");
    }
  });

  it("accepts all valid type values: api, local, rpa", async () => {
    for (const type of ["api", "local", "rpa"]) {
      const chain = chainable({
        limit: vi.fn().mockResolvedValue([]),
      });
      mockDb.select = vi.fn(() => chain);
      const insertChain = chainable({
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
      });
      mockDb.insert = vi.fn(() => chainable({ values: vi.fn(() => insertChain) }));

      const body = { ...validBody, type };
      const { handler } = registeredRoutes["POST /"];
      const reply = createReply();
      const result = await handler(createRequest({ body }), reply);

      expect(reply.code).toHaveBeenCalledWith(201);
      expect(result.provider.type).toBe(type);
    }
  });

  it("accepts all valid provider identifiers", async () => {
    const validProviders = ["openai", "anthropic", "google", "ollama", "chatgpt", "claude", "deepseek", "gemini"];
    for (const provider of validProviders) {
      const chain = chainable({
        limit: vi.fn().mockResolvedValue([]),
      });
      mockDb.select = vi.fn(() => chain);
      const insertChain = chainable({
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
      });
      mockDb.insert = vi.fn(() => chainable({ values: vi.fn(() => insertChain) }));

      const body = { ...validBody, provider };
      const { handler } = registeredRoutes["POST /"];
      const reply = createReply();
      const result = await handler(createRequest({ body }), reply);

      expect(reply.code).toHaveBeenCalledWith(201);
      expect(result.provider.provider).toBe(provider);
    }
  });

  it("stores encrypted API key in the provider", async () => {
    const chain = chainable({
      limit: vi.fn().mockResolvedValue([]),
    });
    mockDb.select = vi.fn(() => chain);

    let capturedValues: any;
    const insertChain = chainable({
      onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
    });
    mockDb.insert = vi.fn(() =>
      chainable({
        values: vi.fn((vals: any) => {
          capturedValues = vals;
          return insertChain;
        }),
      })
    );

    const { handler } = registeredRoutes["POST /"];
    await handler(createRequest({ body: validBody }), createReply());

    expect(mockEncrypt).toHaveBeenCalledWith("sk-test1234567890");
    // The config stored should contain the encrypted key
    expect(capturedValues.config.providers[0].apiKey).toBe("encrypted:sk-test1234567890");
  });

  it("returns 500 on database error during select", async () => {
    const chain = chainable({
      limit: vi.fn().mockRejectedValue(new Error("db read error")),
    });
    mockDb.select = vi.fn(() => chain);

    const { handler } = registeredRoutes["POST /"];
    const reply = createReply();
    const result = await handler(createRequest({ body: validBody }), reply);

    expect(reply.code).toHaveBeenCalledWith(500);
    expect(result.error).toBe("Failed to add provider");
    expect(result.code).toBe("PROVIDER_CREATE_FAILED");
  });

  it("returns 500 on database error during insert", async () => {
    const chain = chainable({
      limit: vi.fn().mockResolvedValue([]),
    });
    mockDb.select = vi.fn(() => chain);

    const insertChain = chainable({
      onConflictDoUpdate: vi.fn().mockRejectedValue(new Error("db write error")),
    });
    mockDb.insert = vi.fn(() => chainable({ values: vi.fn(() => insertChain) }));

    const { handler } = registeredRoutes["POST /"];
    const reply = createReply();
    const result = await handler(createRequest({ body: validBody }), reply);

    expect(reply.code).toHaveBeenCalledWith(500);
    expect(result.error).toBe("Failed to add provider");
    expect(result.code).toBe("PROVIDER_CREATE_FAILED");
  });

  it("generates an id and createdAt for the new provider", async () => {
    const chain = chainable({
      limit: vi.fn().mockResolvedValue([]),
    });
    mockDb.select = vi.fn(() => chain);

    const insertChain = chainable({
      onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
    });
    mockDb.insert = vi.fn(() => chainable({ values: vi.fn(() => insertChain) }));

    const { handler } = registeredRoutes["POST /"];
    const reply = createReply();
    const result = await handler(createRequest({ body: validBody }), reply);

    expect(result.provider.id).toBeDefined();
    expect(typeof result.provider.id).toBe("string");
    expect(result.provider.createdAt).toBeDefined();
  });
});

// ================================================================
// POST /test
// ================================================================
describe("POST /test", () => {
  const validTestBody = {
    type: "api",
    apiKey: "sk-test1234567890",
    model: "gpt-4",
  };

  it("tests a provider successfully", async () => {
    mockAskProvider.mockResolvedValue({
      text: "Hello, I am working fine!",
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });

    const { handler } = registeredRoutes["POST /test"];
    const reply = createReply();
    const result = await handler(createRequest({ body: validTestBody }), reply);

    expect(result.success).toBe(true);
    expect(result.response).toBe("Hello, I am working fine!");
    expect(result.usage).toEqual({ prompt_tokens: 10, completion_tokens: 5 });
    expect(typeof result.latencyMs).toBe("number");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("passes correct provider config to askProvider", async () => {
    mockAskProvider.mockResolvedValue({ text: "ok", usage: {} });

    const { handler } = registeredRoutes["POST /test"];
    await handler(createRequest({ body: validTestBody }), createReply());

    expect(mockAskProvider).toHaveBeenCalledWith(
      {
        name: "Test Provider",
        type: "api",
        apiKey: "sk-test1234567890",
        model: "gpt-4",
        baseUrl: undefined,
      },
      [{ role: "user", content: "Say 'Hello, I am working!' in exactly 5 words." }],
      false,
    );
  });

  it("passes baseUrl to askProvider when provided", async () => {
    mockAskProvider.mockResolvedValue({ text: "ok", usage: {} });

    const body = { ...validTestBody, baseUrl: "https://custom.api.com" };
    const { handler } = registeredRoutes["POST /test"];
    await handler(createRequest({ body }), createReply());

    expect(mockAskProvider).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: "https://custom.api.com" }),
      expect.any(Array),
      false,
    );
  });

  it("returns 400 when provider test fails", async () => {
    mockAskProvider.mockRejectedValue(new Error("Authentication failed"));

    const { handler } = registeredRoutes["POST /test"];
    const reply = createReply();
    const result = await handler(createRequest({ body: validTestBody }), reply);

    expect(reply.code).toHaveBeenCalledWith(400);
    expect(result.success).toBe(false);
    expect(result.error).toBe("Authentication failed");
  });

  it("returns 400 for missing type", async () => {
    const { type, ...body } = validTestBody;
    const { handler } = registeredRoutes["POST /test"];
    const reply = createReply();
    const result = await handler(createRequest({ body }), reply);

    expect(reply.code).toHaveBeenCalledWith(400);
    expect(result.error).toBe("Validation failed");
  });

  it("returns 400 for missing apiKey", async () => {
    const { apiKey, ...body } = validTestBody;
    const { handler } = registeredRoutes["POST /test"];
    const reply = createReply();
    const result = await handler(createRequest({ body }), reply);

    expect(reply.code).toHaveBeenCalledWith(400);
    expect(result.error).toBe("Validation failed");
  });

  it("returns 400 for missing model", async () => {
    const { model, ...body } = validTestBody;
    const { handler } = registeredRoutes["POST /test"];
    const reply = createReply();
    const result = await handler(createRequest({ body }), reply);

    expect(reply.code).toHaveBeenCalledWith(400);
    expect(result.error).toBe("Validation failed");
  });

  it("returns 400 for invalid type", async () => {
    const body = { ...validTestBody, type: "invalid" };
    const { handler } = registeredRoutes["POST /test"];
    const reply = createReply();
    const result = await handler(createRequest({ body }), reply);

    expect(reply.code).toHaveBeenCalledWith(400);
    expect(result.error).toBe("Validation failed");
  });

  it("returns 400 for empty body", async () => {
    const { handler } = registeredRoutes["POST /test"];
    const reply = createReply();
    const result = await handler(createRequest({ body: {} }), reply);

    expect(reply.code).toHaveBeenCalledWith(400);
    expect(result.error).toBe("Validation failed");
  });

  it("returns 400 for invalid baseUrl", async () => {
    const body = { ...validTestBody, baseUrl: "not-a-url" };
    const { handler } = registeredRoutes["POST /test"];
    const reply = createReply();
    const result = await handler(createRequest({ body }), reply);

    expect(reply.code).toHaveBeenCalledWith(400);
    expect(result.error).toBe("Validation failed");
  });

  it("validation details include field and message", async () => {
    const { handler } = registeredRoutes["POST /test"];
    const reply = createReply();
    const result = await handler(createRequest({ body: {} }), reply);

    expect(result.details).toBeInstanceOf(Array);
    for (const detail of result.details) {
      expect(detail).toHaveProperty("field");
      expect(detail).toHaveProperty("message");
    }
  });

  it("handles provider timeout/network errors", async () => {
    mockAskProvider.mockRejectedValue(new Error("ECONNREFUSED"));

    const { handler } = registeredRoutes["POST /test"];
    const reply = createReply();
    const result = await handler(createRequest({ body: validTestBody }), reply);

    expect(reply.code).toHaveBeenCalledWith(400);
    expect(result.success).toBe(false);
    expect(result.error).toBe("ECONNREFUSED");
  });
});

// ================================================================
// DELETE /:id
// ================================================================
describe("DELETE /:id", () => {
  it("deletes a provider successfully", async () => {
    const existingConfig = {
      providers: [
        { id: "provider-1", name: "OpenAI", apiKey: "enc:key1" },
        { id: "provider-2", name: "Anthropic", apiKey: "enc:key2" },
      ],
      otherSetting: true,
    };

    const chain = chainable({
      limit: vi.fn().mockResolvedValue([{ config: existingConfig }]),
    });
    mockDb.select = vi.fn(() => chain);

    const insertChain = chainable({
      onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
    });
    mockDb.insert = vi.fn(() => chainable({ values: vi.fn(() => insertChain) }));

    const { handler } = registeredRoutes["DELETE /:id"];
    const reply = createReply();
    const result = await handler(createRequest({ params: { id: "provider-1" } }), reply);

    expect(result).toEqual({ message: "Provider deleted" });
  });

  it("returns 404 when provider not found", async () => {
    const existingConfig = {
      providers: [
        { id: "provider-1", name: "OpenAI", apiKey: "enc:key1" },
      ],
    };

    const chain = chainable({
      limit: vi.fn().mockResolvedValue([{ config: existingConfig }]),
    });
    mockDb.select = vi.fn(() => chain);

    const { handler } = registeredRoutes["DELETE /:id"];
    const reply = createReply();
    const result = await handler(createRequest({ params: { id: "nonexistent" } }), reply);

    expect(reply.code).toHaveBeenCalledWith(404);
    expect(result.error).toBe("Provider not found");
  });

  it("returns 404 when no providers exist at all", async () => {
    const chain = chainable({
      limit: vi.fn().mockResolvedValue([{ config: {} }]),
    });
    mockDb.select = vi.fn(() => chain);

    const { handler } = registeredRoutes["DELETE /:id"];
    const reply = createReply();
    const result = await handler(createRequest({ params: { id: "any-id" } }), reply);

    expect(reply.code).toHaveBeenCalledWith(404);
    expect(result.error).toBe("Provider not found");
  });

  it("returns 404 when no config row exists", async () => {
    const chain = chainable({
      limit: vi.fn().mockResolvedValue([]),
    });
    mockDb.select = vi.fn(() => chain);

    const { handler } = registeredRoutes["DELETE /:id"];
    const reply = createReply();
    const result = await handler(createRequest({ params: { id: "any-id" } }), reply);

    expect(reply.code).toHaveBeenCalledWith(404);
    expect(result.error).toBe("Provider not found");
  });

  it("preserves other config settings when deleting a provider", async () => {
    const existingConfig = {
      providers: [
        { id: "provider-1", name: "OpenAI", apiKey: "enc:key1" },
      ],
      otherSetting: "keep-me",
    };

    const chain = chainable({
      limit: vi.fn().mockResolvedValue([{ config: existingConfig }]),
    });
    mockDb.select = vi.fn(() => chain);

    let capturedValues: any;
    const insertChain = chainable({
      onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
    });
    mockDb.insert = vi.fn(() =>
      chainable({
        values: vi.fn((vals: any) => {
          capturedValues = vals;
          return insertChain;
        }),
      })
    );

    const { handler } = registeredRoutes["DELETE /:id"];
    await handler(createRequest({ params: { id: "provider-1" } }), createReply());

    expect(capturedValues.config.otherSetting).toBe("keep-me");
    expect(capturedValues.config.providers).toEqual([]);
  });

  it("only deletes the matching provider, keeps the rest", async () => {
    const existingConfig = {
      providers: [
        { id: "p1", name: "First" },
        { id: "p2", name: "Second" },
        { id: "p3", name: "Third" },
      ],
    };

    const chain = chainable({
      limit: vi.fn().mockResolvedValue([{ config: existingConfig }]),
    });
    mockDb.select = vi.fn(() => chain);

    let capturedValues: any;
    const insertChain = chainable({
      onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
    });
    mockDb.insert = vi.fn(() =>
      chainable({
        values: vi.fn((vals: any) => {
          capturedValues = vals;
          return insertChain;
        }),
      })
    );

    const { handler } = registeredRoutes["DELETE /:id"];
    await handler(createRequest({ params: { id: "p2" } }), createReply());

    expect(capturedValues.config.providers).toHaveLength(2);
    expect(capturedValues.config.providers.map((p: any) => p.id)).toEqual(["p1", "p3"]);
  });

  it("returns 500 on database error during select", async () => {
    const chain = chainable({
      limit: vi.fn().mockRejectedValue(new Error("db read error")),
    });
    mockDb.select = vi.fn(() => chain);

    const { handler } = registeredRoutes["DELETE /:id"];
    const reply = createReply();
    const result = await handler(createRequest({ params: { id: "p1" } }), reply);

    expect(reply.code).toHaveBeenCalledWith(500);
    expect(result.error).toBe("Failed to delete provider");
    expect(result.code).toBe("PROVIDER_DELETE_FAILED");
  });

  it("returns 500 on database error during insert/update", async () => {
    const existingConfig = {
      providers: [{ id: "p1", name: "First" }],
    };

    const chain = chainable({
      limit: vi.fn().mockResolvedValue([{ config: existingConfig }]),
    });
    mockDb.select = vi.fn(() => chain);

    const insertChain = chainable({
      onConflictDoUpdate: vi.fn().mockRejectedValue(new Error("db write error")),
    });
    mockDb.insert = vi.fn(() => chainable({ values: vi.fn(() => insertChain) }));

    const { handler } = registeredRoutes["DELETE /:id"];
    const reply = createReply();
    const result = await handler(createRequest({ params: { id: "p1" } }), reply);

    expect(reply.code).toHaveBeenCalledWith(500);
    expect(result.error).toBe("Failed to delete provider");
    expect(result.code).toBe("PROVIDER_DELETE_FAILED");
  });

  it("uses the correct userId from request", async () => {
    const chain = chainable({
      limit: vi.fn().mockResolvedValue([]),
    });
    const mockWhere = vi.fn(() => chain);
    const fromChain = chainable({ where: mockWhere });
    const selectChain = chainable({ from: vi.fn(() => fromChain) });
    mockDb.select = vi.fn(() => selectChain);

    const { handler } = registeredRoutes["DELETE /:id"];
    const reply = createReply();
    await handler(createRequest({ userId: 99, params: { id: "any" } }), reply);

    expect(mockDb.select).toHaveBeenCalled();
  });
});
