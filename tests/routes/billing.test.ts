import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock all external dependencies at top level
vi.mock("../../src/middleware/fastifyAuth.js", () => ({
  fastifyRequireAuth: vi.fn(),
  fastifyRequireAdmin: vi.fn(),
}));

vi.mock("../../src/services/billing.service.js", () => ({
  getPlans: vi.fn(),
  getSubscription: vi.fn(),
  createCheckoutSession: vi.fn(),
  cancelSubscription: vi.fn(),
  handleStripeWebhook: vi.fn(),
  getUsageSummary: vi.fn(),
}));

// Helper to capture Fastify route handlers
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
    patch: register("PATCH"),
    addHook: vi.fn(),
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

describe("billing routes", () => {
  let fastify: any;
  let getPlans: any;
  let getSubscription: any;
  let createCheckoutSession: any;
  let cancelSubscription: any;
  let handleStripeWebhook: any;
  let getUsageSummary: any;

  beforeEach(async () => {
    for (const key of Object.keys(registeredRoutes)) {
      delete registeredRoutes[key];
    }
    vi.clearAllMocks();

    fastify = createFastifyInstance();

    const svc = await import("../../src/services/billing.service.js");
    getPlans = svc.getPlans as any;
    getSubscription = svc.getSubscription as any;
    createCheckoutSession = svc.createCheckoutSession as any;
    cancelSubscription = svc.cancelSubscription as any;
    handleStripeWebhook = svc.handleStripeWebhook as any;
    getUsageSummary = svc.getUsageSummary as any;

    getPlans.mockResolvedValue([{ id: "pro", name: "Pro" }]);
    getSubscription.mockResolvedValue({ id: "sub_123", status: "active" });
    createCheckoutSession.mockResolvedValue({ url: "https://checkout.stripe.com/pay/abc", disabled: false });
    cancelSubscription.mockResolvedValue(true);
    handleStripeWebhook.mockResolvedValue(undefined);
    getUsageSummary.mockResolvedValue({ queries: 100, tokens: 50000 });

    const { default: billingPlugin } = await import("../../src/routes/billing.js");
    await billingPlugin(fastify, {});
  });

  describe("GET /plans", () => {
    it("registers the GET /plans route", () => {
      expect(registeredRoutes["GET /plans"]).toBeDefined();
    });

    it("returns list of plans", async () => {
      const { handler } = registeredRoutes["GET /plans"];
      const req = makeReq();
      const reply = makeReply();
      const result = await handler(req, reply);
      expect(result.plans).toEqual([{ id: "pro", name: "Pro" }]);
    });

    it("does not require auth (no preHandler)", () => {
      const route = registeredRoutes["GET /plans"];
      expect(route.preHandler).toBeUndefined();
    });

    it("calls getPlans service", async () => {
      const { handler } = registeredRoutes["GET /plans"];
      const req = makeReq();
      const reply = makeReply();
      await handler(req, reply);
      expect(getPlans).toHaveBeenCalledTimes(1);
    });
  });

  describe("GET /subscription/:tenantId", () => {
    it("registers the GET /subscription/:tenantId route", () => {
      expect(registeredRoutes["GET /subscription/:tenantId"]).toBeDefined();
    });

    it("returns subscription when found", async () => {
      const { handler } = registeredRoutes["GET /subscription/:tenantId"];
      const req = makeReq({ params: { tenantId: "tenant-1" } });
      const reply = makeReply();
      const result = await handler(req, reply);
      expect(result).toEqual({ id: "sub_123", status: "active" });
    });

    it("returns 404 when no subscription found", async () => {
      getSubscription.mockResolvedValue(null);
      const { handler } = registeredRoutes["GET /subscription/:tenantId"];
      const req = makeReq({ params: { tenantId: "tenant-999" } });
      const reply = makeReply();
      const result = await handler(req, reply);
      expect(reply.code).toHaveBeenCalledWith(404);
      expect(result.error).toMatch(/No subscription/i);
    });

    it("passes tenantId to getSubscription", async () => {
      const { handler } = registeredRoutes["GET /subscription/:tenantId"];
      const req = makeReq({ params: { tenantId: "my-tenant" } });
      const reply = makeReply();
      await handler(req, reply);
      expect(getSubscription).toHaveBeenCalledWith("my-tenant");
    });
  });

  describe("POST /checkout", () => {
    it("registers the POST /checkout route", () => {
      expect(registeredRoutes["POST /checkout"]).toBeDefined();
    });

    it("returns checkout URL on success", async () => {
      const { handler } = registeredRoutes["POST /checkout"];
      const req = makeReq({ body: { tenantId: "t1", planId: "pro" } });
      const reply = makeReply();
      const result = await handler(req, reply);
      expect(result.url).toBe("https://checkout.stripe.com/pay/abc");
    });

    it("returns 400 when tenantId is missing", async () => {
      const { handler } = registeredRoutes["POST /checkout"];
      const req = makeReq({ body: { planId: "pro" } });
      const reply = makeReply();
      const result = await handler(req, reply);
      expect(reply.code).toHaveBeenCalledWith(400);
      expect(result.error).toMatch(/tenantId/i);
    });

    it("returns 400 when planId is missing", async () => {
      const { handler } = registeredRoutes["POST /checkout"];
      const req = makeReq({ body: { tenantId: "t1" } });
      const reply = makeReply();
      const result = await handler(req, reply);
      expect(reply.code).toHaveBeenCalledWith(400);
      expect(result.error).toMatch(/planId/i);
    });

    it("returns 503 when billing is disabled", async () => {
      createCheckoutSession.mockResolvedValue({ disabled: true, url: null });
      const { handler } = registeredRoutes["POST /checkout"];
      const req = makeReq({ body: { tenantId: "t1", planId: "pro" } });
      const reply = makeReply();
      const result = await handler(req, reply);
      expect(reply.code).toHaveBeenCalledWith(503);
      expect(result.error).toMatch(/not configured/i);
    });

    it("defaults interval to 'monthly' when not specified", async () => {
      const { handler } = registeredRoutes["POST /checkout"];
      const req = makeReq({ body: { tenantId: "t1", planId: "pro" } });
      const reply = makeReply();
      await handler(req, reply);
      expect(createCheckoutSession).toHaveBeenCalledWith("t1", "pro", "monthly");
    });

    it("passes 'annual' interval when specified", async () => {
      const { handler } = registeredRoutes["POST /checkout"];
      const req = makeReq({ body: { tenantId: "t1", planId: "pro", interval: "annual" } });
      const reply = makeReply();
      await handler(req, reply);
      expect(createCheckoutSession).toHaveBeenCalledWith("t1", "pro", "annual");
    });
  });

  describe("POST /cancel/:tenantId", () => {
    it("registers the POST /cancel/:tenantId route", () => {
      expect(registeredRoutes["POST /cancel/:tenantId"]).toBeDefined();
    });

    it("returns ok: true when cancellation succeeds", async () => {
      const { handler } = registeredRoutes["POST /cancel/:tenantId"];
      const req = makeReq({ params: { tenantId: "t1" } });
      const reply = makeReply();
      const result = await handler(req, reply);
      expect(result.ok).toBe(true);
    });

    it("returns 404 when no subscription to cancel", async () => {
      cancelSubscription.mockResolvedValue(false);
      const { handler } = registeredRoutes["POST /cancel/:tenantId"];
      const req = makeReq({ params: { tenantId: "t1" } });
      const reply = makeReply();
      const result = await handler(req, reply);
      expect(reply.code).toHaveBeenCalledWith(404);
      expect(result.error).toMatch(/No subscription/i);
    });

    it("passes tenantId to cancelSubscription", async () => {
      const { handler } = registeredRoutes["POST /cancel/:tenantId"];
      const req = makeReq({ params: { tenantId: "tenant-abc" } });
      const reply = makeReply();
      await handler(req, reply);
      expect(cancelSubscription).toHaveBeenCalledWith("tenant-abc");
    });
  });

  describe("POST /webhook", () => {
    it("registers the POST /webhook route", () => {
      expect(registeredRoutes["POST /webhook"]).toBeDefined();
    });

    it("returns 400 when stripe-signature header is missing", async () => {
      const { handler } = registeredRoutes["POST /webhook"];
      const req = makeReq({ headers: {} });
      const reply = makeReply();
      const result = await handler(req, reply);
      expect(reply.code).toHaveBeenCalledWith(400);
      expect(result.error).toMatch(/stripe-signature/i);
    });

    it("returns received: true on valid webhook", async () => {
      const { handler } = registeredRoutes["POST /webhook"];
      const req = makeReq({
        headers: { "stripe-signature": "test-sig" },
        body: { type: "invoice.paid" },
      });
      const reply = makeReply();
      const result = await handler(req, reply);
      expect(result.received).toBe(true);
    });

    it("returns 400 when handleStripeWebhook throws", async () => {
      handleStripeWebhook.mockRejectedValue(new Error("Invalid webhook signature"));
      const { handler } = registeredRoutes["POST /webhook"];
      const req = makeReq({
        headers: { "stripe-signature": "bad-sig" },
        body: {},
      });
      const reply = makeReply();
      const result = await handler(req, reply);
      expect(reply.code).toHaveBeenCalledWith(400);
      expect(result.error).toBe("Invalid webhook signature");
    });
  });

  describe("GET /usage/:tenantId", () => {
    it("registers the GET /usage/:tenantId route", () => {
      expect(registeredRoutes["GET /usage/:tenantId"]).toBeDefined();
    });

    it("returns usage summary", async () => {
      const { handler } = registeredRoutes["GET /usage/:tenantId"];
      const req = makeReq({ params: { tenantId: "t1" } });
      const reply = makeReply();
      const result = await handler(req, reply);
      expect(result).toEqual({ queries: 100, tokens: 50000 });
    });

    it("passes tenantId to getUsageSummary", async () => {
      const { handler } = registeredRoutes["GET /usage/:tenantId"];
      const req = makeReq({ params: { tenantId: "my-org" } });
      const reply = makeReply();
      await handler(req, reply);
      expect(getUsageSummary).toHaveBeenCalledWith("my-org");
    });
  });
});
