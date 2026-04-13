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

import { GroqAdapter } from "../../src/adapters/groq.adapter.js";
import { validateSafeUrl } from "../../src/lib/ssrf.js";
import { getBreaker } from "../../src/lib/breaker.js";

describe("GroqAdapter", () => {
  let adapter: GroqAdapter;
  const mockApiKey = "gsk_test_groq_key_123";

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new GroqAdapter(mockApiKey);
    vi.stubGlobal("fetch", vi.fn());
  });

  describe("constructor", () => {
    it("sets providerId to 'groq'", () => {
      expect(adapter.providerId).toBe("groq");
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
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: "Hi" }],
      });

      expect(validateSafeUrl).toHaveBeenCalledWith("https://api.groq.com/openai/v1");
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
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: "Hello" }],
      });

      const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const url = fetchCall[0];
      const options = fetchCall[1];

      expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
      expect(options.headers["Authorization"]).toBe(`Bearer ${mockApiKey}`);
      expect(options.headers["Content-Type"]).toBe("application/json");
      expect(options.method).toBe("POST");
    });

    it("formats messages with system_prompt prepended (OpenAI-compatible)", async () => {
      const sseBody = createSSEStream([
        'data: {"choices":[{"delta":{"content":"ok"}}]}',
        "data: [DONE]",
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: sseBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      await adapter.generate({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: "Hello" }],
        system_prompt: "You are helpful",
      });

      const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
      expect(body.messages[0]).toEqual({ role: "system", content: "You are helpful" });
      expect(body.messages[1]).toEqual({ role: "user", content: "Hello" });
      expect(body.stream).toBe(true);
      expect(body.model).toBe("llama-3.3-70b-versatile");
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
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: "weather?" }],
        tools: [
          {
            name: "get_weather",
            description: "Get weather",
            parameters: { type: "object" },
          },
        ],
      });

      const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
      expect(body.tools[0].type).toBe("function");
      expect(body.tools[0].function.name).toBe("get_weather");
      expect(body.tool_choice).toBe("auto");
    });

    it("handles streaming response and collects text", async () => {
      const sseBody = createSSEStream([
        'data: {"choices":[{"delta":{"content":"Hello"}}]}',
        'data: {"choices":[{"delta":{"content":" world"}}]}',
        'data: {"x_groq":{"usage":{"prompt_tokens":5,"completion_tokens":3}}}',
        "data: [DONE]",
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: sseBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      const result = await adapter.generate({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: "Hi" }],
      });

      const collected = await result.collect();
      expect(collected.text).toBe("Hello world");
      expect(collected.usage.prompt_tokens).toBe(5);
      expect(collected.usage.completion_tokens).toBe(3);
    });

    it("throws on non-ok response", async () => {
      const mockResponse = new Response(
        JSON.stringify({ error: { message: "Invalid API Key" } }),
        { status: 401 }
      );

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      await expect(
        adapter.generate({
          model: "llama-3.3-70b-versatile",
          messages: [{ role: "user", content: "Hi" }],
        })
      ).rejects.toThrow("Invalid API Key");
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
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: "Test" }],
      });

      expect(getBreaker).toHaveBeenCalled();
    });
  });
});
