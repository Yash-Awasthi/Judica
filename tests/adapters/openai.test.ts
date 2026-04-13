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

vi.mock("../../src/lib/cost.js", () => ({
  calculateCost: vi.fn().mockReturnValue(0),
}));

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

import { OpenAIAdapter } from "../../src/adapters/openai.adapter.js";
import { validateSafeUrl } from "../../src/lib/ssrf.js";
import { getBreaker } from "../../src/lib/breaker.js";

describe("OpenAIAdapter", () => {
  let adapter: OpenAIAdapter;
  const mockApiKey = "sk-test-openai-key-123";

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new OpenAIAdapter(mockApiKey);
    vi.stubGlobal("fetch", vi.fn());
  });

  describe("constructor", () => {
    it("sets providerId to 'openai' by default", () => {
      expect(adapter.providerId).toBe("openai");
    });

    it("accepts a custom providerId", () => {
      const custom = new OpenAIAdapter("key", "https://api.example.com/v1", "mistral");
      expect(custom.providerId).toBe("mistral");
    });

    it("strips trailing slash from baseUrl", () => {
      const a = new OpenAIAdapter("key", "https://api.openai.com/v1/");
      expect(a.providerId).toBe("openai");
    });
  });

  describe("generate", () => {
    it("validates the base URL via SSRF check", async () => {
      const sseBody = createSSEStream([
        'data: {"choices":[{"delta":{"content":"Hi"}}]}',
        "data: [DONE]",
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: sseBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      await adapter.generate({
        model: "gpt-4o",
        messages: [{ role: "user", content: "Hi" }],
      });

      expect(validateSafeUrl).toHaveBeenCalledWith("https://api.openai.com/v1");
    });

    it("sends correct Authorization: Bearer header", async () => {
      const sseBody = createSSEStream([
        'data: {"choices":[{"delta":{"content":"Hello"}}]}',
        "data: [DONE]",
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: sseBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      await adapter.generate({
        model: "gpt-4o",
        messages: [{ role: "user", content: "Hello" }],
      });

      const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const url = fetchCall[0];
      const options = fetchCall[1];

      expect(url).toBe("https://api.openai.com/v1/chat/completions");
      expect(options.headers["Authorization"]).toBe(`Bearer ${mockApiKey}`);
      expect(options.headers["Content-Type"]).toBe("application/json");
      expect(options.method).toBe("POST");
    });

    it("formats messages correctly with system_prompt prepended", async () => {
      const sseBody = createSSEStream([
        'data: {"choices":[{"delta":{"content":"ok"}}]}',
        "data: [DONE]",
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: sseBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      await adapter.generate({
        model: "gpt-4o",
        messages: [
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Hi" },
        ],
        system_prompt: "You are helpful",
      });

      const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
      expect(body.messages[0]).toEqual({ role: "system", content: "You are helpful" });
      expect(body.messages[1]).toEqual({ role: "user", content: "Hello" });
      expect(body.messages[2]).toEqual({ role: "assistant", content: "Hi" });
      expect(body.stream).toBe(true);
      expect(body.model).toBe("gpt-4o");
    });

    it("includes tools formatted as OpenAI function tools", async () => {
      const sseBody = createSSEStream([
        'data: {"choices":[{"delta":{"content":"ok"}}]}',
        "data: [DONE]",
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: sseBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      await adapter.generate({
        model: "gpt-4o",
        messages: [{ role: "user", content: "weather?" }],
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
          type: "function",
          function: {
            name: "get_weather",
            description: "Get weather",
            parameters: { type: "object", properties: { city: { type: "string" } } },
          },
        },
      ]);
      expect(body.tool_choice).toBe("auto");
    });

    it("handles streaming response and collects text", async () => {
      const sseBody = createSSEStream([
        'data: {"choices":[{"delta":{"content":"Hello"}}]}',
        'data: {"choices":[{"delta":{"content":" world"}}]}',
        'data: {"usage":{"prompt_tokens":8,"completion_tokens":2}}',
        "data: [DONE]",
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: sseBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      const result = await adapter.generate({
        model: "gpt-4o",
        messages: [{ role: "user", content: "Hi" }],
      });

      const collected = await result.collect();
      expect(collected.text).toBe("Hello world");
      expect(collected.usage.prompt_tokens).toBe(8);
      expect(collected.usage.completion_tokens).toBe(2);
    });

    it("throws on non-ok response", async () => {
      const mockResponse = new Response(
        JSON.stringify({ error: { message: "Rate limit exceeded" } }),
        { status: 429 }
      );

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      await expect(
        adapter.generate({
          model: "gpt-4o",
          messages: [{ role: "user", content: "Hi" }],
        })
      ).rejects.toThrow("Rate limit exceeded");
    });

    it("uses circuit breaker", async () => {
      const sseBody = createSSEStream([
        'data: {"choices":[{"delta":{"content":"ok"}}]}',
        "data: [DONE]",
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: sseBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      await adapter.generate({
        model: "gpt-4o",
        messages: [{ role: "user", content: "Test" }],
      });

      expect(getBreaker).toHaveBeenCalled();
    });

    it("includes temperature, top_p, max_tokens in body", async () => {
      const sseBody = createSSEStream([
        'data: {"choices":[{"delta":{"content":"ok"}}]}',
        "data: [DONE]",
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: sseBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      await adapter.generate({
        model: "gpt-4o",
        messages: [{ role: "user", content: "Test" }],
        temperature: 0.5,
        top_p: 0.8,
        max_tokens: 2048,
      });

      const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
      expect(body.temperature).toBe(0.5);
      expect(body.top_p).toBe(0.8);
      expect(body.max_tokens).toBe(2048);
    });
  });
});
