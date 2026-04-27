import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock all external dependencies at top level
vi.mock("../../src/middleware/fastifyAuth.js", () => ({
  fastifyRequireAuth: vi.fn(),
  fastifyRequireAdmin: vi.fn(),
}));

vi.mock("../../src/services/pat.service.js", () => ({
  createPat: vi.fn(),
  listPats: vi.fn(),
  revokePat: vi.fn(),
  validateScopes: vi.fn(),
}));

// Helper to capture Fastify route handlers
const registeredRoutes: Record<string, { handler: Function; preHandler?: Function }> = {};
let capturedHooks: Array<{ name: string; fn: Function }> = [];

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
    patch: register("PATCH"),
    addHook: vi.fn((name: string, fn: Function) => {
      capturedHooks.push({ name, fn });
    }),
    addContentTypeParser: vi.fn(),
    register: vi.fn(),
  };
}

// Mock request/reply helpers
function makeReq(overrides = {}): any {
  return { userId: 1, role: "member", body: {}, params: {}, query: {}, headers: {}, ...overrides };
}
function makeReply(): any {
  const r: any = { _code: 200, _body: undefined };
  r.code = vi.fn((c: number) => { r._code = c; return r; });
  r.send = vi.fn((b?: any) => { r._body = b; return r; });
  r.header = vi.fn(() => r);
  return r;
}

describe("pat routes", () => {
  let fastify: any;
  let createPat: any;
  let listPats: any;
  let revokePat: any;
  let validateScopes: any;

  beforeEach(async () => {
    for (const key of Object.keys(registeredRoutes)) {
      delete registeredRoutes[key];
    }
    capturedHooks = [];
    vi.clearAllMocks();

    fastify = createFastifyInstance();

    const svc = await import("../../src/services/pat.service.js");
    createPat = svc.createPat as any;
    listPats = svc.listPats as any;
    revokePat = svc.revokePat as any;
    validateScopes = svc.validateScopes as any;

    listPats.mockResolvedValue([{ id: 1, label: "My Token", lastFourChars: "abcd" }]);
    createPat.mockResolvedValue({ id: 2, token: "pat_abc123", label: "New Token" });
    revokePat.mockResolvedValue(true);
    validateScopes.mockReturnValue({ valid: true, invalid: [] });

    const { default: patPlugin } = await import("../../src/routes/pat.js");
    await patPlugin(fastify, {});
  });

  describe("registration", () => {
    it("registers an onRequest hook for auth", () => {
      const onRequestHook = capturedHooks.find((h) => h.name === "onRequest");
      expect(onRequestHook).toBeDefined();
    });

    it("registers GET / route", () => {
      expect(registeredRoutes["GET /"]).toBeDefined();
    });

    it("registers POST / route", () => {
      expect(registeredRoutes["POST /"]).toBeDefined();
    });

    it("registers DELETE /:id route", () => {
      expect(registeredRoutes["DELETE /:id"]).toBeDefined();
    });
  });

  describe("GET /", () => {
    it("returns list of tokens", async () => {
      const { handler } = registeredRoutes["GET /"];
      const req = makeReq({ userId: 5 });
      const reply = makeReply();
      const result = await handler(req, reply);
      expect(result.tokens).toEqual([{ id: 1, label: "My Token", lastFourChars: "abcd" }]);
    });

    it("calls listPats with userId", async () => {
      const { handler } = registeredRoutes["GET /"];
      const req = makeReq({ userId: 42 });
      const reply = makeReply();
      await handler(req, reply);
      expect(listPats).toHaveBeenCalledWith(42);
    });

    it("returns empty array when user has no tokens", async () => {
      listPats.mockResolvedValue([]);
      const { handler } = registeredRoutes["GET /"];
      const req = makeReq({ userId: 1 });
      const reply = makeReply();
      const result = await handler(req, reply);
      expect(result.tokens).toEqual([]);
    });
  });

  describe("POST /", () => {
    it("creates token with valid label and returns 201", async () => {
      const { handler } = registeredRoutes["POST /"];
      const req = makeReq({ body: { label: "My API Key" } });
      const reply = makeReply();
      const result = await handler(req, reply);
      expect(reply.code).toHaveBeenCalledWith(201);
      expect(result).toEqual({ id: 2, token: "pat_abc123", label: "New Token" });
    });

    it("returns 400 when label is missing", async () => {
      const { handler } = registeredRoutes["POST /"];
      const req = makeReq({ body: {} });
      const reply = makeReply();
      const result = await handler(req, reply);
      expect(reply.code).toHaveBeenCalledWith(400);
      expect(result.error).toMatch(/label/i);
    });

    it("returns 400 when label is empty string", async () => {
      const { handler } = registeredRoutes["POST /"];
      const req = makeReq({ body: { label: "   " } });
      const reply = makeReply();
      const result = await handler(req, reply);
      expect(reply.code).toHaveBeenCalledWith(400);
      expect(result.error).toMatch(/label/i);
    });

    it("returns 400 when label exceeds 100 characters", async () => {
      const { handler } = registeredRoutes["POST /"];
      const longLabel = "a".repeat(101);
      const req = makeReq({ body: { label: longLabel } });
      const reply = makeReply();
      const result = await handler(req, reply);
      expect(reply.code).toHaveBeenCalledWith(400);
      expect(result.error).toMatch(/100/);
    });

    it("accepts label of exactly 100 characters", async () => {
      const { handler } = registeredRoutes["POST /"];
      const exactLabel = "a".repeat(100);
      const req = makeReq({ body: { label: exactLabel } });
      const reply = makeReply();
      await handler(req, reply);
      expect(reply.code).toHaveBeenCalledWith(201);
    });

    it("returns 400 when scopes are invalid", async () => {
      validateScopes.mockReturnValue({ valid: false, invalid: ["bad:scope"] });
      const { handler } = registeredRoutes["POST /"];
      const req = makeReq({ body: { label: "Key", scopes: ["bad:scope"] } });
      const reply = makeReply();
      const result = await handler(req, reply);
      expect(reply.code).toHaveBeenCalledWith(400);
      expect(result.error).toMatch(/bad:scope/);
    });

    it("returns 400 when expiresInDays is 0", async () => {
      const { handler } = registeredRoutes["POST /"];
      const req = makeReq({ body: { label: "Key", expiresInDays: 0 } });
      const reply = makeReply();
      const result = await handler(req, reply);
      expect(reply.code).toHaveBeenCalledWith(400);
      expect(result.error).toMatch(/expiresInDays/i);
    });

    it("returns 400 when expiresInDays exceeds 365", async () => {
      const { handler } = registeredRoutes["POST /"];
      const req = makeReq({ body: { label: "Key", expiresInDays: 366 } });
      const reply = makeReply();
      const result = await handler(req, reply);
      expect(reply.code).toHaveBeenCalledWith(400);
      expect(result.error).toMatch(/expiresInDays/i);
    });

    it("returns 400 when expiresInDays is not an integer", async () => {
      const { handler } = registeredRoutes["POST /"];
      const req = makeReq({ body: { label: "Key", expiresInDays: 1.5 } });
      const reply = makeReply();
      const result = await handler(req, reply);
      expect(reply.code).toHaveBeenCalledWith(400);
      expect(result.error).toMatch(/expiresInDays/i);
    });

    it("returns 400 when tier is invalid", async () => {
      const { handler } = registeredRoutes["POST /"];
      const req = makeReq({ body: { label: "Key", tier: "superuser" } });
      const reply = makeReply();
      const result = await handler(req, reply);
      expect(reply.code).toHaveBeenCalledWith(400);
      expect(result.error).toMatch(/tier/i);
    });

    it("returns 403 when non-admin creates admin-tier key", async () => {
      const { handler } = registeredRoutes["POST /"];
      const req = makeReq({ role: "member", body: { label: "Admin Key", tier: "admin" } });
      const reply = makeReply();
      const result = await handler(req, reply);
      expect(reply.code).toHaveBeenCalledWith(403);
      expect(result.error).toMatch(/admin/i);
    });

    it("creates admin-tier key when user is admin", async () => {
      const { handler } = registeredRoutes["POST /"];
      const req = makeReq({ role: "admin", body: { label: "Admin Key", tier: "admin" } });
      const reply = makeReply();
      await handler(req, reply);
      expect(reply.code).toHaveBeenCalledWith(201);
      expect(createPat).toHaveBeenCalledWith(1, expect.objectContaining({ tier: "admin" }));
    });

    it("creates admin-tier key when user is owner", async () => {
      const { handler } = registeredRoutes["POST /"];
      const req = makeReq({ role: "owner", body: { label: "Owner Admin Key", tier: "admin" } });
      const reply = makeReply();
      await handler(req, reply);
      expect(reply.code).toHaveBeenCalledWith(201);
    });

    it("returns 400 when allowedRoutes is not an array of strings", async () => {
      const { handler } = registeredRoutes["POST /"];
      const req = makeReq({ body: { label: "Key", allowedRoutes: [123, 456] } });
      const reply = makeReply();
      const result = await handler(req, reply);
      expect(reply.code).toHaveBeenCalledWith(400);
      expect(result.error).toMatch(/allowedRoutes/i);
    });

    it("returns 400 when allowedRoutes exceeds 50 entries", async () => {
      const { handler } = registeredRoutes["POST /"];
      const routes = Array.from({ length: 51 }, (_, i) => `/api/route-${i}`);
      const req = makeReq({ body: { label: "Key", allowedRoutes: routes } });
      const reply = makeReply();
      const result = await handler(req, reply);
      expect(reply.code).toHaveBeenCalledWith(400);
      expect(result.error).toMatch(/50/);
    });

    it("trims label whitespace before creating", async () => {
      const { handler } = registeredRoutes["POST /"];
      const req = makeReq({ body: { label: "  My Key  " } });
      const reply = makeReply();
      await handler(req, reply);
      expect(createPat).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ label: "My Key" }),
      );
    });
  });

  describe("DELETE /:id", () => {
    it("revokes a valid token and returns 204", async () => {
      const { handler } = registeredRoutes["DELETE /:id"];
      const req = makeReq({ params: { id: "3" } });
      const reply = makeReply();
      await handler(req, reply);
      expect(reply.code).toHaveBeenCalledWith(204);
      expect(revokePat).toHaveBeenCalledWith(1, 3);
    });

    it("returns 404 when token does not exist", async () => {
      revokePat.mockResolvedValue(false);
      const { handler } = registeredRoutes["DELETE /:id"];
      const req = makeReq({ params: { id: "999" } });
      const reply = makeReply();
      const result = await handler(req, reply);
      expect(reply.code).toHaveBeenCalledWith(404);
      expect(result.error).toMatch(/not found/i);
    });

    it("returns 400 for an invalid (non-integer) ID", async () => {
      const { handler } = registeredRoutes["DELETE /:id"];
      const req = makeReq({ params: { id: "abc" } });
      const reply = makeReply();
      const result = await handler(req, reply);
      expect(reply.code).toHaveBeenCalledWith(400);
      expect(result.error).toMatch(/invalid/i);
    });

    it("returns 400 for ID of 0", async () => {
      const { handler } = registeredRoutes["DELETE /:id"];
      const req = makeReq({ params: { id: "0" } });
      const reply = makeReply();
      const result = await handler(req, reply);
      expect(reply.code).toHaveBeenCalledWith(400);
      expect(result.error).toMatch(/invalid/i);
    });

    it("returns 400 for negative ID", async () => {
      const { handler } = registeredRoutes["DELETE /:id"];
      const req = makeReq({ params: { id: "-5" } });
      const reply = makeReply();
      const result = await handler(req, reply);
      expect(reply.code).toHaveBeenCalledWith(400);
      expect(result.error).toMatch(/invalid/i);
    });
  });
});
