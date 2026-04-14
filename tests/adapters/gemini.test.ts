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

  describe("stream parsing – functionCall in parts", () => {
    it("yields tool_call chunks for functionCall parts", async () => {
      const sseBody = createSSEStream([
        'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"get_weather","args":{"city":"NYC"}}}]}}]}',
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: sseBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      const result = await adapter.generate({
        model: "gemini-2.0-flash",
        messages: [{ role: "user", content: "weather?" }],
      });

      const collected = await result.collect();
      expect(collected.tool_calls).toHaveLength(1);
      expect(collected.tool_calls[0].name).toBe("get_weather");
      expect(collected.tool_calls[0].arguments).toEqual({ city: "NYC" });
      expect(collected.tool_calls[0].id).toMatch(/^gemini-/);
    });

    it("handles functionCall with no args", async () => {
      const sseBody = createSSEStream([
        'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"get_time"}}]}}]}',
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: sseBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      const result = await adapter.generate({
        model: "gemini-2.0-flash",
        messages: [{ role: "user", content: "time?" }],
      });

      const collected = await result.collect();
      expect(collected.tool_calls).toHaveLength(1);
      expect(collected.tool_calls[0].name).toBe("get_time");
      expect(collected.tool_calls[0].arguments).toEqual({});
    });

    it("handles multiple functionCall parts in one response", async () => {
      const sseBody = createSSEStream([
        'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"get_weather","args":{"city":"NYC"}}},{"functionCall":{"name":"get_time","args":{"tz":"EST"}}}]}}]}',
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: sseBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      const result = await adapter.generate({
        model: "gemini-2.0-flash",
        messages: [{ role: "user", content: "weather and time?" }],
      });

      const collected = await result.collect();
      expect(collected.tool_calls).toHaveLength(2);
      expect(collected.tool_calls[0].name).toBe("get_weather");
      expect(collected.tool_calls[1].name).toBe("get_time");
    });

    it("handles text mixed with functionCall parts", async () => {
      const sseBody = createSSEStream([
        'data: {"candidates":[{"content":{"parts":[{"text":"Let me check."}]}}]}',
        'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"search","args":{"q":"test"}}}]}}]}',
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: sseBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      const result = await adapter.generate({
        model: "gemini-2.0-flash",
        messages: [{ role: "user", content: "search" }],
      });

      const collected = await result.collect();
      expect(collected.text).toBe("Let me check.");
      expect(collected.tool_calls).toHaveLength(1);
      expect(collected.tool_calls[0].name).toBe("search");
    });
  });

  describe("formatContents – functionResponse (tool role)", () => {
    it("formats tool result messages as function role with functionResponse", async () => {
      const sseBody = createSSEStream([
        'data: {"candidates":[{"content":{"parts":[{"text":"The weather is 72F"}]}}]}',
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: sseBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      await adapter.generate({
        model: "gemini-2.0-flash",
        messages: [
          { role: "user", content: "weather?" },
          {
            role: "assistant",
            content: "",
            tool_calls: [{ id: "call_1", name: "get_weather", arguments: { city: "NYC" } }],
          },
          { role: "tool", name: "get_weather", content: '{"temp": 72}' },
        ],
      });

      const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);

      // Assistant with tool_calls becomes model with functionCall parts
      expect(body.contents[1].role).toBe("model");
      expect(body.contents[1].parts).toEqual([
        { functionCall: { name: "get_weather", args: { city: "NYC" } } },
      ]);

      // Tool result becomes function role with functionResponse
      expect(body.contents[2].role).toBe("function");
      expect(body.contents[2].parts).toEqual([
        { functionResponse: { name: "get_weather", response: { content: '{"temp": 72}' } } },
      ]);
    });

    it("uses 'tool' as default name when tool message has no name", async () => {
      const sseBody = createSSEStream([
        'data: {"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}',
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: sseBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      await adapter.generate({
        model: "gemini-2.0-flash",
        messages: [
          { role: "tool", content: "result data" },
        ],
      });

      const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
      expect(body.contents[0].parts[0].functionResponse.name).toBe("tool");
    });
  });

  describe("formatContents – image content", () => {
    it("formats image_base64 as inlineData", async () => {
      const sseBody = createSSEStream([
        'data: {"candidates":[{"content":{"parts":[{"text":"I see an image"}]}}]}',
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: sseBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      await adapter.generate({
        model: "gemini-2.0-flash",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "What is this?" },
              { type: "image_base64", data: "iVBORw0KGgo=", media_type: "image/png" },
            ],
          },
        ],
      });

      const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
      expect(body.contents[0].parts).toEqual([
        { text: "What is this?" },
        { inlineData: { mimeType: "image/png", data: "iVBORw0KGgo=" } },
      ]);
    });

    it("converts image_url to text placeholder", async () => {
      const sseBody = createSSEStream([
        'data: {"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}',
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: sseBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      await adapter.generate({
        model: "gemini-2.0-flash",
        messages: [
          {
            role: "user",
            content: [
              { type: "image_url", url: "https://example.com/img.png" },
            ],
          },
        ],
      });

      const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
      expect(body.contents[0].parts).toEqual([
        { text: "[Image: https://example.com/img.png]" },
      ]);
    });

    it("handles unknown content block types as text fallback", async () => {
      const sseBody = createSSEStream([
        'data: {"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}',
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: sseBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      await adapter.generate({
        model: "gemini-2.0-flash",
        messages: [
          {
            role: "user",
            content: [
              { type: "unknown_type" as any, text: "fallback text" },
            ],
          },
        ],
      });

      const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
      expect(body.contents[0].parts).toEqual([
        { text: "fallback text" },
      ]);
    });

    it("handles non-string content by JSON.stringifying it", async () => {
      const sseBody = createSSEStream([
        'data: {"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}',
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: sseBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      await adapter.generate({
        model: "gemini-2.0-flash",
        messages: [
          { role: "user", content: { key: "value" } as any },
        ],
      });

      const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
      expect(body.contents[0].parts[0].text).toBe('{"key":"value"}');
    });
  });

  describe("stream parsing – malformed/edge cases", () => {
    it("skips non-data lines", async () => {
      const sseBody = createSSEStream([
        "event: message",
        ": comment",
        "",
        'data: {"candidates":[{"content":{"parts":[{"text":"Hello"}]}}]}',
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
      expect(collected.text).toBe("Hello");
    });

    it("skips invalid JSON data lines", async () => {
      const sseBody = createSSEStream([
        "data: {broken json{{",
        'data: {"candidates":[{"content":{"parts":[{"text":"works"}]}}]}',
        "data: also not json",
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: sseBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      const result = await adapter.generate({
        model: "gemini-2.0-flash",
        messages: [{ role: "user", content: "test" }],
      });

      const collected = await result.collect();
      expect(collected.text).toBe("works");
    });

    it("handles response with no body", async () => {
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: null });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      const result = await adapter.generate({
        model: "gemini-2.0-flash",
        messages: [{ role: "user", content: "test" }],
      });

      const collected = await result.collect();
      expect(collected.text).toBe("");
      expect(collected.tool_calls).toEqual([]);
    });

    it("handles empty data: lines", async () => {
      const sseBody = createSSEStream([
        "data: ",
        "data:  ",
        'data: {"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}',
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: sseBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      const result = await adapter.generate({
        model: "gemini-2.0-flash",
        messages: [{ role: "user", content: "test" }],
      });

      const collected = await result.collect();
      expect(collected.text).toBe("ok");
    });

    it("throws generic error when non-ok response has unparseable body", async () => {
      const mockResponse = new Response("Internal Server Error", { status: 500 });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      await expect(
        adapter.generate({
          model: "gemini-2.0-flash",
          messages: [{ role: "user", content: "Hi" }],
        })
      ).rejects.toThrow("Gemini API error: 500");
    });

    it("accumulates usageMetadata across multiple chunks", async () => {
      const sseBody = createSSEStream([
        'data: {"candidates":[{"content":{"parts":[{"text":"Hello"}]}}],"usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":1}}',
        'data: {"candidates":[{"content":{"parts":[{"text":" world"}]}}],"usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":5}}',
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
      expect(collected.usage.prompt_tokens).toBe(10);
      expect(collected.usage.completion_tokens).toBe(5);
    });
  });

  describe("listModels", () => {
    it("returns gemini models filtered and sorted", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        new Response(
          JSON.stringify({
            models: [
              { name: "models/gemini-2.0-flash" },
              { name: "models/gemini-1.5-pro" },
              { name: "models/text-bison-001" },
              { name: "models/gemini-1.5-flash" },
            ],
          }),
          { status: 200 }
        )
      );

      const models = await adapter.listModels();
      expect(models).toEqual(["gemini-1.5-flash", "gemini-1.5-pro", "gemini-2.0-flash"]);
      expect(models).not.toContain("text-bison-001");
    });

    it("returns empty array on non-ok response", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        new Response("Forbidden", { status: 403 })
      );

      const models = await adapter.listModels();
      expect(models).toEqual([]);
    });

    it("returns empty array on network error", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Network error"));

      const models = await adapter.listModels();
      expect(models).toEqual([]);
    });

    it("returns empty array when models field is missing", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        new Response(JSON.stringify({}), { status: 200 })
      );

      const models = await adapter.listModels();
      expect(models).toEqual([]);
    });

    it("sends x-goog-api-key header to list models endpoint", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        new Response(JSON.stringify({ models: [] }), { status: 200 })
      );

      await adapter.listModels();

      const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(fetchCall[0]).toContain("/v1beta/models");
      expect(fetchCall[1].headers["x-goog-api-key"]).toBe(mockApiKey);
    });
  });

  describe("isAvailable", () => {
    it("returns true when models endpoint responds ok", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        new Response(JSON.stringify({ models: [] }), { status: 200 })
      );

      expect(await adapter.isAvailable()).toBe(true);
    });

    it("returns false when models endpoint returns non-ok", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        new Response("Unauthorized", { status: 401 })
      );

      expect(await adapter.isAvailable()).toBe(false);
    });

    it("returns false when fetch throws", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Timeout"));

      expect(await adapter.isAvailable()).toBe(false);
    });

    it("sends x-goog-api-key header to isAvailable check", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        new Response(JSON.stringify({ models: [] }), { status: 200 })
      );

      await adapter.isAvailable();

      const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(fetchCall[1].headers["x-goog-api-key"]).toBe(mockApiKey);
    });
  });

  describe("formatContents – system messages are skipped", () => {
    it("skips system role messages from contents", async () => {
      const sseBody = createSSEStream([
        'data: {"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}',
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: sseBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      await adapter.generate({
        model: "gemini-2.0-flash",
        messages: [
          { role: "system", content: "You are helpful" },
          { role: "user", content: "Hello" },
        ],
      });

      const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
      expect(body.contents).toHaveLength(1);
      expect(body.contents[0].role).toBe("user");
    });
  });
});
