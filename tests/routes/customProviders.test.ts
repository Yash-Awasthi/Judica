import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks – vi.hoisted runs before vi.mock factories, so these
// variables are available inside the factory callbacks.
// ---------------------------------------------------------------------------

const {
  mockEncrypt,
  mockDecrypt,
  mockMask,
  mockRegisterAdapter,
  mockDeregisterAdapter,
  mockListAvailableProviders,
  mockGetAdapterOrNull,
  mockReturning,
  mockLimit,
  mockWhere,
  mockFrom,
  mockSet,
  mockValues,
  mockSelect,
  mockInsert,
  mockUpdate,
  mockDeleteFn,
} = vi.hoisted(() => ({
  mockEncrypt: vi.fn((v: string) => `encrypted_${v}`),
  mockDecrypt: vi.fn((v: string) => v.replace("encrypted_", "")),
  mockMask: vi.fn((_v: string) => "****"),
  mockRegisterAdapter: vi.fn(),
  mockDeregisterAdapter: vi.fn(),
  mockListAvailableProviders: vi.fn(),
  mockGetAdapterOrNull: vi.fn(),
  mockReturning: vi.fn(),
  mockLimit: vi.fn(),
  mockWhere: vi.fn(),
  mockFrom: vi.fn(),
  mockSet: vi.fn(),
  mockValues: vi.fn(),
  mockSelect: vi.fn(),
  mockInsert: vi.fn(),
  mockUpdate: vi.fn(),
  mockDeleteFn: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../../src/middleware/fastifyAuth.js", () => ({
  fastifyRequireAuth: vi.fn(),
}));

vi.mock("../../src/middleware/errorHandler.js", () => {
  class AppError extends Error {
    statusCode: number;
    code: string;
    constructor(statusCode: number, message: string, code: string = "INTERNAL_ERROR") {
      super(message);
      this.statusCode = statusCode;
      this.code = code;
    }
  }
  return { AppError };
});

vi.mock("../../src/lib/crypto.js", () => ({
  encrypt: mockEncrypt,
  decrypt: mockDecrypt,
  mask: mockMask,
}));

vi.mock("../../src/adapters/registry.js", () => ({
  registerAdapter: mockRegisterAdapter,
  deregisterAdapter: mockDeregisterAdapter,
  listAvailableProviders: mockListAvailableProviders,
  getAdapterOrNull: mockGetAdapterOrNull,
}));

vi.mock("../../src/adapters/custom.adapter.js", () => {
  function CustomAdapter(this: any, config: any) {
    this.config = config;
    this.generate = vi.fn();
    this.listModels = vi.fn();
  }
  return { CustomAdapter };
});

vi.mock("../../src/lib/drizzle.js", () => ({
  db: {
    select: (...args: any[]) => mockSelect(...args),
    insert: (...args: any[]) => mockInsert(...args),
    update: (...args: any[]) => mockUpdate(...args),
    delete: (...args: any[]) => mockDeleteFn(...args),
  },
}));

vi.mock("../../src/db/schema/council.js", () => ({
  customProviders: {
    id: "id",
    userId: "userId",
    name: "name",
    baseUrl: "baseUrl",
    authType: "authType",
    authKey: "authKey",
    authHeaderName: "authHeaderName",
    capabilities: "capabilities",
    models: "models",
    createdAt: "createdAt",
    updatedAt: "updatedAt",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a: any, b: any) => ({ op: "eq", a, b })),
  and: vi.fn((...args: any[]) => ({ op: "and", args })),
}));

vi.mock("../../src/lib/logger.js", () => ({
  default: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../src/config/env.js", () => ({
  env: {
    JWT_SECRET: "test-jwt-secret-min-16-chars",
    MASTER_ENCRYPTION_KEY: "test-master-encryption-key-min-32-characters-long",
  },
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------
import customProvidersPlugin from "../../src/routes/customProviders.js";
import { AppError } from "../../src/middleware/errorHandler.js";

// ---------------------------------------------------------------------------
// Helpers – capture Fastify route handlers via a mock fastify instance
// ---------------------------------------------------------------------------

type Handler = (request: any, reply: any) => Promise<any>;

interface CapturedRoutes {
  [key: string]: Handler;
}

function buildFastify(): { fastify: any; routes: CapturedRoutes } {
  const routes: CapturedRoutes = {};
  const fastify = {
    get: vi.fn((path: string, _opts: any, handler: Handler) => {
      routes[`GET ${path}`] = handler;
    }),
    post: vi.fn((path: string, _opts: any, handler: Handler) => {
      routes[`POST ${path}`] = handler;
    }),
    put: vi.fn((path: string, _opts: any, handler: Handler) => {
      routes[`PUT ${path}`] = handler;
    }),
    delete: vi.fn((path: string, _opts: any, handler: Handler) => {
      routes[`DELETE ${path}`] = handler;
    }),
  };
  return { fastify, routes };
}

function makeRequest(overrides: Record<string, any> = {}) {
  return { userId: "user-1", body: {}, params: {}, ...overrides };
}

function makeReply() {
  const reply: any = { statusCode: 200 };
  reply.code = vi.fn((c: number) => {
    reply.statusCode = c;
    return reply;
  });
  return reply;
}

// ---------------------------------------------------------------------------
// Drizzle chain helpers – reset and wire per-test
// ---------------------------------------------------------------------------

function resetDrizzleChain() {
  mockSelect.mockReset();
  mockInsert.mockReset();
  mockUpdate.mockReset();
  mockDeleteFn.mockReset();
  mockFrom.mockReset();
  mockWhere.mockReset();
  mockLimit.mockReset();
  mockReturning.mockReset();
  mockValues.mockReset();
  mockSet.mockReset();
}

/** select().from().where() -> rows (no .limit(), used by GET / list) */
function setupSelectChainNoLimit(rows: any[]) {
  const whereFn = vi.fn().mockReturnValue(rows);
  const fromFn = vi.fn().mockReturnValue({ where: whereFn });
  mockSelect.mockReturnValueOnce({ from: fromFn });
}

/** select().from().where().limit() -> rows */
function setupSelectChain(rows: any[]) {
  const limitFn = vi.fn().mockReturnValue(rows);
  const whereFn = vi.fn().mockReturnValue({ limit: limitFn });
  const fromFn = vi.fn().mockReturnValue({ where: whereFn });
  mockSelect.mockReturnValueOnce({ from: fromFn });
}

/** insert().values().returning() -> rows */
function setupInsertChain(rows: any[]) {
  const returningFn = vi.fn().mockReturnValue(rows);
  const valuesFn = vi.fn().mockReturnValue({ returning: returningFn });
  mockInsert.mockReturnValueOnce({ values: valuesFn });
}

/** update().set().where().returning() -> rows */
function setupUpdateChain(rows: any[]) {
  const returningFn = vi.fn().mockReturnValue(rows);
  const whereFn = vi.fn().mockReturnValue({ returning: returningFn });
  const setFn = vi.fn().mockReturnValue({ where: whereFn });
  mockUpdate.mockReturnValueOnce({ set: setFn });
}

/** delete().where() */
function setupDeleteChain() {
  const whereFn = vi.fn().mockReturnValue(undefined);
  mockDeleteFn.mockReturnValueOnce({ where: whereFn });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("customProviders route plugin", () => {
  let routes: CapturedRoutes;

  beforeEach(async () => {
    vi.clearAllMocks();
    resetDrizzleChain();

    const f = buildFastify();
    routes = f.routes;
    await customProvidersPlugin(f.fastify as any, {} as any);
  });

  it("registers all expected routes", () => {
    expect(routes["GET /"]).toBeDefined();
    expect(routes["POST /custom"]).toBeDefined();
    expect(routes["PUT /custom/:id"]).toBeDefined();
    expect(routes["DELETE /custom/:id"]).toBeDefined();
    expect(routes["POST /custom/:id/test"]).toBeDefined();
    expect(routes["GET /:providerId/models"]).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // GET / – list providers
  // -----------------------------------------------------------------------
  describe("GET / (list providers)", () => {
    it("returns built-in and custom providers", async () => {
      mockListAvailableProviders.mockReturnValue(["openai", "anthropic", "custom_99"]);
      mockGetAdapterOrNull.mockReturnValue({ id: "adapter" });

      // select chain for custom providers (no .limit())
      const customRows = [
        {
          id: 7,
          name: "My LLM",
          baseUrl: "https://my-llm.example.com",
          authType: "bearer",
          capabilities: { streaming: true, tools: false, vision: false },
          models: ["model-a"],
          createdAt: new Date("2025-01-01"),
          updatedAt: new Date("2025-01-02"),
        },
      ];
      setupSelectChainNoLimit(customRows);

      const result = await routes["GET /"](makeRequest(), makeReply());

      expect(result.providers).toHaveLength(3); // 2 builtin + 1 custom
      expect(result.providers[0]).toMatchObject({ id: "openai", type: "builtin", available: true });
      expect(result.providers[1]).toMatchObject({ id: "anthropic", type: "builtin" });
      expect(result.providers[2]).toMatchObject({
        id: "custom_7",
        name: "My LLM",
        type: "custom",
        available: true,
      });
    });

    it("filters out custom_ prefixed IDs from built-in list", async () => {
      mockListAvailableProviders.mockReturnValue(["openai", "custom_1"]);
      setupSelectChainNoLimit([]);

      const result = await routes["GET /"](makeRequest(), makeReply());

      const builtInIds = result.providers.map((p: any) => p.id);
      expect(builtInIds).toEqual(["openai"]);
    });

    it("marks custom provider unavailable when adapter is null", async () => {
      mockListAvailableProviders.mockReturnValue([]);
      mockGetAdapterOrNull.mockReturnValue(null);

      const customRows = [
        {
          id: 3,
          name: "Offline",
          baseUrl: "https://offline.example.com",
          authType: "none",
          capabilities: {},
          models: ["m1"],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      setupSelectChainNoLimit(customRows);

      const result = await routes["GET /"](makeRequest(), makeReply());

      expect(result.providers[0].available).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // POST /custom – create a custom provider
  // -----------------------------------------------------------------------
  describe("POST /custom (create)", () => {
    const validBody = {
      name: "TestProvider",
      base_url: "https://api.test.com",
      auth_type: "bearer",
      auth_key: "sk-secret",
      auth_header_name: "Authorization",
      capabilities: { streaming: true, tools: false, vision: false },
      models: ["gpt-test"],
    };

    it("creates provider and returns 201", async () => {
      const createdRow = {
        id: 42,
        name: "TestProvider",
        baseUrl: "https://api.test.com",
        authType: "bearer",
        authKey: "encrypted_sk-secret",
        authHeaderName: "Authorization",
        capabilities: { streaming: true, tools: false, vision: false },
        models: ["gpt-test"],
      };
      setupInsertChain([createdRow]);

      const reply = makeReply();
      const result = await routes["POST /custom"](makeRequest({ body: validBody }), reply);

      expect(reply.code).toHaveBeenCalledWith(201);
      expect(result.id).toBe("custom_42");
      expect(result.name).toBe("TestProvider");
      expect(mockEncrypt).toHaveBeenCalledWith("sk-secret");
      expect(mockRegisterAdapter).toHaveBeenCalledWith("custom_42", expect.anything());
    });

    it("defaults capabilities when not provided", async () => {
      const bodyNoCapabilities = {
        name: "NoCap",
        base_url: "https://nocap.test.com",
        auth_type: "none",
        models: ["m1"],
      };
      const createdRow = {
        id: 10,
        name: "NoCap",
        baseUrl: "https://nocap.test.com",
        authType: "none",
        authKey: "",
        authHeaderName: null,
        capabilities: { streaming: true, tools: false, vision: false },
        models: ["m1"],
      };
      setupInsertChain([createdRow]);

      const result = await routes["POST /custom"](makeRequest({ body: bodyNoCapabilities }), makeReply());
      expect(result.id).toBe("custom_10");
    });

    it("encrypts empty string when auth_key is absent", async () => {
      const bodyNoKey = { name: "NoKey", base_url: "https://nk.com", auth_type: "none", models: ["x"] };
      const createdRow = {
        id: 11,
        name: "NoKey",
        baseUrl: "https://nk.com",
        authType: "none",
        authKey: "",
        authHeaderName: null,
        capabilities: { streaming: true, tools: false, vision: false },
        models: ["x"],
      };
      setupInsertChain([createdRow]);

      await routes["POST /custom"](makeRequest({ body: bodyNoKey }), makeReply());

      // auth_key is falsy -> encrypt is NOT called, "" is used
      expect(mockEncrypt).not.toHaveBeenCalled();
    });

    it("throws 400 when name is missing", async () => {
      const body = { base_url: "https://u.com", auth_type: "bearer", models: ["m"] };
      await expect(routes["POST /custom"](makeRequest({ body }), makeReply())).rejects.toThrow(AppError);
      await expect(routes["POST /custom"](makeRequest({ body }), makeReply())).rejects.toThrow(
        "name, base_url, and auth_type are required",
      );
    });

    it("throws 400 when base_url is missing", async () => {
      const body = { name: "N", auth_type: "bearer", models: ["m"] };
      await expect(routes["POST /custom"](makeRequest({ body }), makeReply())).rejects.toThrow(AppError);
    });

    it("throws 400 when auth_type is missing", async () => {
      const body = { name: "N", base_url: "https://u.com", models: ["m"] };
      await expect(routes["POST /custom"](makeRequest({ body }), makeReply())).rejects.toThrow(AppError);
    });

    it("throws 400 when models is empty array", async () => {
      const body = { name: "N", base_url: "https://u.com", auth_type: "bearer", models: [] };
      await expect(routes["POST /custom"](makeRequest({ body }), makeReply())).rejects.toThrow(
        "At least one model must be specified",
      );
    });

    it("throws 400 when models is missing", async () => {
      const body = { name: "N", base_url: "https://u.com", auth_type: "bearer" };
      await expect(routes["POST /custom"](makeRequest({ body }), makeReply())).rejects.toThrow(AppError);
    });

    it("throws 400 when models is not an array", async () => {
      const body = { name: "N", base_url: "https://u.com", auth_type: "bearer", models: "not-array" };
      await expect(routes["POST /custom"](makeRequest({ body }), makeReply())).rejects.toThrow(AppError);
    });
  });

  // -----------------------------------------------------------------------
  // PUT /custom/:id – update
  // -----------------------------------------------------------------------
  describe("PUT /custom/:id (update)", () => {
    const existingRow = {
      id: 5,
      userId: "user-1",
      name: "Old",
      baseUrl: "https://old.com",
      authType: "bearer",
      authKey: "encrypted_old",
      authHeaderName: null,
      capabilities: { streaming: true, tools: false, vision: false },
      models: ["old-model"],
    };

    it("updates provider and re-registers adapter", async () => {
      // select existing
      setupSelectChain([existingRow]);

      const updatedRow = {
        ...existingRow,
        name: "New",
        baseUrl: "https://new.com",
      };

      // We need update chain after the select chain is consumed.
      // Because the select chain is set up first and used first, we reset
      // the shared mocks for the update call after the select resolves.
      // A simpler approach: set up update chain right away, it uses mockUpdate
      // which is independent of mockSelect.
      setupUpdateChain([updatedRow]);

      const req = makeRequest({
        params: { id: "5" },
        body: { name: "New", base_url: "https://new.com" },
      });
      const result = await routes["PUT /custom/:id"](req, makeReply());

      expect(result.id).toBe("custom_5");
      expect(result.name).toBe("New");
      expect(mockDeregisterAdapter).toHaveBeenCalledWith("custom_5");
      expect(mockRegisterAdapter).toHaveBeenCalledWith("custom_5", expect.anything());
    });

    it("encrypts new auth_key when provided", async () => {
      setupSelectChain([existingRow]);
      setupUpdateChain([{ ...existingRow, authKey: "encrypted_new-key" }]);

      const req = makeRequest({ params: { id: "5" }, body: { auth_key: "new-key" } });
      await routes["PUT /custom/:id"](req, makeReply());

      expect(mockEncrypt).toHaveBeenCalledWith("new-key");
    });

    it("throws 404 when provider not found", async () => {
      setupSelectChain([]);

      const req = makeRequest({ params: { id: "999" }, body: { name: "X" } });
      await expect(routes["PUT /custom/:id"](req, makeReply())).rejects.toThrow("Custom provider not found");
    });
  });

  // -----------------------------------------------------------------------
  // DELETE /custom/:id
  // -----------------------------------------------------------------------
  describe("DELETE /custom/:id", () => {
    const existingRow = {
      id: 8,
      userId: "user-1",
      name: "ToDelete",
      baseUrl: "https://del.com",
      authType: "none",
      authKey: "",
      authHeaderName: null,
      capabilities: {},
      models: ["m"],
    };

    it("deletes provider, deregisters adapter, returns { deleted: true }", async () => {
      setupSelectChain([existingRow]);
      setupDeleteChain();

      const req = makeRequest({ params: { id: "8" } });
      const result = await routes["DELETE /custom/:id"](req, makeReply());

      expect(result).toEqual({ deleted: true });
      expect(mockDeregisterAdapter).toHaveBeenCalledWith("custom_8");
      expect(mockDeleteFn).toHaveBeenCalled();
    });

    it("throws 404 when provider not found", async () => {
      setupSelectChain([]);

      const req = makeRequest({ params: { id: "999" } });
      await expect(routes["DELETE /custom/:id"](req, makeReply())).rejects.toThrow("Custom provider not found");
    });
  });

  // -----------------------------------------------------------------------
  // POST /custom/:id/test – test connection
  // -----------------------------------------------------------------------
  describe("POST /custom/:id/test", () => {
    const existingRow = {
      id: 20,
      userId: "user-1",
      name: "TestMe",
      baseUrl: "https://testme.com",
      authType: "bearer",
      authKey: "encrypted_k",
      authHeaderName: null,
      capabilities: { streaming: true },
      models: ["model-t"],
    };

    it("returns success with response text and usage on successful generate", async () => {
      setupSelectChain([existingRow]);

      const mockCollected = { text: "hello", usage: { prompt_tokens: 5, completion_tokens: 1 } };
      const mockAdapter = {
        generate: vi.fn().mockResolvedValue({
          collect: vi.fn().mockResolvedValue(mockCollected),
        }),
      };
      mockGetAdapterOrNull.mockReturnValue(mockAdapter);

      const req = makeRequest({ params: { id: "20" } });
      const result = await routes["POST /custom/:id/test"](req, makeReply());

      expect(result.success).toBe(true);
      expect(result.response).toBe("hello");
      expect(result.usage).toEqual(mockCollected.usage);
      expect(mockAdapter.generate).toHaveBeenCalledWith({
        model: "model-t",
        messages: [{ role: "user", content: "Say 'hello' in one word." }],
        max_tokens: 10,
      });
    });

    it("truncates response text to 100 chars", async () => {
      setupSelectChain([existingRow]);

      const longText = "x".repeat(200);
      const mockAdapter = {
        generate: vi.fn().mockResolvedValue({
          collect: vi.fn().mockResolvedValue({ text: longText, usage: {} }),
        }),
      };
      mockGetAdapterOrNull.mockReturnValue(mockAdapter);

      const req = makeRequest({ params: { id: "20" } });
      const result = await routes["POST /custom/:id/test"](req, makeReply());

      expect(result.response).toHaveLength(100);
    });

    it("returns success: false with error message when generate throws", async () => {
      setupSelectChain([existingRow]);

      const mockAdapter = {
        generate: vi.fn().mockRejectedValue(new Error("Connection refused")),
      };
      mockGetAdapterOrNull.mockReturnValue(mockAdapter);

      const req = makeRequest({ params: { id: "20" } });
      const result = await routes["POST /custom/:id/test"](req, makeReply());

      expect(result.success).toBe(false);
      expect(result.error).toBe("Connection refused");
    });

    it("throws 404 when provider not found in DB", async () => {
      setupSelectChain([]);

      const req = makeRequest({ params: { id: "999" } });
      await expect(routes["POST /custom/:id/test"](req, makeReply())).rejects.toThrow(
        "Custom provider not found",
      );
    });

    it("throws 500 when adapter is not registered", async () => {
      setupSelectChain([existingRow]);
      mockGetAdapterOrNull.mockReturnValue(null);

      const req = makeRequest({ params: { id: "20" } });
      await expect(routes["POST /custom/:id/test"](req, makeReply())).rejects.toThrow(
        "Adapter not registered",
      );
    });
  });

  // -----------------------------------------------------------------------
  // GET /:providerId/models – list models
  // -----------------------------------------------------------------------
  describe("GET /:providerId/models", () => {
    it("returns models from the adapter", async () => {
      const mockModels = [
        { id: "gpt-4", name: "GPT-4" },
        { id: "gpt-3.5-turbo", name: "GPT-3.5 Turbo" },
      ];
      mockGetAdapterOrNull.mockReturnValue({
        listModels: vi.fn().mockResolvedValue(mockModels),
      });

      const req = makeRequest({ params: { providerId: "openai" } });
      const result = await routes["GET /:providerId/models"](req, makeReply());

      expect(result.provider).toBe("openai");
      expect(result.models).toEqual(mockModels);
    });

    it("throws 404 when provider not found", async () => {
      mockGetAdapterOrNull.mockReturnValue(null);

      const req = makeRequest({ params: { providerId: "nonexistent" } });
      await expect(routes["GET /:providerId/models"](req, makeReply())).rejects.toThrow(
        'Provider "nonexistent" not found',
      );
    });
  });
});
