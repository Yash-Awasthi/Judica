import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("../../src/middleware/fastifyAuth.js", () => ({
  fastifyRequireAuth: vi.fn(),
  fastifyRequireAdmin: vi.fn(),
}));

vi.mock("../../src/db/schema/hookExtensions.js", () => ({
  HOOK_POINTS: [
    "pre_indexing", "post_indexing", "pre_query", "post_query",
    "pre_response", "post_response", "pre_council", "post_council",
  ],
}));

const mockService = {
  createHook: vi.fn(),
  getHooks: vi.fn(),
  updateHook: vi.fn(),
  deleteHook: vi.fn(),
  toggleHook: vi.fn(),
  executeHook: vi.fn(),
  getHookLogs: vi.fn(),
  getBuiltInHooks: vi.fn(),
  validateHookCode: vi.fn(),
  reorderHooks: vi.fn(),
};

vi.mock("../../src/services/hookExtensions.service.js", () => mockService);

vi.mock("../../src/lib/logger.js", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    })),
  },
}));

// ─── Helpers ────────────────────────────────────────────────────────────────

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
    patch: register("PATCH"),
    delete: register("DELETE"),
  };
}

function createRequest(overrides: any = {}) {
  return {
    params: {},
    body: {},
    query: {},
    userId: 42,
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
    send: vi.fn(function (this: any) {
      return this;
    }),
  };
  return reply;
}

// ─── Setup ──────────────────────────────────────────────────────────────────

let plugin: any;

beforeEach(async () => {
  vi.clearAllMocks();
  for (const key of Object.keys(registeredRoutes)) {
    delete registeredRoutes[key];
  }

  const mod = await import("../../src/routes/hook-extensions.js");
  plugin = mod.hookExtensionsPlugin;
  const fastify = createFastifyInstance();
  await plugin(fastify);
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("hook-extensions routes", () => {
  describe("POST /", () => {
    it("should create a hook and return 201", async () => {
      const mockHook = { id: 1, name: "My Hook", hookPoint: "pre_indexing" };
      mockService.createHook.mockResolvedValue(mockHook);
      mockService.validateHookCode.mockReturnValue({ valid: true, errors: [] });

      const request = createRequest({
        body: {
          name: "My Hook",
          hookPoint: "pre_indexing",
          code: 'function handler(ctx) { return { content: ctx.content, metadata: {} }; }',
        },
      });
      const reply = createReply();

      const result = await registeredRoutes["POST /"].handler(request, reply);
      expect(reply.code).toHaveBeenCalledWith(201);
      expect(mockService.createHook).toHaveBeenCalledWith(42, expect.objectContaining({
        name: "My Hook",
        hookPoint: "pre_indexing",
      }));
      expect(result).toEqual(mockHook);
    });

    it("should return 400 when name is missing", async () => {
      const request = createRequest({ body: { hookPoint: "pre_indexing", code: "..." } });
      const reply = createReply();

      const result = await registeredRoutes["POST /"].handler(request, reply);
      expect(reply.code).toHaveBeenCalledWith(400);
      expect(result).toEqual({ error: "name is required" });
    });

    it("should return 400 when hookPoint is invalid", async () => {
      const request = createRequest({ body: { name: "Test", hookPoint: "invalid", code: "..." } });
      const reply = createReply();

      const result = await registeredRoutes["POST /"].handler(request, reply);
      expect(reply.code).toHaveBeenCalledWith(400);
      expect(result.error).toContain("hookPoint must be one of");
    });

    it("should return 400 when code is missing", async () => {
      const request = createRequest({ body: { name: "Test", hookPoint: "pre_indexing" } });
      const reply = createReply();

      const result = await registeredRoutes["POST /"].handler(request, reply);
      expect(reply.code).toHaveBeenCalledWith(400);
      expect(result).toEqual({ error: "code is required" });
    });

    it("should return 400 when code validation fails", async () => {
      mockService.validateHookCode.mockReturnValue({ valid: false, errors: ["Missing handler"] });

      const request = createRequest({
        body: { name: "Test", hookPoint: "pre_indexing", code: "bad code" },
      });
      const reply = createReply();

      const result = await registeredRoutes["POST /"].handler(request, reply);
      expect(reply.code).toHaveBeenCalledWith(400);
      expect(result.error).toBe("Invalid hook code");
      expect(result.details).toEqual(["Missing handler"]);
    });
  });

  describe("GET /", () => {
    it("should return hooks for the user", async () => {
      const hooks = [{ id: 1, name: "Hook 1" }];
      mockService.getHooks.mockResolvedValue(hooks);

      const request = createRequest({ query: {} });
      const result = await registeredRoutes["GET /"].handler(request);
      expect(mockService.getHooks).toHaveBeenCalledWith(42, undefined);
      expect(result).toEqual({ hooks });
    });

    it("should filter by hookPoint when provided", async () => {
      mockService.getHooks.mockResolvedValue([]);

      const request = createRequest({ query: { hookPoint: "pre_query" } });
      await registeredRoutes["GET /"].handler(request);
      expect(mockService.getHooks).toHaveBeenCalledWith(42, "pre_query");
    });
  });

  describe("GET /built-in", () => {
    it("should return built-in templates", async () => {
      const templates = [{ type: "PII_SCRUBBER", name: "PII Scrubber" }];
      mockService.getBuiltInHooks.mockReturnValue(templates);

      const result = await registeredRoutes["GET /built-in"].handler();
      expect(result).toEqual({ templates });
    });
  });

  describe("PUT /:id", () => {
    it("should update a hook", async () => {
      const updated = { id: 1, name: "Updated" };
      mockService.updateHook.mockResolvedValue(updated);

      const request = createRequest({ params: { id: "1" }, body: { name: "Updated" } });
      const reply = createReply();

      const result = await registeredRoutes["PUT /:id"].handler(request, reply);
      expect(mockService.updateHook).toHaveBeenCalledWith(1, 42, expect.objectContaining({ name: "Updated" }));
      expect(result).toEqual(updated);
    });

    it("should return 404 when hook not found", async () => {
      mockService.updateHook.mockResolvedValue(null);

      const request = createRequest({ params: { id: "999" }, body: { name: "Nope" } });
      const reply = createReply();

      const result = await registeredRoutes["PUT /:id"].handler(request, reply);
      expect(reply.code).toHaveBeenCalledWith(404);
      expect(result).toEqual({ error: "Hook not found" });
    });
  });

  describe("DELETE /:id", () => {
    it("should delete a hook and return 204", async () => {
      mockService.deleteHook.mockResolvedValue(true);

      const request = createRequest({ params: { id: "1" } });
      const reply = createReply();

      await registeredRoutes["DELETE /:id"].handler(request, reply);
      expect(reply.code).toHaveBeenCalledWith(204);
      expect(mockService.deleteHook).toHaveBeenCalledWith(1, 42);
    });

    it("should return 404 when hook not found", async () => {
      mockService.deleteHook.mockResolvedValue(false);

      const request = createRequest({ params: { id: "999" } });
      const reply = createReply();

      const result = await registeredRoutes["DELETE /:id"].handler(request, reply);
      expect(reply.code).toHaveBeenCalledWith(404);
      expect(result).toEqual({ error: "Hook not found" });
    });
  });

  describe("PATCH /:id/toggle", () => {
    it("should toggle hook active state", async () => {
      const toggled = { id: 1, isActive: false };
      mockService.toggleHook.mockResolvedValue(toggled);

      const request = createRequest({ params: { id: "1" }, body: { isActive: false } });
      const reply = createReply();

      const result = await registeredRoutes["PATCH /:id/toggle"].handler(request, reply);
      expect(mockService.toggleHook).toHaveBeenCalledWith(1, 42, false);
      expect(result).toEqual(toggled);
    });

    it("should return 400 when isActive is missing", async () => {
      const request = createRequest({ params: { id: "1" }, body: {} });
      const reply = createReply();

      const result = await registeredRoutes["PATCH /:id/toggle"].handler(request, reply);
      expect(reply.code).toHaveBeenCalledWith(400);
      expect(result).toEqual({ error: "isActive is required" });
    });
  });

  describe("POST /:id/test", () => {
    it("should test a hook and return result", async () => {
      mockService.executeHook.mockResolvedValue({
        content: "processed",
        metadata: { done: true },
      });

      const request = createRequest({ params: { id: "1" }, body: { content: "hello" } });
      const reply = createReply();

      const result = await registeredRoutes["POST /:id/test"].handler(request, reply);
      expect(result.ok).toBe(true);
      expect(result.result.content).toBe("processed");
    });

    it("should return 400 when content is missing", async () => {
      const request = createRequest({ params: { id: "1" }, body: {} });
      const reply = createReply();

      const result = await registeredRoutes["POST /:id/test"].handler(request, reply);
      expect(reply.code).toHaveBeenCalledWith(400);
      expect(result).toEqual({ error: "content is required for testing" });
    });

    it("should return 422 when hook execution fails", async () => {
      mockService.executeHook.mockRejectedValue(new Error("boom"));

      const request = createRequest({ params: { id: "1" }, body: { content: "hello" } });
      const reply = createReply();

      const result = await registeredRoutes["POST /:id/test"].handler(request, reply);
      expect(reply.code).toHaveBeenCalledWith(422);
      expect(result.ok).toBe(false);
      expect(result.error).toBe("boom");
    });
  });

  describe("GET /:id/logs", () => {
    it("should return execution logs", async () => {
      mockService.getHookLogs.mockResolvedValue({ logs: [{ id: 1 }], total: 1 });

      const request = createRequest({ params: { id: "1" }, query: { limit: "10", offset: "0" } });
      const result = await registeredRoutes["GET /:id/logs"].handler(request);
      expect(mockService.getHookLogs).toHaveBeenCalledWith(1, { limit: 10, offset: 0 });
      expect(result).toEqual({ logs: [{ id: 1 }], total: 1 });
    });
  });

  describe("PUT /reorder", () => {
    it("should reorder hooks", async () => {
      const reordered = [{ id: 3 }, { id: 1 }, { id: 2 }];
      mockService.reorderHooks.mockResolvedValue(reordered);

      const request = createRequest({
        body: { hookPoint: "pre_indexing", orderedIds: [3, 1, 2] },
      });
      const reply = createReply();

      const result = await registeredRoutes["PUT /reorder"].handler(request, reply);
      expect(mockService.reorderHooks).toHaveBeenCalledWith(42, "pre_indexing", [3, 1, 2]);
      expect(result).toEqual({ hooks: reordered });
    });

    it("should return 400 for invalid hookPoint", async () => {
      const request = createRequest({
        body: { hookPoint: "bad_point", orderedIds: [1, 2] },
      });
      const reply = createReply();

      const result = await registeredRoutes["PUT /reorder"].handler(request, reply);
      expect(reply.code).toHaveBeenCalledWith(400);
      expect(result.error).toContain("hookPoint must be one of");
    });

    it("should return 400 for missing orderedIds", async () => {
      const request = createRequest({
        body: { hookPoint: "pre_indexing" },
      });
      const reply = createReply();

      const result = await registeredRoutes["PUT /reorder"].handler(request, reply);
      expect(reply.code).toHaveBeenCalledWith(400);
      expect(result.error).toContain("orderedIds");
    });
  });

  describe("POST /validate", () => {
    it("should validate hook code", async () => {
      mockService.validateHookCode.mockReturnValue({ valid: true, errors: [] });

      const request = createRequest({ body: { code: "function handler() {}", language: "javascript" } });
      const reply = createReply();

      const result = await registeredRoutes["POST /validate"].handler(request, reply);
      expect(result).toEqual({ valid: true, errors: [] });
    });

    it("should return 400 when code is missing", async () => {
      const request = createRequest({ body: {} });
      const reply = createReply();

      const result = await registeredRoutes["POST /validate"].handler(request, reply);
      expect(reply.code).toHaveBeenCalledWith(400);
      expect(result).toEqual({ error: "code is required" });
    });
  });
});
