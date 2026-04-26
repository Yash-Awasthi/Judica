import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";

// ─── Hoisted mocks (must be declared via vi.hoisted to avoid TDZ issues) ────

const { mockService } = vi.hoisted(() => {
  return {
    mockService: {
      createWidget: vi.fn(),
      getWidgets: vi.fn(),
      updateWidget: vi.fn(),
      deleteWidget: vi.fn(),
      getWidgetByApiKey: vi.fn(),
      generateSurfaceToken: vi.fn(),
      revokeSurfaceToken: vi.fn(),
      getSurfaceTokens: vi.fn(),
      getSurfaceUsageStats: vi.fn(),
      VALID_SURFACES: ["chrome_extension", "slack_bot", "discord_bot", "widget", "desktop", "mobile"],
      VALID_THEMES: ["light", "dark", "auto"],
      VALID_POSITIONS: ["bottom-right", "bottom-left"],
    },
  };
});

vi.mock("../../src/services/surfaceAccess.service.js", () => mockService);

vi.mock("../../src/middleware/fastifyAuth.js", () => ({
  fastifyRequireAuth: vi.fn((_req: any, _reply: any, done: any) => done?.()),
}));

vi.mock("../../src/lib/logger.js", () => ({
  default: {
    child: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    })),
  },
}));

import surfaceAccessPlugin from "../../src/routes/surface-access.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const registeredRoutes: Record<string, { handler: Function; opts?: any }> = {};

function createFastifyInstance(): any {
  const register = (method: string) =>
    vi.fn((path: string, optsOrHandler: any, handler?: Function) => {
      const h = handler ?? optsOrHandler;
      registeredRoutes[`${method.toUpperCase()} ${path}`] = { handler: h, opts: handler ? optsOrHandler : undefined };
    });

  return {
    addHook: vi.fn(),
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
    role: "member",
    headers: {},
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
    header: vi.fn(function (this: any) {
      return this;
    }),
  };
  return reply;
}

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeAll(async () => {
  const fastify = createFastifyInstance();
  await surfaceAccessPlugin(fastify, {});
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("surface-access routes", () => {
  describe("POST /widgets", () => {
    it("creates a widget with valid input", async () => {
      const fakeWidget = { id: "w1", name: "Test Widget" };
      mockService.createWidget.mockResolvedValue(fakeWidget);

      const req = createRequest({ body: { name: "Test Widget" } });
      const reply = createReply();

      const result = await registeredRoutes["POST /widgets"].handler(req, reply);
      expect(reply.code).toHaveBeenCalledWith(201);
      expect(result).toEqual({ widget: fakeWidget });
    });

    it("rejects missing name", async () => {
      const req = createRequest({ body: {} });
      const reply = createReply();

      const result = await registeredRoutes["POST /widgets"].handler(req, reply);
      expect(reply.code).toHaveBeenCalledWith(400);
      expect(result).toEqual({ error: "name is required" });
    });

    it("rejects invalid theme", async () => {
      const req = createRequest({ body: { name: "Widget", theme: "neon" } });
      const reply = createReply();

      const result = await registeredRoutes["POST /widgets"].handler(req, reply);
      expect(reply.code).toHaveBeenCalledWith(400);
      expect(result.error).toContain("Invalid theme");
    });
  });

  describe("GET /widgets", () => {
    it("lists user widgets", async () => {
      const widgets = [{ id: "w1" }, { id: "w2" }];
      mockService.getWidgets.mockResolvedValue(widgets);

      const req = createRequest();
      const result = await registeredRoutes["GET /widgets"].handler(req);
      expect(result).toEqual({ widgets });
    });
  });

  describe("PUT /widgets/:id", () => {
    it("updates a widget", async () => {
      const updated = { id: "w1", name: "Updated" };
      mockService.updateWidget.mockResolvedValue(updated);

      const req = createRequest({ params: { id: "w1" }, body: { name: "Updated" } });
      const reply = createReply();

      const result = await registeredRoutes["PUT /widgets/:id"].handler(req, reply);
      expect(result).toEqual({ widget: updated });
    });

    it("returns 404 for missing widget", async () => {
      mockService.updateWidget.mockResolvedValue(null);

      const req = createRequest({ params: { id: "bad" }, body: { name: "X" } });
      const reply = createReply();

      const result = await registeredRoutes["PUT /widgets/:id"].handler(req, reply);
      expect(reply.code).toHaveBeenCalledWith(404);
      expect(result).toEqual({ error: "Widget not found" });
    });
  });

  describe("DELETE /widgets/:id", () => {
    it("deletes a widget", async () => {
      mockService.deleteWidget.mockResolvedValue(true);

      const req = createRequest({ params: { id: "w1" } });
      const reply = createReply();

      await registeredRoutes["DELETE /widgets/:id"].handler(req, reply);
      expect(reply.code).toHaveBeenCalledWith(204);
    });

    it("returns 404 when widget not found", async () => {
      mockService.deleteWidget.mockResolvedValue(false);

      const req = createRequest({ params: { id: "bad" } });
      const reply = createReply();

      const result = await registeredRoutes["DELETE /widgets/:id"].handler(req, reply);
      expect(reply.code).toHaveBeenCalledWith(404);
      expect(result).toEqual({ error: "Widget not found" });
    });
  });

  describe("POST /tokens", () => {
    it("generates a surface token", async () => {
      const fakeToken = { id: "tok-1", token: "srf_abc", surface: "chrome_extension" };
      mockService.generateSurfaceToken.mockResolvedValue(fakeToken);

      const req = createRequest({
        body: { surface: "chrome_extension", label: "My Chrome" },
      });
      const reply = createReply();

      const result = await registeredRoutes["POST /tokens"].handler(req, reply);
      expect(reply.code).toHaveBeenCalledWith(201);
      expect(result).toEqual(fakeToken);
    });

    it("rejects missing label", async () => {
      const req = createRequest({ body: { surface: "chrome_extension" } });
      const reply = createReply();

      const result = await registeredRoutes["POST /tokens"].handler(req, reply);
      expect(reply.code).toHaveBeenCalledWith(400);
      expect(result).toEqual({ error: "label is required" });
    });

    it("rejects invalid surface", async () => {
      const req = createRequest({
        body: { surface: "telepathy", label: "Test" },
      });
      const reply = createReply();

      const result = await registeredRoutes["POST /tokens"].handler(req, reply);
      expect(reply.code).toHaveBeenCalledWith(400);
      expect(result.error).toContain("Invalid surface");
    });

    it("rejects invalid expiresInDays", async () => {
      const req = createRequest({
        body: { surface: "chrome_extension", label: "Test", expiresInDays: 500 },
      });
      const reply = createReply();

      const result = await registeredRoutes["POST /tokens"].handler(req, reply);
      expect(reply.code).toHaveBeenCalledWith(400);
      expect(result.error).toContain("expiresInDays");
    });
  });

  describe("GET /tokens", () => {
    it("lists user tokens", async () => {
      const tokens = [{ id: "tok-1", surface: "chrome_extension" }];
      mockService.getSurfaceTokens.mockResolvedValue(tokens);

      const req = createRequest();
      const result = await registeredRoutes["GET /tokens"].handler(req);
      expect(result).toEqual({ tokens });
    });
  });

  describe("DELETE /tokens/:id", () => {
    it("revokes a token", async () => {
      mockService.revokeSurfaceToken.mockResolvedValue(true);

      const req = createRequest({ params: { id: "tok-1" } });
      const reply = createReply();

      await registeredRoutes["DELETE /tokens/:id"].handler(req, reply);
      expect(reply.code).toHaveBeenCalledWith(204);
    });

    it("returns 404 when token not found", async () => {
      mockService.revokeSurfaceToken.mockResolvedValue(false);

      const req = createRequest({ params: { id: "bad" } });
      const reply = createReply();

      const result = await registeredRoutes["DELETE /tokens/:id"].handler(req, reply);
      expect(reply.code).toHaveBeenCalledWith(404);
    });
  });

  describe("GET /stats", () => {
    it("returns usage stats", async () => {
      const stats = { tokensBySurface: { chrome_extension: 2 }, widgets: { total: 1, active: 1 } };
      mockService.getSurfaceUsageStats.mockResolvedValue(stats);

      const req = createRequest();
      const result = await registeredRoutes["GET /stats"].handler(req);
      expect(result).toEqual(stats);
    });
  });

  describe("POST /widget-ask", () => {
    it("returns response for valid widget request", async () => {
      const widget = {
        id: "w1",
        userId: 1,
        allowedOrigins: ["https://example.com"],
        isActive: true,
      };
      mockService.getWidgetByApiKey.mockResolvedValue(widget);

      const req = createRequest({
        body: { apiKey: "wgt_test", message: "Hello" },
        headers: { origin: "https://example.com" },
      });
      const reply = createReply();

      const result = await registeredRoutes["POST /widget-ask"].handler(req, reply);
      expect(result.widgetId).toBe("w1");
      expect(result.message).toBe("Hello");
    });

    it("rejects missing apiKey", async () => {
      const req = createRequest({ body: { message: "Hello" } });
      const reply = createReply();

      const result = await registeredRoutes["POST /widget-ask"].handler(req, reply);
      expect(reply.code).toHaveBeenCalledWith(401);
    });

    it("rejects invalid apiKey", async () => {
      mockService.getWidgetByApiKey.mockResolvedValue(null);

      const req = createRequest({ body: { apiKey: "wgt_bad", message: "Hello" } });
      const reply = createReply();

      const result = await registeredRoutes["POST /widget-ask"].handler(req, reply);
      expect(reply.code).toHaveBeenCalledWith(401);
    });

    it("rejects disallowed origin", async () => {
      const widget = {
        id: "w1",
        userId: 1,
        allowedOrigins: ["https://allowed.com"],
        isActive: true,
      };
      mockService.getWidgetByApiKey.mockResolvedValue(widget);

      const req = createRequest({
        body: { apiKey: "wgt_test", message: "Hello" },
        headers: { origin: "https://evil.com" },
      });
      const reply = createReply();

      const result = await registeredRoutes["POST /widget-ask"].handler(req, reply);
      expect(reply.code).toHaveBeenCalledWith(403);
      expect(result.error).toContain("Origin not allowed");
    });
  });
});
