import { describe, it, expect, vi, beforeEach } from "vitest";

// ---- mocks ----

const mockEnv: Record<string, string | undefined> = {};

vi.mock("../../src/config/env.js", () => ({
  env: new Proxy({} as Record<string, string | undefined>, {
    get(_target, prop: string) {
      return mockEnv[prop];
    },
  }),
}));

vi.mock("../../src/middleware/fastifyAuth.js", () => ({
  fastifyRequireAuth: vi.fn(),
}));

vi.mock("../../src/middleware/errorHandler.js", () => {
  class AppError extends Error {
    constructor(
      public statusCode: number,
      public message: string,
      public code: string = "INTERNAL_ERROR",
      public isOperational = true,
    ) {
      super(message);
      Object.setPrototypeOf(this, AppError.prototype);
    }
  }
  return { AppError };
});

vi.mock("../../src/lib/logger.js", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("@fastify/multipart", () => ({
  default: vi.fn(),
}));

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

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
    register: vi.fn(),
  };
}

function createRequest(overrides: Partial<{ userId: number; body: any; params: any; file: Function }> = {}): any {
  return {
    userId: overrides.userId ?? 1,
    body: overrides.body ?? {},
    params: overrides.params ?? {},
    file: overrides.file ?? vi.fn(),
  };
}

function createReply(): any {
  const reply: any = {
    statusCode: 200,
    code: vi.fn(function (this: any, c: number) {
      this.statusCode = c;
      return this;
    }),
    header: vi.fn(function (this: any) {
      return this;
    }),
    send: vi.fn(function (this: any, data: any) {
      this.sentData = data;
      return this;
    }),
  };
  return reply;
}

// ---- import and register the plugin ----

let voicePlugin: any;

beforeEach(async () => {
  vi.clearAllMocks();
  mockFetch.mockReset();
  for (const key of Object.keys(registeredRoutes)) {
    delete registeredRoutes[key];
  }
  // Reset env
  for (const key of Object.keys(mockEnv)) {
    delete mockEnv[key];
  }

  voicePlugin = (await import("../../src/routes/voice.js")).default;
  const fastify = createFastifyInstance();
  await voicePlugin(fastify);
});

// ---- tests ----

describe("voice routes", () => {
  describe("POST /transcribe", () => {
    const getHandler = () => registeredRoutes["POST /transcribe"].handler;

    it("registers the /transcribe route with preHandler auth", () => {
      expect(registeredRoutes["POST /transcribe"]).toBeDefined();
      expect(registeredRoutes["POST /transcribe"].preHandler).toBeDefined();
    });

    it("throws 400 when no audio file is provided", async () => {
      const req = createRequest({ file: vi.fn().mockResolvedValue(null) });
      const reply = createReply();

      await expect(getHandler()(req, reply)).rejects.toMatchObject({
        statusCode: 400,
        code: "NO_AUDIO",
      });
    });

    it("throws 503 when OPENAI_API_KEY is not set", async () => {
      const req = createRequest({
        file: vi.fn().mockResolvedValue({
          toBuffer: vi.fn().mockResolvedValue(Buffer.from("audio")),
          mimetype: "audio/webm",
          filename: "audio.webm",
        }),
      });
      const reply = createReply();

      // env.OPENAI_API_KEY is undefined by default
      await expect(getHandler()(req, reply)).rejects.toMatchObject({
        statusCode: 503,
        code: "STT_UNAVAILABLE",
      });
    });

    it("returns transcribed text on success", async () => {
      mockEnv.OPENAI_API_KEY = "sk-test-key";

      const req = createRequest({
        file: vi.fn().mockResolvedValue({
          toBuffer: vi.fn().mockResolvedValue(Buffer.from("audio-data")),
          mimetype: "audio/webm",
          filename: "recording.webm",
        }),
      });
      const reply = createReply();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ text: "Hello world" }),
      });

      const result = await getHandler()(req, reply);

      expect(result).toMatchObject({ text: "Hello world" });
      expect(mockFetch).toHaveBeenCalledOnce();
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.openai.com/v1/audio/transcriptions",
        expect.objectContaining({
          method: "POST",
          headers: { Authorization: "Bearer sk-test-key" },
        }),
      );
    });

    it("uses default filename when file.filename is falsy", async () => {
      mockEnv.OPENAI_API_KEY = "sk-test-key";

      const req = createRequest({
        file: vi.fn().mockResolvedValue({
          toBuffer: vi.fn().mockResolvedValue(Buffer.from("audio-data")),
          mimetype: "audio/webm",
          filename: "",
        }),
      });
      const reply = createReply();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ text: "test" }),
      });

      const result = await getHandler()(req, reply);
      expect(result).toMatchObject({ text: "test" });
    });

    it("throws 502 when Whisper API returns non-ok response", async () => {
      mockEnv.OPENAI_API_KEY = "sk-test-key";

      const req = createRequest({
        file: vi.fn().mockResolvedValue({
          toBuffer: vi.fn().mockResolvedValue(Buffer.from("audio-data")),
          mimetype: "audio/webm",
          filename: "audio.webm",
        }),
      });
      const reply = createReply();

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: vi.fn().mockResolvedValue("Internal Server Error"),
      });

      await expect(getHandler()(req, reply)).rejects.toMatchObject({
        statusCode: 502,
        code: "STT_FAILED",
      });
    });
  });

  describe("POST /synthesize", () => {
    const getHandler = () => registeredRoutes["POST /synthesize"].handler;

    it("registers the /synthesize route with preHandler auth", () => {
      expect(registeredRoutes["POST /synthesize"]).toBeDefined();
      expect(registeredRoutes["POST /synthesize"].preHandler).toBeDefined();
    });

    it("throws 400 when text is missing", async () => {
      const req = createRequest({ body: {} });
      const reply = createReply();

      await expect(getHandler()(req, reply)).rejects.toMatchObject({
        statusCode: 400,
        code: "NO_TEXT",
      });
    });

    it("throws 400 when text is empty string", async () => {
      const req = createRequest({ body: { text: "" } });
      const reply = createReply();

      await expect(getHandler()(req, reply)).rejects.toMatchObject({
        statusCode: 400,
        code: "NO_TEXT",
      });
    });

    it("throws 400 when text is whitespace only", async () => {
      const req = createRequest({ body: { text: "   " } });
      const reply = createReply();

      await expect(getHandler()(req, reply)).rejects.toMatchObject({
        statusCode: 400,
        code: "NO_TEXT",
      });
    });

    it("throws 400 when text is not a string", async () => {
      const req = createRequest({ body: { text: 12345 } });
      const reply = createReply();

      await expect(getHandler()(req, reply)).rejects.toMatchObject({
        statusCode: 400,
        code: "NO_TEXT",
      });
    });

    it("throws 400 when text exceeds 4096 characters", async () => {
      const req = createRequest({ body: { text: "a".repeat(4097) } });
      const reply = createReply();

      await expect(getHandler()(req, reply)).rejects.toMatchObject({
        statusCode: 400,
        code: "TEXT_TOO_LONG",
      });
    });

    it("throws 503 when no API keys are configured", async () => {
      const req = createRequest({ body: { text: "Hello" } });
      const reply = createReply();

      await expect(getHandler()(req, reply)).rejects.toMatchObject({
        statusCode: 503,
        code: "TTS_UNAVAILABLE",
      });
    });

    it("returns audio buffer on success with OpenAI", async () => {
      mockEnv.OPENAI_API_KEY = "sk-openai";

      const audioBuffer = new ArrayBuffer(8);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(audioBuffer),
      });

      const req = createRequest({ body: { text: "Hello world" } });
      const reply = createReply();

      await getHandler()(req, reply);

      expect(reply.header).toHaveBeenCalledWith("Content-Type", "audio/mpeg");
      expect(reply.send).toHaveBeenCalledWith(Buffer.from(audioBuffer));
      expect(mockFetch).toHaveBeenCalledOnce();
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.openai.com/v1/audio/speech",
        expect.objectContaining({
          method: "POST",
          headers: {
            Authorization: "Bearer sk-openai",
            "Content-Type": "application/json",
          },
        }),
      );
    });

    it("uses custom voice when provided", async () => {
      mockEnv.OPENAI_API_KEY = "sk-openai";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      });

      const req = createRequest({ body: { text: "Hello", voice: "alloy" } });
      const reply = createReply();

      await getHandler()(req, reply);

      const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(fetchBody.voice).toBe("alloy");
    });

    it("defaults to nova voice when none specified (OpenAI)", async () => {
      mockEnv.OPENAI_API_KEY = "sk-openai";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      });

      const req = createRequest({ body: { text: "Hello" } });
      const reply = createReply();

      await getHandler()(req, reply);

      const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(fetchBody.voice).toBe("nova");
      expect(fetchBody.model).toBe("tts-1");
    });

    it("falls back to siliconflow when OpenAI fails", async () => {
      mockEnv.OPENAI_API_KEY = "sk-openai";
      mockEnv.XIAOMI_MIMO_API_KEY = "sk-xiaomi";

      const audioBuffer = new ArrayBuffer(8);

      // OpenAI fails
      mockFetch.mockResolvedValueOnce({ ok: false });
      // Siliconflow succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(audioBuffer),
      });

      const req = createRequest({ body: { text: "Hello" } });
      const reply = createReply();

      await getHandler()(req, reply);

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch.mock.calls[1][0]).toBe("https://api.siliconflow.cn/v1/audio/speech");
      expect(reply.header).toHaveBeenCalledWith("Content-Type", "audio/mpeg");
      expect(reply.send).toHaveBeenCalledWith(Buffer.from(audioBuffer));
    });

    it("falls back to siliconflow when OpenAI throws an error", async () => {
      mockEnv.OPENAI_API_KEY = "sk-openai";
      mockEnv.XIAOMI_MIMO_API_KEY = "sk-xiaomi";

      const audioBuffer = new ArrayBuffer(8);

      // OpenAI throws network error
      mockFetch.mockRejectedValueOnce(new Error("Network error"));
      // Siliconflow succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(audioBuffer),
      });

      const req = createRequest({ body: { text: "Hello" } });
      const reply = createReply();

      await getHandler()(req, reply);

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(reply.send).toHaveBeenCalled();
    });

    it("throws 502 when all providers fail", async () => {
      mockEnv.OPENAI_API_KEY = "sk-openai";
      mockEnv.XIAOMI_MIMO_API_KEY = "sk-xiaomi";

      mockFetch.mockResolvedValueOnce({ ok: false });
      mockFetch.mockResolvedValueOnce({ ok: false });

      const req = createRequest({ body: { text: "Hello" } });
      const reply = createReply();

      await expect(getHandler()(req, reply)).rejects.toMatchObject({
        statusCode: 502,
        code: "TTS_FAILED",
      });
    });

    it("throws 502 when all providers throw errors", async () => {
      mockEnv.OPENAI_API_KEY = "sk-openai";
      mockEnv.XIAOMI_MIMO_API_KEY = "sk-xiaomi";

      mockFetch.mockRejectedValueOnce(new Error("Network error 1"));
      mockFetch.mockRejectedValueOnce(new Error("Network error 2"));

      const req = createRequest({ body: { text: "Hello" } });
      const reply = createReply();

      await expect(getHandler()(req, reply)).rejects.toMatchObject({
        statusCode: 502,
        code: "TTS_FAILED",
      });
    });

    it("uses only XIAOMI key when OPENAI key is absent", async () => {
      mockEnv.XIAOMI_MIMO_API_KEY = "sk-xiaomi";

      const audioBuffer = new ArrayBuffer(8);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(audioBuffer),
      });

      const req = createRequest({ body: { text: "Hello" } });
      const reply = createReply();

      await getHandler()(req, reply);

      // Only siliconflow attempt (OpenAI filtered out since no key)
      expect(mockFetch).toHaveBeenCalledOnce();
      expect(mockFetch.mock.calls[0][0]).toBe("https://api.siliconflow.cn/v1/audio/speech");
    });

    it("uses random voice default for siliconflow provider", async () => {
      mockEnv.XIAOMI_MIMO_API_KEY = "sk-xiaomi";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      });

      const req = createRequest({ body: { text: "Hello" } });
      const reply = createReply();

      await getHandler()(req, reply);

      const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(fetchBody.voice).toBe("random");
      expect(fetchBody.model).toBe("xiaomi/MiMo-TTS-v2");
    });

    it("trims text before sending to provider", async () => {
      mockEnv.OPENAI_API_KEY = "sk-openai";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      });

      const req = createRequest({ body: { text: "  Hello world  " } });
      const reply = createReply();

      await getHandler()(req, reply);

      const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(fetchBody.input).toBe("Hello world");
    });

    it("accepts text exactly at 4096 character limit", async () => {
      mockEnv.OPENAI_API_KEY = "sk-openai";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      });

      const req = createRequest({ body: { text: "a".repeat(4096) } });
      const reply = createReply();

      // Should not throw
      await getHandler()(req, reply);
      expect(reply.send).toHaveBeenCalled();
    });
  });
});
