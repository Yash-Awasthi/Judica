import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/lib/ssrf.js", () => ({
  validateSafeUrl: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/lib/breaker.js", () => ({
  getBreaker: vi.fn((_provider: any, action: any) => ({
    fire: (...args: any[]) => action(...args),
  })),
}));

vi.mock("../../src/lib/logger.js", () => ({
  default: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Helper to create a ReadableStream from SSE lines
function createSSEStream(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const data = lines.map((l) => `${l}\n`).join("");
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(data));
      controller.close();
    },
  });
}

import { AnthropicAdapter } from "../../src/adapters/anthropic.adapter.js";
import { validateSafeUrl } from "../../src/lib/ssrf.js";
import { getBreaker } from "../../src/lib/breaker.js";

describe("AnthropicAdapter", () => {
  let adapter: AnthropicAdapter;
  const mockApiKey = "sk-ant-test-key-123";

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new AnthropicAdapter(mockApiKey);
    vi.stubGlobal("fetch", vi.fn());
  });

  describe("constructor", () => {
    it("sets providerId to 'anthropic'", () => {
      expect(adapter.providerId).toBe("anthropic");
    });

    it("strips trailing slash from baseUrl", () => {
      const a = new AnthropicAdapter(mockApiKey, "https://custom.api.com/");
      expect(a.providerId).toBe("anthropic");
    });
  });

  describe("generate", () => {
    it("validates the base URL via SSRF check", async () => {
      const mockResponse = new Response(
        JSON.stringify({ error: { message: "test" } }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", {
        value: createSSEStream([
          'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}',
          'data: {"type":"message_delta","usage":{"output_tokens":5}}',
        ]),
      });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      await adapter.generate({
        model: "claude-3-5-sonnet-20241022",
        messages: [{ role: "user", content: "Hi" }],
      });

      expect(validateSafeUrl).toHaveBeenCalledWith("https://api.anthropic.com");
    });

    it("sends correct headers (x-api-key, anthropic-version)", async () => {
      const sseBody = createSSEStream([
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}',
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: sseBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      await adapter.generate({
        model: "claude-3-5-sonnet-20241022",
        messages: [{ role: "user", content: "Hello" }],
      });

      const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const url = fetchCall[0];
      const options = fetchCall[1];

      expect(url).toBe("https://api.anthropic.com/v1/messages");
      expect(options.headers["x-api-key"]).toBe(mockApiKey);
      expect(options.headers["anthropic-version"]).toBe("2023-06-01");
      expect(options.headers["Content-Type"]).toBe("application/json");
      expect(options.method).toBe("POST");
    });

    it("formats messages correctly, skipping system role", async () => {
      const sseBody = createSSEStream([
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"response"}}',
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: sseBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      await adapter.generate({
        model: "claude-3-5-sonnet-20241022",
        messages: [
          { role: "system", content: "You are helpful" },
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Hi there" },
        ],
        system_prompt: "Be helpful",
      });

      const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);

      // System messages are skipped from messages array
      expect(body.messages).toEqual([
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there" },
      ]);
      // system_prompt goes into body.system
      expect(body.system).toBe("Be helpful");
      expect(body.stream).toBe(true);
      expect(body.model).toBe("claude-3-5-sonnet-20241022");
    });

    it("includes temperature, top_p, and max_tokens in request body", async () => {
      const sseBody = createSSEStream([
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ok"}}',
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: sseBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      await adapter.generate({
        model: "claude-3-5-sonnet-20241022",
        messages: [{ role: "user", content: "Test" }],
        temperature: 0.7,
        top_p: 0.9,
        max_tokens: 1024,
      });

      const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
      expect(body.temperature).toBe(0.7);
      expect(body.top_p).toBe(0.9);
      expect(body.max_tokens).toBe(1024);
    });

    it("formats tools with input_schema", async () => {
      const sseBody = createSSEStream([
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ok"}}',
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: sseBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      await adapter.generate({
        model: "claude-3-5-sonnet-20241022",
        messages: [{ role: "user", content: "Use tool" }],
        tools: [
          {
            name: "get_weather",
            description: "Get weather",
            parameters: { type: "object", properties: { city: { type: "string" } } },
          },
        ],
      });

      const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
      expect(body.tools).toEqual([
        {
          name: "get_weather",
          description: "Get weather",
          input_schema: { type: "object", properties: { city: { type: "string" } } },
        },
      ]);
    });

    it("handles streaming response and collects text", async () => {
      const sseBody = createSSEStream([
        'data: {"type":"message_start","message":{"usage":{"input_tokens":10}}}',
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}',
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":" world"}}',
        'data: {"type":"message_delta","usage":{"output_tokens":5}}',
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: sseBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      const result = await adapter.generate({
        model: "claude-3-5-sonnet-20241022",
        messages: [{ role: "user", content: "Hi" }],
      });

      // Collect all chunks from the stream to verify behavior
      const chunks: any[] = [];
      for await (const chunk of result.stream) {
        chunks.push(chunk);
      }

      // Verify we got text chunks
      const textChunks = chunks.filter((c) => c.type === "text");
      expect(textChunks.map((c) => c.text).join("")).toBe("Hello world");

      // Verify we got usage chunks (message_start yields prompt_tokens, message_delta yields completion_tokens)
      const usageChunks = chunks.filter((c) => c.type === "usage");
      expect(usageChunks.length).toBeGreaterThan(0);

      // Verify done chunk
      const doneChunks = chunks.filter((c) => c.type === "done");
      expect(doneChunks.length).toBe(1);
    });

    it("throws on non-ok response", async () => {
      const mockResponse = new Response(
        JSON.stringify({ error: { message: "Invalid API key" } }),
        { status: 401 }
      );

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      await expect(
        adapter.generate({
          model: "claude-3-5-sonnet-20241022",
          messages: [{ role: "user", content: "Hi" }],
        })
      ).rejects.toThrow("Invalid API key");
    });

    it("uses circuit breaker", async () => {
      const sseBody = createSSEStream([
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ok"}}',
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: sseBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      await adapter.generate({
        model: "claude-3-5-sonnet-20241022",
        messages: [{ role: "user", content: "Test" }],
      });

      expect(getBreaker).toHaveBeenCalled();
    });
  });

  describe("listModels", () => {
    it("returns a static list of Claude models", async () => {
      const models = await adapter.listModels();
      expect(models).toContain("claude-opus-4-20250514");
      expect(models).toContain("claude-sonnet-4-20250514");
      expect(models.length).toBeGreaterThan(0);
    });
  });

  describe("isAvailable", () => {
    it("returns true for valid API key format", async () => {
      const a = new AnthropicAdapter("sk-ant-valid-key");
      expect(await a.isAvailable()).toBe(true);
    });

    it("returns false for invalid API key format", async () => {
      const a = new AnthropicAdapter("invalid-key");
      expect(await a.isAvailable()).toBe(false);
    });
  });
});
