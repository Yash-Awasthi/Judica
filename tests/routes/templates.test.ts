import { describe, it, expect, vi, beforeEach } from "vitest";

// ---- mock the TEMPLATES data ----

const MOCK_TEMPLATES = [
  {
    id: "debate",
    name: "Debate Council",
    description: "Members argue opposing sides, master finds truth",
    masterPrompt: "You are a neutral judge.",
    members: [
      { name: "Devil's Advocate", systemPrompt: "Argue the opposite." },
      { name: "Conventionalist", systemPrompt: "Defend the mainstream." },
    ],
  },
  {
    id: "research",
    name: "Research Council",
    description: "Deep analysis from multiple academic angles",
    masterPrompt: "You are a senior researcher.",
    members: [
      { name: "Data Analyst", systemPrompt: "Focus on data." },
    ],
  },
  {
    id: "technical",
    name: "Technical Council",
    description: "Engineering and architecture decisions",
    masterPrompt: "You are a principal engineer.",
    members: [],
  },
];

vi.mock("../../src/lib/templates.js", () => ({
  TEMPLATES: MOCK_TEMPLATES,
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

function createRequest(overrides: Partial<{ params: any }> = {}): any {
  return {
    params: overrides.params ?? {},
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

let templatesPlugin: any;

beforeEach(async () => {
  vi.clearAllMocks();
  for (const key of Object.keys(registeredRoutes)) {
    delete registeredRoutes[key];
  }

  const mod = await import("../../src/routes/templates.js");
  templatesPlugin = mod.default;
  const fastify = createFastifyInstance();
  await templatesPlugin(fastify);
});

// ================================================================
// Route registration
// ================================================================
describe("route registration", () => {
  it("registers GET / route", () => {
    expect(registeredRoutes["GET /"]).toBeDefined();
    expect(registeredRoutes["GET /"]).toHaveProperty("handler");
  });

  it("registers GET /:id route", () => {
    expect(registeredRoutes["GET /:id"]).toBeDefined();
    expect(registeredRoutes["GET /:id"]).toHaveProperty("handler");
  });

  it("registers exactly two routes", () => {
    expect(Object.keys(registeredRoutes)).toHaveLength(2);
  });
});

// ================================================================
// GET /  (list all templates)
// ================================================================
describe("GET /", () => {
  it("returns the full TEMPLATES array", async () => {
    const { handler } = registeredRoutes["GET /"];
    const result = await handler(createRequest(), createReply());

    expect(result).toBe(MOCK_TEMPLATES);
    expect(result).toHaveLength(3);
  });

  it("returns array containing all template objects", async () => {
    const { handler } = registeredRoutes["GET /"];
    const result = await handler(createRequest(), createReply());

    expect(result[0].id).toBe("debate");
    expect(result[1].id).toBe("research");
    expect(result[2].id).toBe("technical");
  });

  it("each template has required fields", async () => {
    const { handler } = registeredRoutes["GET /"];
    const result = await handler(createRequest(), createReply());

    for (const template of result) {
      expect(template).toHaveProperty("id");
      expect(template).toHaveProperty("name");
      expect(template).toHaveProperty("description");
      expect(template).toHaveProperty("masterPrompt");
      expect(template).toHaveProperty("members");
    }
  });

  it("does not modify the reply status code", async () => {
    const { handler } = registeredRoutes["GET /"];
    const reply = createReply();
    await handler(createRequest(), reply);

    expect(reply.code).not.toHaveBeenCalled();
    expect(reply.statusCode).toBe(200);
  });
});

// ================================================================
// GET /:id  (get template by ID)
// ================================================================
describe("GET /:id", () => {
  it("returns the correct template when given a valid id", async () => {
    const { handler } = registeredRoutes["GET /:id"];
    const request = createRequest({ params: { id: "debate" } });
    const result = await handler(request, createReply());

    expect(result).toBe(MOCK_TEMPLATES[0]);
    expect(result.id).toBe("debate");
    expect(result.name).toBe("Debate Council");
  });

  it("returns the research template by id", async () => {
    const { handler } = registeredRoutes["GET /:id"];
    const request = createRequest({ params: { id: "research" } });
    const result = await handler(request, createReply());

    expect(result.id).toBe("research");
    expect(result.name).toBe("Research Council");
  });

  it("returns the technical template by id", async () => {
    const { handler } = registeredRoutes["GET /:id"];
    const request = createRequest({ params: { id: "technical" } });
    const result = await handler(request, createReply());

    expect(result.id).toBe("technical");
    expect(result.name).toBe("Technical Council");
  });

  it("returns 404 error when template id does not exist", async () => {
    const { handler } = registeredRoutes["GET /:id"];
    const request = createRequest({ params: { id: "nonexistent" } });
    const reply = createReply();
    const result = await handler(request, reply);

    expect(reply.code).toHaveBeenCalledWith(404);
    expect(result).toEqual({ error: "Template not found" });
  });

  it("returns 404 for empty string id", async () => {
    const { handler } = registeredRoutes["GET /:id"];
    const request = createRequest({ params: { id: "" } });
    const reply = createReply();
    const result = await handler(request, reply);

    expect(reply.code).toHaveBeenCalledWith(404);
    expect(result).toEqual({ error: "Template not found" });
  });

  it("returns 404 for id with wrong case", async () => {
    const { handler } = registeredRoutes["GET /:id"];
    const request = createRequest({ params: { id: "Debate" } });
    const reply = createReply();
    const result = await handler(request, reply);

    expect(reply.code).toHaveBeenCalledWith(404);
    expect(result).toEqual({ error: "Template not found" });
  });

  it("returns 404 for id with leading/trailing spaces", async () => {
    const { handler } = registeredRoutes["GET /:id"];
    const request = createRequest({ params: { id: " debate " } });
    const reply = createReply();
    const result = await handler(request, reply);

    expect(reply.code).toHaveBeenCalledWith(404);
    expect(result).toEqual({ error: "Template not found" });
  });

  it("returns 404 for numeric id", async () => {
    const { handler } = registeredRoutes["GET /:id"];
    const request = createRequest({ params: { id: "123" } });
    const reply = createReply();
    const result = await handler(request, reply);

    expect(reply.code).toHaveBeenCalledWith(404);
    expect(result).toEqual({ error: "Template not found" });
  });

  it("returns 404 for undefined-like id values", async () => {
    const { handler } = registeredRoutes["GET /:id"];

    for (const badId of ["undefined", "null"]) {
      const reply = createReply();
      const result = await handler(createRequest({ params: { id: badId } }), reply);
      expect(reply.code).toHaveBeenCalledWith(404);
      expect(result).toEqual({ error: "Template not found" });
    }
  });

  it("does not set status code on success", async () => {
    const { handler } = registeredRoutes["GET /:id"];
    const reply = createReply();
    await handler(createRequest({ params: { id: "debate" } }), reply);

    expect(reply.code).not.toHaveBeenCalled();
    expect(reply.statusCode).toBe(200);
  });

  it("returned template includes members array", async () => {
    const { handler } = registeredRoutes["GET /:id"];
    const result = await handler(createRequest({ params: { id: "debate" } }), createReply());

    expect(Array.isArray(result.members)).toBe(true);
    expect(result.members).toHaveLength(2);
    expect(result.members[0]).toHaveProperty("name");
    expect(result.members[0]).toHaveProperty("systemPrompt");
  });

  it("returns template with empty members array when applicable", async () => {
    const { handler } = registeredRoutes["GET /:id"];
    const result = await handler(createRequest({ params: { id: "technical" } }), createReply());

    expect(result.members).toEqual([]);
  });
});
