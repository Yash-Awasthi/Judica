import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/middleware/fastifyAuth.js", () => ({
  fastifyRequireAuth: vi.fn(),
  fastifyRequireAdmin: vi.fn(),
}));

vi.mock("../../src/services/whitelabel.service.js", () => ({
  getBranding: vi.fn(),
  upsertBranding: vi.fn(),
  deleteBranding: vi.fn(),
  resolveBrandingForDomain: vi.fn(),
}));

import {
  getBranding,
  upsertBranding,
  deleteBranding,
  resolveBrandingForDomain,
} from "../../src/services/whitelabel.service.js";

const registeredRoutes: Record<string, { handler: Function }> = {};

function createFastifyInstance(): any {
  const register = (method: string) =>
    vi.fn((path: string, opts: any, handler?: Function) => {
      registeredRoutes[`${method.toUpperCase()} ${path}`] = {
        handler: handler ?? opts,
      };
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

function makeReq(overrides = {}): any {
  return {
    userId: 1,
    role: "admin",
    body: {},
    params: {},
    query: {},
    headers: {},
    ...overrides,
  };
}

function makeReply(): any {
  const r: any = {};
  r.code = vi.fn(() => r);
  r.send = vi.fn(() => r);
  r.header = vi.fn(() => r);
  r.status = vi.fn(() => r);
  return r;
}

let fastify: any;

beforeEach(async () => {
  vi.clearAllMocks();
  Object.keys(registeredRoutes).forEach((k) => delete registeredRoutes[k]);
  fastify = createFastifyInstance();
  const { default: whitelabelPlugin } = await import("../../src/routes/whitelabel.js");
  await whitelabelPlugin(fastify, {});
});

describe("GET /domain/:domain", () => {
  it("resolves branding for a valid custom domain", async () => {
    const mockBranding = {
      tenantId: "acme",
      logoUrl: "https://acme.com/logo.png",
      primaryColor: "#ff0000",
      appName: "Acme AI",
    };
    vi.mocked(resolveBrandingForDomain).mockResolvedValue(mockBranding as any);

    const handler = registeredRoutes["GET /domain/:domain"]?.handler;
    expect(handler).toBeDefined();

    const req = makeReq({ params: { domain: "chat.acme.com" } });
    const reply = makeReply();
    const result = await handler(req, reply);

    expect(resolveBrandingForDomain).toHaveBeenCalledWith("chat.acme.com");
    expect(result).toEqual(mockBranding);
  });

  it("returns 404 when domain has no branding configured", async () => {
    vi.mocked(resolveBrandingForDomain).mockResolvedValue(null as any);

    const handler = registeredRoutes["GET /domain/:domain"]?.handler;
    const req = makeReq({ params: { domain: "unknown.example.com" } });
    const reply = makeReply();
    const result = await handler(req, reply);

    expect(reply.code).toHaveBeenCalledWith(404);
    expect(result).toMatchObject({ error: expect.any(String) });
  });

  it("passes the domain param to the service", async () => {
    vi.mocked(resolveBrandingForDomain).mockResolvedValue({ tenantId: "t1" } as any);

    const handler = registeredRoutes["GET /domain/:domain"]?.handler;
    await handler(makeReq({ params: { domain: "app.contoso.io" } }), makeReply());

    expect(resolveBrandingForDomain).toHaveBeenCalledWith("app.contoso.io");
  });
});

describe("GET /:tenantId", () => {
  it("returns branding for a known tenant", async () => {
    const mockBranding = {
      tenantId: "acme",
      logoUrl: "https://acme.com/logo.png",
      primaryColor: "#0000ff",
      appName: "Acme Chat",
    };
    vi.mocked(getBranding).mockResolvedValue(mockBranding as any);

    const handler = registeredRoutes["GET /:tenantId"]?.handler;
    expect(handler).toBeDefined();

    const req = makeReq({ params: { tenantId: "acme" } });
    const reply = makeReply();
    const result = await handler(req, reply);

    expect(getBranding).toHaveBeenCalledWith("acme");
    expect(result).toEqual(mockBranding);
  });

  it("returns 404 when tenant has no branding", async () => {
    vi.mocked(getBranding).mockResolvedValue(null as any);

    const handler = registeredRoutes["GET /:tenantId"]?.handler;
    const req = makeReq({ params: { tenantId: "unknown-tenant" } });
    const reply = makeReply();
    const result = await handler(req, reply);

    expect(reply.code).toHaveBeenCalledWith(404);
    expect(result).toMatchObject({ error: expect.any(String) });
  });

  it("passes tenantId correctly to getBranding service", async () => {
    vi.mocked(getBranding).mockResolvedValue({ tenantId: "beta-corp" } as any);

    const handler = registeredRoutes["GET /:tenantId"]?.handler;
    await handler(makeReq({ params: { tenantId: "beta-corp" } }), makeReply());

    expect(getBranding).toHaveBeenCalledWith("beta-corp");
  });

  it("does not call 404 when branding is found", async () => {
    vi.mocked(getBranding).mockResolvedValue({ tenantId: "found" } as any);

    const handler = registeredRoutes["GET /:tenantId"]?.handler;
    const reply = makeReply();
    await handler(makeReq({ params: { tenantId: "found" } }), reply);

    expect(reply.code).not.toHaveBeenCalledWith(404);
  });
});

describe("PUT /:tenantId", () => {
  it("upserts branding configuration for a tenant", async () => {
    const savedBranding = {
      tenantId: "acme",
      logoUrl: "https://acme.com/new-logo.png",
      primaryColor: "#123456",
      appName: "Acme AI v2",
    };
    vi.mocked(upsertBranding).mockResolvedValue(savedBranding as any);

    const handler = registeredRoutes["PUT /:tenantId"]?.handler;
    expect(handler).toBeDefined();

    const req = makeReq({
      params: { tenantId: "acme" },
      body: {
        logoUrl: "https://acme.com/new-logo.png",
        primaryColor: "#123456",
        appName: "Acme AI v2",
      },
    });
    const result = await handler(req, makeReply());

    expect(upsertBranding).toHaveBeenCalledWith(
      "acme",
      expect.objectContaining({
        logoUrl: "https://acme.com/new-logo.png",
        primaryColor: "#123456",
        appName: "Acme AI v2",
      })
    );
    expect(result).toEqual(savedBranding);
  });

  it("accepts partial branding updates", async () => {
    vi.mocked(upsertBranding).mockResolvedValue({ tenantId: "t1", primaryColor: "#aabbcc" } as any);

    const handler = registeredRoutes["PUT /:tenantId"]?.handler;
    const req = makeReq({
      params: { tenantId: "t1" },
      body: { primaryColor: "#aabbcc" },
    });
    await handler(req, makeReply());

    expect(upsertBranding).toHaveBeenCalledWith("t1", expect.objectContaining({ primaryColor: "#aabbcc" }));
  });

  it("accepts all branding fields including customCss and faviconUrl", async () => {
    vi.mocked(upsertBranding).mockResolvedValue({} as any);

    const handler = registeredRoutes["PUT /:tenantId"]?.handler;
    const body = {
      logoUrl: "https://cdn.example.com/logo.png",
      faviconUrl: "https://cdn.example.com/favicon.ico",
      primaryColor: "#6366f1",
      appName: "My App",
      customCss: "body { font-family: Arial; }",
    };
    const req = makeReq({ params: { tenantId: "test" }, body });
    await handler(req, makeReply());

    expect(upsertBranding).toHaveBeenCalledWith("test", expect.objectContaining(body));
  });
});

describe("DELETE /:tenantId", () => {
  it("deletes branding and returns 204 when found", async () => {
    vi.mocked(deleteBranding).mockResolvedValue(true as any);

    const handler = registeredRoutes["DELETE /:tenantId"]?.handler;
    expect(handler).toBeDefined();

    const req = makeReq({ params: { tenantId: "acme" } });
    const reply = makeReply();
    await handler(req, reply);

    expect(deleteBranding).toHaveBeenCalledWith("acme");
    expect(reply.code).toHaveBeenCalledWith(204);
  });

  it("returns 404 when tenant branding does not exist", async () => {
    vi.mocked(deleteBranding).mockResolvedValue(false as any);

    const handler = registeredRoutes["DELETE /:tenantId"]?.handler;
    const req = makeReq({ params: { tenantId: "ghost-tenant" } });
    const reply = makeReply();
    const result = await handler(req, reply);

    expect(reply.code).toHaveBeenCalledWith(404);
    expect(result).toMatchObject({ error: expect.any(String) });
  });

  it("passes correct tenantId to deleteBranding", async () => {
    vi.mocked(deleteBranding).mockResolvedValue(true as any);

    const handler = registeredRoutes["DELETE /:tenantId"]?.handler;
    await handler(makeReq({ params: { tenantId: "my-tenant" } }), makeReply());

    expect(deleteBranding).toHaveBeenCalledWith("my-tenant");
  });
});

describe("route registration", () => {
  it("registers GET /domain/:domain route", () => {
    expect(registeredRoutes["GET /domain/:domain"]).toBeDefined();
  });

  it("registers GET /:tenantId route", () => {
    expect(registeredRoutes["GET /:tenantId"]).toBeDefined();
  });

  it("registers PUT /:tenantId route", () => {
    expect(registeredRoutes["PUT /:tenantId"]).toBeDefined();
  });

  it("registers DELETE /:tenantId route", () => {
    expect(registeredRoutes["DELETE /:tenantId"]).toBeDefined();
  });
});
