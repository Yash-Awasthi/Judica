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

import { GeminiAdapter } from "../../src/adapters/gemini.adapter.js";
import { validateSafeUrl } from "../../src/lib/ssrf.js";
import { getBreaker } from "../../src/lib/breaker.js";

describe("GeminiAdapter", () => {
  let adapter: GeminiAdapter;
  const mockApiKey = "AIzaSyTest123";

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new GeminiAdapter(mockApiKey);
    vi.stubGlobal("fetch", vi.fn());
  });

  describe("constructor", () => {
    it("sets providerId to 'gemini'", () => {
      expect(adapter.providerId).toBe("gemini");
    });
  });

  describe("generate", () => {
    it("validates the base URL via SSRF check", async () => {
      const sseBody = createSSEStream([
        'data: {"candidates":[{"content":{"parts":[{"text":"Hi"}]}}]}',
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: sseBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      await adapter.generate({
        model: "gemini-2.0-flash",
        messages: [{ role: "user", content: "Hi" }],
      });

      expect(validateSafeUrl).toHaveBeenCalledWith(
        "https://generativelanguage.googleapis.com"
      );
    });

    it("sends correct x-goog-api-key header", async () => {
      const sseBody = createSSEStream([
        'data: {"candidates":[{"content":{"parts":[{"text":"Hello"}]}}]}',
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: sseBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      await adapter.generate({
        model: "gemini-2.0-flash",
        messages: [{ role: "user", content: "Hello" }],
      });

      const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const url = fetchCall[0] as string;
      const options = fetchCall[1];

      expect(url).toContain("generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent");
      expect(url).toContain("alt=sse");
      expect(options.headers["x-goog-api-key"]).toBe(mockApiKey);
      expect(options.headers["Content-Type"]).toBe("application/json");
      expect(options.method).toBe("POST");
    });

    it("formats messages as Gemini contents with role mapping", async () => {
      const sseBody = createSSEStream([
        'data: {"candidates":[{"content":{"parts":[{"text":"response"}]}}]}',
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: sseBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      await adapter.generate({
        model: "gemini-2.0-flash",
        messages: [
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Hi there" },
          { role: "user", content: "How are you?" },
        ],
        system_prompt: "You are helpful",
      });

      const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);

      // System prompt goes into systemInstruction
      expect(body.systemInstruction).toEqual({ parts: [{ text: "You are helpful" }] });

      // Messages mapped: assistant -> model
      expect(body.contents).toEqual([
        { role: "user", parts: [{ text: "Hello" }] },
        { role: "model", parts: [{ text: "Hi there" }] },
        { role: "user", parts: [{ text: "How are you?" }] },
      ]);
    });

    it("includes generationConfig with temperature, maxOutputTokens, topP", async () => {
      const sseBody = createSSEStream([
        'data: {"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}',
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: sseBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      await adapter.generate({
        model: "gemini-2.0-flash",
        messages: [{ role: "user", content: "Test" }],
        temperature: 0.7,
        top_p: 0.9,
        max_tokens: 1024,
      });

      const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
      expect(body.generationConfig.temperature).toBe(0.7);
      expect(body.generationConfig.topP).toBe(0.9);
      expect(body.generationConfig.maxOutputTokens).toBe(1024);
    });

    it("formats tools as function_declarations", async () => {
      const sseBody = createSSEStream([
        'data: {"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}',
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: sseBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      await adapter.generate({
        model: "gemini-2.0-flash",
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
          function_declarations: [
            {
              name: "get_weather",
              description: "Get weather",
              parameters: { type: "object", properties: { city: { type: "string" } } },
            },
          ],
        },
      ]);
    });

    it("handles streaming response and collects text", async () => {
      const sseBody = createSSEStream([
        'data: {"candidates":[{"content":{"parts":[{"text":"Hello"}]}}]}',
        'data: {"candidates":[{"content":{"parts":[{"text":" world"}]}}],"usageMetadata":{"promptTokenCount":5,"candidatesTokenCount":2}}',
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: sseBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      const result = await adapter.generate({
        model: "gemini-2.0-flash",
        messages: [{ role: "user", content: "Hi" }],
      });

      const collected = await result.collect();
      expect(collected.text).toBe("Hello world");
      expect(collected.usage.prompt_tokens).toBe(5);
      expect(collected.usage.completion_tokens).toBe(2);
    });

    it("throws on non-ok response", async () => {
      const mockResponse = new Response(
        JSON.stringify({ error: { message: "API key invalid" } }),
        { status: 400 }
      );

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      await expect(
        adapter.generate({
          model: "gemini-2.0-flash",
          messages: [{ role: "user", content: "Hi" }],
        })
      ).rejects.toThrow("API key invalid");
    });

    it("uses circuit breaker", async () => {
      const sseBody = createSSEStream([
        'data: {"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}',
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: sseBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      await adapter.generate({
        model: "gemini-2.0-flash",
        messages: [{ role: "user", content: "Test" }],
      });

      expect(getBreaker).toHaveBeenCalled();
    });

    it("defaults model to gemini-2.0-flash when not specified", async () => {
      const sseBody = createSSEStream([
        'data: {"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}',
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: sseBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      await adapter.generate({
        model: "",
        messages: [{ role: "user", content: "Test" }],
      });

      const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(url).toContain("gemini-2.0-flash:streamGenerateContent");
    });
  });
});
