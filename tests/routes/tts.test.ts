import { describe, it, expect, vi, beforeEach } from "vitest";

// ---- hoisted mocks ----

const { mockEnv, mockFetch } = vi.hoisted(() => {
  const mockEnv: any = {
    XIAOMI_MIMO_API_KEY: "test-xiaomi-key",
    OPENAI_API_KEY: "test-openai-key",
  };
  const mockFetch = vi.fn();
  return { mockEnv, mockFetch };
});

vi.mock("../../src/config/env.js", () => ({
  env: mockEnv,
}));

vi.mock("../../src/middleware/fastifyAuth.js", () => ({
  fastifyRequireAuth: vi.fn(),
}));

vi.mock("../../src/lib/logger.js", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
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

function makeReply() {
  const reply: any = {
    _code: 200,
    _headers: {} as Record<string, string>,
    _sent: null as any,
    code(c: number) {
      reply._code = c;
      return reply;
    },
    header(name: string, value: string) {
      reply._headers[name] = value;
      return reply;
    },
    send(data: any) {
      reply._sent = data;
      return reply;
    },
  };
  return reply;
}

// ---- setup ----

let handler: Function;

beforeEach(async () => {
  vi.resetAllMocks();
  for (const k of Object.keys(registeredRoutes)) delete registeredRoutes[k];

  // Restore default env
  mockEnv.XIAOMI_MIMO_API_KEY = "test-xiaomi-key";
  mockEnv.OPENAI_API_KEY = "test-openai-key";

  // Stub global fetch
  vi.stubGlobal("fetch", mockFetch);

  const mod = await import("../../src/routes/tts.js");
  const fastify = createFastifyInstance();
  await mod.default(fastify, {});
  handler = registeredRoutes["POST /"].handler;
});

// ---- tests ----

describe("POST /api/tts", () => {
  it("registers a POST / route with auth preHandler", () => {
    expect(registeredRoutes["POST /"]).toBeDefined();
    expect(registeredRoutes["POST /"].preHandler).toBeDefined();
  });

  // --- validation ---

  it("returns 400 when body has no text or input", async () => {
    const reply = makeReply();
    const result = await handler({ body: {} }, reply);
    expect(reply._code).toBe(400);
    expect(result).toEqual({ error: "Missing text/input" });
  });

  it("returns 400 when body is empty object with neither field", async () => {
    const reply = makeReply();
    const result = await handler({ body: { text: "", input: "" } }, reply);
    expect(reply._code).toBe(400);
    expect(result).toEqual({ error: "Missing text/input" });
  });

  it("returns 400 when input exceeds 4000 chars", async () => {
    const reply = makeReply();
    const longText = "a".repeat(4001);
    const result = await handler({ body: { input: longText } }, reply);
    expect(reply._code).toBe(400);
    expect(result).toEqual({ error: "Invalid payload length" });
  });

  it("accepts body.text as an alias for body.input", async () => {
    const audioBytes = new ArrayBuffer(4);
    new Uint8Array(audioBytes).set([1, 2, 3, 4]);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: () => Promise.resolve(audioBytes),
    });

    const reply = makeReply();
    await handler({ body: { text: "hello from text field" } }, reply);
    expect(reply._code).toBe(200);
    expect(reply._headers["Content-Type"]).toBe("audio/mpeg");

    // Verify the payload sent to the API used the text value
    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.input).toBe("hello from text field");
  });

  // --- success: first attempt ---

  it("returns audio buffer on first TTS attempt success", async () => {
    const audioBytes = new ArrayBuffer(8);
    new Uint8Array(audioBytes).set([0xff, 0xfb, 0x90, 0x00, 0, 0, 0, 0]);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: () => Promise.resolve(audioBytes),
    });

    const reply = makeReply();
    await handler({ body: { input: "Hello world" } }, reply);

    expect(reply._code).toBe(200);
    expect(reply._headers["Content-Type"]).toBe("audio/mpeg");
    expect(Buffer.isBuffer(reply._sent)).toBe(true);
    expect(reply._sent.length).toBe(8);

    // Should have called siliconflow with xiaomi model
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.siliconflow.cn/v1/audio/speech");
    const body = JSON.parse(opts.body);
    expect(body.model).toBe("xiaomi/MiMo-TTS-v2");
    expect(body.input).toBe("Hello world");
    expect(body.voice).toBe("random");
    expect(opts.headers.Authorization).toBe("Bearer test-xiaomi-key");
  });

  // --- fallback: second attempt ---

  it("falls back to CosyVoice when first attempt fails", async () => {
    // First attempt fails
    mockFetch.mockResolvedValueOnce({
      ok: false,
      text: () => Promise.resolve("model unavailable"),
    });
    // Second attempt succeeds
    const audioBytes = new ArrayBuffer(4);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: () => Promise.resolve(audioBytes),
    });

    const reply = makeReply();
    await handler({ body: { input: "test fallback" } }, reply);

    expect(reply._code).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    const [url2, opts2] = mockFetch.mock.calls[1];
    expect(url2).toBe("https://api.siliconflow.cn/v1/audio/speech");
    const body2 = JSON.parse(opts2.body);
    expect(body2.model).toBe("FunAudioLLM/CosyVoice2-0.5B");
    expect(body2.voice).toBe("alex");
  });

  // --- fallback: third attempt ---

  it("falls back to OpenAI tts-1 when first two attempts fail", async () => {
    // First attempt fails
    mockFetch.mockResolvedValueOnce({
      ok: false,
      text: () => Promise.resolve("error 1"),
    });
    // Second attempt fails
    mockFetch.mockResolvedValueOnce({
      ok: false,
      text: () => Promise.resolve("error 2"),
    });
    // Third attempt succeeds
    const audioBytes = new ArrayBuffer(4);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: () => Promise.resolve(audioBytes),
    });

    const reply = makeReply();
    await handler({ body: { input: "test double fallback" } }, reply);

    expect(reply._code).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(3);

    const [url3, opts3] = mockFetch.mock.calls[2];
    expect(url3).toBe("https://api.chatanywhere.tech/v1/audio/speech");
    const body3 = JSON.parse(opts3.body);
    expect(body3.model).toBe("tts-1");
    expect(body3.voice).toBe("alloy");
  });

  // --- all attempts fail ---

  it("throws when all three TTS attempts fail", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      text: () => Promise.resolve("error 1"),
    });
    mockFetch.mockResolvedValueOnce({
      ok: false,
      text: () => Promise.resolve("error 2"),
    });
    mockFetch.mockResolvedValueOnce({
      ok: false,
      text: () => Promise.resolve("error 3"),
    });

    const reply = makeReply();
    await expect(handler({ body: { input: "will fail" } }, reply)).rejects.toThrow("error 3");
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  // --- API key selection ---

  it("uses XIAOMI_MIMO_API_KEY when available", async () => {
    mockEnv.XIAOMI_MIMO_API_KEY = "xiaomi-key";
    mockEnv.OPENAI_API_KEY = "openai-key";

    const audioBytes = new ArrayBuffer(4);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: () => Promise.resolve(audioBytes),
    });

    const reply = makeReply();

    // Re-import to pick up env change - handler captures env at call time
    await handler({ body: { input: "key test" } }, reply);

    const opts = mockFetch.mock.calls[0][1];
    expect(opts.headers.Authorization).toBe("Bearer xiaomi-key");
  });

  it("falls back to OPENAI_API_KEY when XIAOMI_MIMO_API_KEY is not set", async () => {
    mockEnv.XIAOMI_MIMO_API_KEY = undefined;
    mockEnv.OPENAI_API_KEY = "openai-fallback-key";

    const audioBytes = new ArrayBuffer(4);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: () => Promise.resolve(audioBytes),
    });

    const reply = makeReply();
    await handler({ body: { input: "key test" } }, reply);

    const opts = mockFetch.mock.calls[0][1];
    expect(opts.headers.Authorization).toBe("Bearer openai-fallback-key");
  });

  // --- edge cases ---

  it("accepts input at exactly 4000 chars", async () => {
    const audioBytes = new ArrayBuffer(4);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: () => Promise.resolve(audioBytes),
    });

    const reply = makeReply();
    await handler({ body: { input: "a".repeat(4000) } }, reply);

    expect(reply._code).toBe(200);
    expect(reply._headers["Content-Type"]).toBe("audio/mpeg");
  });

  it("accepts minimum length input (1 char)", async () => {
    const audioBytes = new ArrayBuffer(4);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: () => Promise.resolve(audioBytes),
    });

    const reply = makeReply();
    await handler({ body: { input: "x" } }, reply);

    expect(reply._code).toBe(200);
  });

  it("prefers body.text over body.input when both are provided", async () => {
    const audioBytes = new ArrayBuffer(4);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: () => Promise.resolve(audioBytes),
    });

    const reply = makeReply();
    await handler({ body: { text: "from-text", input: "from-input" } }, reply);

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.input).toBe("from-text");
  });

  it("sends correct Content-Type header in request to TTS API", async () => {
    const audioBytes = new ArrayBuffer(4);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: () => Promise.resolve(audioBytes),
    });

    const reply = makeReply();
    await handler({ body: { input: "check headers" } }, reply);

    const opts = mockFetch.mock.calls[0][1];
    expect(opts.headers["Content-Type"]).toBe("application/json");
    expect(opts.method).toBe("POST");
  });

  it("propagates network errors from fetch as thrown exceptions", async () => {
    // All three attempts throw network errors
    mockFetch.mockRejectedValueOnce(new Error("network error 1"));
    mockFetch.mockRejectedValueOnce(new Error("network error 2"));
    mockFetch.mockRejectedValueOnce(new Error("network error 3"));

    const reply = makeReply();
    await expect(handler({ body: { input: "net error" } }, reply)).rejects.toThrow("network error 3");
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("logs warnings on failed attempts", async () => {
    const logger = (await import("../../src/lib/logger.js")).default;

    mockFetch.mockResolvedValueOnce({
      ok: false,
      text: () => Promise.resolve("attempt 1 error"),
    });
    mockFetch.mockResolvedValueOnce({
      ok: false,
      text: () => Promise.resolve("attempt 2 error"),
    });
    const audioBytes = new ArrayBuffer(4);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: () => Promise.resolve(audioBytes),
    });

    const reply = makeReply();
    await handler({ body: { input: "log test" } }, reply);

    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: "attempt 1 error" }),
      "TTS Attempt 1 (xiaomi/MiMo-TTS-v2) failed"
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: "attempt 2 error" }),
      "TTS Attempt 2 (CosyVoice) failed"
    );
  });
});
