import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The deliberate-proxy reads process.env directly, so set it before import
process.env.GOOGLE_API_KEY = "test-key";

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
    log: { error: vi.fn(), info: vi.fn() },
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

function makeGeminiResponse(text: string): Response {
  return {
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue({
      candidates: [{ content: { parts: [{ text }] } }],
    }),
    text: vi.fn().mockResolvedValue(text),
  } as unknown as Response;
}

let fastify: any;

beforeEach(async () => {
  vi.clearAllMocks();
  Object.keys(registeredRoutes).forEach((k) => delete registeredRoutes[k]);
  fastify = createFastifyInstance();
  const { default: deliberateProxyPlugin } = await import(
    "../../src/routes/deliberate-proxy.js"
  );
  await deliberateProxyPlugin(fastify, {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("POST /deliberate", () => {
  it("returns 400 when prompt is missing", async () => {
    const handler = registeredRoutes["POST /deliberate"]?.handler;
    expect(handler).toBeDefined();

    const req = makeReq({ body: {} });
    const reply = makeReply();
    await handler(req, reply);

    expect(reply.status).toHaveBeenCalledWith(400);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining("prompt") })
    );
  });

  it("calls Gemini with Architect system prompt by default", async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeGeminiResponse("Architectural analysis here"));
    vi.stubGlobal("fetch", mockFetch);

    const handler = registeredRoutes["POST /deliberate"]?.handler;
    const req = makeReq({
      body: { prompt: "Should we use microservices?", members: [{ name: "Architect" }] },
    });
    const reply = makeReply();
    await handler(req, reply);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("gemini"),
      expect.objectContaining({ method: "POST" })
    );
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.any(String) })
    );
  });

  it("returns text from Gemini for opinion-type deliberation", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      makeGeminiResponse("From a pragmatic standpoint, microservices add complexity.")
    );
    vi.stubGlobal("fetch", mockFetch);

    const handler = registeredRoutes["POST /deliberate"]?.handler;
    const req = makeReq({
      body: { prompt: "Microservices vs monolith?", members: [{ name: "Pragmatist" }] },
    });
    const reply = makeReply();
    await handler(req, reply);

    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({ text: "From a pragmatic standpoint, microservices add complexity." })
    );
  });

  it("generates verdict when type is 'verdict' and members have opinions", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      makeGeminiResponse("After considering all perspectives, the recommendation is to start with a monolith.")
    );
    vi.stubGlobal("fetch", mockFetch);

    const handler = registeredRoutes["POST /deliberate"]?.handler;
    const req = makeReq({
      body: {
        prompt: "Should we use microservices?",
        type: "verdict",
        members: [
          { name: "Architect", opinion: "Microservices offer better scalability." },
          { name: "Pragmatist", opinion: "Monolith is simpler to start with." },
        ],
      },
    });
    const reply = makeReply();
    await handler(req, reply);

    // Should call Gemini with verdict system prompt
    const fetchCall = mockFetch.mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.systemInstruction.parts[0].text).toContain("Moderator");
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.any(String) })
    );
  });

  it("uses custom archetype system prompt for unknown member names", async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeGeminiResponse("Custom perspective here."));
    vi.stubGlobal("fetch", mockFetch);

    const handler = registeredRoutes["POST /deliberate"]?.handler;
    const req = makeReq({
      body: { prompt: "What should we do?", members: [{ name: "CustomExpert" }] },
    });
    const reply = makeReply();
    await handler(req, reply);

    const fetchCall = mockFetch.mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.systemInstruction.parts[0].text).toContain("CustomExpert");
  });

  it("uses Architect as default when no members provided", async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeGeminiResponse("Default analysis."));
    vi.stubGlobal("fetch", mockFetch);

    const handler = registeredRoutes["POST /deliberate"]?.handler;
    const req = makeReq({ body: { prompt: "Evaluate this design." } });
    const reply = makeReply();
    await handler(req, reply);

    const fetchCall = mockFetch.mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.systemInstruction.parts[0].text).toContain("Architect");
  });

  it("returns 500 when Gemini API fails", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: vi.fn().mockResolvedValue("Service unavailable"),
    } as unknown as Response);
    vi.stubGlobal("fetch", mockFetch);

    const handler = registeredRoutes["POST /deliberate"]?.handler;
    const req = makeReq({ body: { prompt: "Test prompt" } });
    const reply = makeReply();
    await handler(req, reply);

    expect(reply.status).toHaveBeenCalledWith(500);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.any(String) })
    );
  });

  it("returns 500 when fetch throws a network error", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("Network failure"));
    vi.stubGlobal("fetch", mockFetch);

    const handler = registeredRoutes["POST /deliberate"]?.handler;
    const req = makeReq({ body: { prompt: "Test prompt" } });
    const reply = makeReply();
    await handler(req, reply);

    expect(reply.status).toHaveBeenCalledWith(500);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({ error: "Network failure" })
    );
  });
});

describe("POST /evaluate", () => {
  it("returns 400 when topic is missing", async () => {
    const handler = registeredRoutes["POST /evaluate"]?.handler;
    expect(handler).toBeDefined();

    const req = makeReq({ body: {} });
    const reply = makeReply();
    await handler(req, reply);

    expect(reply.status).toHaveBeenCalledWith(400);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining("topic") })
    );
  });

  it("returns quality metrics from Gemini JSON response", async () => {
    const metricsJson = JSON.stringify({
      quality: 85,
      coherence: 0.9,
      consensus: 0.75,
      diversity: 0.8,
    });
    const mockFetch = vi.fn().mockResolvedValue(makeGeminiResponse(metricsJson));
    vi.stubGlobal("fetch", mockFetch);

    const handler = registeredRoutes["POST /evaluate"]?.handler;
    const req = makeReq({ body: { topic: "AI ethics in healthcare" } });
    const reply = makeReply();
    await handler(req, reply);

    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({
        quality: 85,
        coherence: 0.9,
        consensus: 0.75,
        diversity: 0.8,
      })
    );
  });

  it("returns default metrics when Gemini returns non-JSON text", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      makeGeminiResponse("I cannot evaluate this topic right now.")
    );
    vi.stubGlobal("fetch", mockFetch);

    const handler = registeredRoutes["POST /evaluate"]?.handler;
    const req = makeReq({ body: { topic: "Some topic" } });
    const reply = makeReply();
    await handler(req, reply);

    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({
        quality: 75,
        coherence: 0.8,
        consensus: 0.7,
        diversity: 0.85,
      })
    );
  });

  it("clamps quality to 0-100 range", async () => {
    const metricsJson = JSON.stringify({
      quality: 150,
      coherence: 1.5,
      consensus: -0.2,
      diversity: 0.7,
    });
    const mockFetch = vi.fn().mockResolvedValue(makeGeminiResponse(metricsJson));
    vi.stubGlobal("fetch", mockFetch);

    const handler = registeredRoutes["POST /evaluate"]?.handler;
    const req = makeReq({ body: { topic: "Extreme topic" } });
    const reply = makeReply();
    await handler(req, reply);

    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({
        quality: 100,
        coherence: 1,
        consensus: 0,
      })
    );
  });

  it("extracts JSON from mixed text response", async () => {
    const responseWithMixedText = `Here are the metrics: {"quality": 70, "coherence": 0.75, "consensus": 0.65, "diversity": 0.9} That's my evaluation.`;
    const mockFetch = vi.fn().mockResolvedValue(makeGeminiResponse(responseWithMixedText));
    vi.stubGlobal("fetch", mockFetch);

    const handler = registeredRoutes["POST /evaluate"]?.handler;
    const req = makeReq({ body: { topic: "Complex deliberation" } });
    const reply = makeReply();
    await handler(req, reply);

    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({ quality: 70 })
    );
  });

  it("returns 500 when Gemini API fails during evaluation", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("Gemini timeout"));
    vi.stubGlobal("fetch", mockFetch);

    const handler = registeredRoutes["POST /evaluate"]?.handler;
    const req = makeReq({ body: { topic: "Test topic" } });
    const reply = makeReply();
    await handler(req, reply);

    expect(reply.status).toHaveBeenCalledWith(500);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({ error: "Gemini timeout" })
    );
  });

  it("returns 500 when Gemini returns non-ok HTTP status", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: vi.fn().mockResolvedValue("Rate limit exceeded"),
    } as unknown as Response);
    vi.stubGlobal("fetch", mockFetch);

    const handler = registeredRoutes["POST /evaluate"]?.handler;
    const req = makeReq({ body: { topic: "Test topic" } });
    const reply = makeReply();
    await handler(req, reply);

    expect(reply.status).toHaveBeenCalledWith(500);
  });
});

describe("route registration", () => {
  it("registers POST /deliberate route", () => {
    expect(registeredRoutes["POST /deliberate"]).toBeDefined();
  });

  it("registers POST /evaluate route", () => {
    expect(registeredRoutes["POST /evaluate"]).toBeDefined();
  });
});
