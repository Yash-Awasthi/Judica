import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/middleware/fastifyAuth.js", () => ({
  fastifyRequireAuth: vi.fn(),
  fastifyRequireAdmin: vi.fn(),
}));

vi.mock("../../src/widget/models.js", () => ({
  DEFAULT_WIDGET_CONFIG: {
    apiBaseUrl: "",
    mode: "floating",
    title: "JUDICA",
    placeholder: "Ask a question...",
    primaryColor: "#6366f1",
    position: "bottom-right",
    showSources: true,
    persistSession: true,
  },
  DEFAULT_THEME: {
    primaryColor: "#6366f1",
    backgroundColor: "#ffffff",
    textColor: "#1f2937",
    borderColor: "#e5e7eb",
    inputBackground: "#f9fafb",
    userBubbleColor: "#6366f1",
    assistantBubbleColor: "#f3f4f6",
    fontFamily: "-apple-system, sans-serif",
    fontSize: "14px",
    borderRadius: "12px",
  },
}));

vi.mock("../../src/widget/styles.js", () => ({
  generateWidgetStyles: vi.fn(() => "/* generated styles */"),
}));

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
    role: "member",
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
  r.type = vi.fn(() => r);
  return r;
}

let fastify: any;

beforeEach(async () => {
  vi.clearAllMocks();
  Object.keys(registeredRoutes).forEach((k) => delete registeredRoutes[k]);
  fastify = createFastifyInstance();
  const { default: widgetPlugin } = await import("../../src/routes/widget.js");
  await widgetPlugin(fastify, {});
});

describe("GET /embed.js", () => {
  it("registers the GET /embed.js route", () => {
    expect(registeredRoutes["GET /embed.js"]).toBeDefined();
  });

  it("serves JavaScript bundle with correct content-type", async () => {
    const handler = registeredRoutes["GET /embed.js"]?.handler;
    const reply = makeReply();
    await handler(makeReq(), reply);

    expect(reply.type).toHaveBeenCalledWith("application/javascript");
    expect(reply.send).toHaveBeenCalled();
  });

  it("sets cache control header", async () => {
    const handler = registeredRoutes["GET /embed.js"]?.handler;
    const reply = makeReply();
    await handler(makeReq(), reply);

    expect(reply.header).toHaveBeenCalledWith(
      "Cache-Control",
      expect.stringContaining("max-age")
    );
  });

  it("sets CORS allow origin header", async () => {
    const handler = registeredRoutes["GET /embed.js"]?.handler;
    const reply = makeReply();
    await handler(makeReq(), reply);

    expect(reply.header).toHaveBeenCalledWith("Access-Control-Allow-Origin", "*");
  });

  it("returns a non-empty JavaScript IIFE bundle", async () => {
    const handler = registeredRoutes["GET /embed.js"]?.handler;
    const reply = makeReply();
    await handler(makeReq(), reply);

    const sendArg = vi.mocked(reply.send).mock.calls[0][0];
    expect(typeof sendArg).toBe("string");
    expect(sendArg).toContain("(function()");
    expect(sendArg.length).toBeGreaterThan(100);
  });

  it("bundle contains the AibyaiWidget web component registration", async () => {
    const handler = registeredRoutes["GET /embed.js"]?.handler;
    const reply = makeReply();
    await handler(makeReq(), reply);

    const bundle = vi.mocked(reply.send).mock.calls[0][0] as string;
    expect(bundle).toContain("judica-widget");
  });
});

describe("GET /config", () => {
  it("registers the GET /config route", () => {
    expect(registeredRoutes["GET /config"]).toBeDefined();
  });

  it("returns default config when no tenant is specified", async () => {
    const handler = registeredRoutes["GET /config"]?.handler;
    const req = makeReq({ query: {} });
    const reply = makeReply();
    await handler(req, reply);

    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "JUDICA",
        primaryColor: "#6366f1",
        position: "bottom-right",
        mode: "floating",
      })
    );
  });

  it("returns default config for 'default' tenant key", async () => {
    const handler = registeredRoutes["GET /config"]?.handler;
    const req = makeReq({ query: { tenant: "default" } });
    const reply = makeReply();
    await handler(req, reply);

    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({ title: "JUDICA" })
    );
  });

  it("returns tenant-specific config after it has been updated", async () => {
    // First, PUT a custom config for a tenant
    const putHandler = registeredRoutes["PUT /config"]?.handler;
    const customConfig = {
      title: "MyCompany AI",
      primaryColor: "#ff5733",
    };

    // Note: PUT /config currently stores under "default" key
    await putHandler(
      makeReq({ body: customConfig }),
      makeReply()
    );

    // Then GET the config
    const getHandler = registeredRoutes["GET /config"]?.handler;
    const reply = makeReply();
    await getHandler(makeReq({ query: {} }), reply);

    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({ title: "MyCompany AI", primaryColor: "#ff5733" })
    );
  });

  it("includes greeting in default config", async () => {
    const handler = registeredRoutes["GET /config"]?.handler;
    const reply = makeReply();
    // Use a fresh tenant key that hasn't been written to — must return the default config with greeting
    await handler(makeReq({ query: { tenant: "fresh-tenant-for-greeting-test" } }), reply);

    const sentConfig = vi.mocked(reply.send).mock.calls[0][0] as any;
    expect(sentConfig).toHaveProperty("greeting");
  });
});

describe("GET /snippet", () => {
  it("registers the GET /snippet route", () => {
    expect(registeredRoutes["GET /snippet"]).toBeDefined();
  });

  it("returns an HTML embed snippet and usage instructions", async () => {
    const handler = registeredRoutes["GET /snippet"]?.handler;
    const req = makeReq({
      query: {
        baseUrl: "https://ai.example.com",
        apiKey: "sk-test-key",
        mode: "floating",
      },
    });
    const reply = makeReply();
    await handler(req, reply);

    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({
        snippet: expect.stringContaining("<judica-widget"),
        usage: expect.any(String),
      })
    );
  });

  it("includes baseUrl in the snippet script tag", async () => {
    const handler = registeredRoutes["GET /snippet"]?.handler;
    const req = makeReq({ query: { baseUrl: "https://my-server.io" } });
    const reply = makeReply();
    await handler(req, reply);

    const { snippet } = vi.mocked(reply.send).mock.calls[0][0] as any;
    expect(snippet).toContain("https://my-server.io");
  });

  it("includes apiKey in the snippet as data attribute", async () => {
    const handler = registeredRoutes["GET /snippet"]?.handler;
    const req = makeReq({ query: { apiKey: "myapikey123" } });
    const reply = makeReply();
    await handler(req, reply);

    const { snippet } = vi.mocked(reply.send).mock.calls[0][0] as any;
    expect(snippet).toContain("myapikey123");
  });

  it("includes data-kb-id attribute when kbId is specified", async () => {
    const handler = registeredRoutes["GET /snippet"]?.handler;
    const req = makeReq({
      query: { baseUrl: "https://server.io", kbId: "kb_abc123" },
    });
    const reply = makeReply();
    await handler(req, reply);

    const { snippet } = vi.mocked(reply.send).mock.calls[0][0] as any;
    expect(snippet).toContain('data-kb-id="kb_abc123"');
  });

  it("omits data-kb-id attribute when kbId is not specified", async () => {
    const handler = registeredRoutes["GET /snippet"]?.handler;
    const req = makeReq({ query: { baseUrl: "https://server.io" } });
    const reply = makeReply();
    await handler(req, reply);

    const { snippet } = vi.mocked(reply.send).mock.calls[0][0] as any;
    expect(snippet).not.toContain("data-kb-id");
  });

  it("uses placeholder text when baseUrl is not provided", async () => {
    const handler = registeredRoutes["GET /snippet"]?.handler;
    const req = makeReq({ query: {} });
    const reply = makeReply();
    await handler(req, reply);

    const { snippet } = vi.mocked(reply.send).mock.calls[0][0] as any;
    expect(snippet).toContain("{YOUR_SERVER_URL}");
  });

  it("escapes special characters in snippet attributes", async () => {
    const handler = registeredRoutes["GET /snippet"]?.handler;
    const req = makeReq({
      query: { baseUrl: "https://server.io", apiKey: 'key"with"quotes' },
    });
    const reply = makeReply();
    await handler(req, reply);

    const { snippet } = vi.mocked(reply.send).mock.calls[0][0] as any;
    expect(snippet).not.toContain('"with"');
    expect(snippet).toContain("&quot;");
  });
});

describe("PUT /config", () => {
  it("registers the PUT /config route", () => {
    expect(registeredRoutes["PUT /config"]).toBeDefined();
  });

  it("updates widget config and returns ok with new config", async () => {
    const handler = registeredRoutes["PUT /config"]?.handler;
    const body = {
      title: "Updated Title",
      primaryColor: "#abcdef",
      position: "bottom-left",
    };
    const req = makeReq({ body });
    const reply = makeReply();
    await handler(req, reply);

    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: true,
        config: expect.objectContaining(body),
      })
    );
  });

  it("merges new fields with existing config", async () => {
    const handler = registeredRoutes["PUT /config"]?.handler;

    // First update
    await handler(makeReq({ body: { title: "First Title", primaryColor: "#111111" } }), makeReply());

    // Second update — only change title
    const reply2 = makeReply();
    await handler(makeReq({ body: { title: "Second Title" } }), reply2);

    const { config } = vi.mocked(reply2.send).mock.calls[0][0] as any;
    expect(config.title).toBe("Second Title");
    expect(config.primaryColor).toBe("#111111"); // preserved from first update
  });

  it("accepts theme object in body", async () => {
    const handler = registeredRoutes["PUT /config"]?.handler;
    const theme = {
      primaryColor: "#abc",
      backgroundColor: "#fff",
      textColor: "#000",
    };
    const req = makeReq({ body: { theme } });
    const reply = makeReply();
    await handler(req, reply);

    const { config } = vi.mocked(reply.send).mock.calls[0][0] as any;
    expect(config.theme).toEqual(theme);
  });
});

describe("route registration", () => {
  it("registers all 4 widget routes", () => {
    expect(registeredRoutes["GET /embed.js"]).toBeDefined();
    expect(registeredRoutes["GET /config"]).toBeDefined();
    expect(registeredRoutes["GET /snippet"]).toBeDefined();
    expect(registeredRoutes["PUT /config"]).toBeDefined();
  });
});
