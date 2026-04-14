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

import { OpenRouterAdapter } from "../../src/adapters/openrouter.adapter.js";
import { validateSafeUrl } from "../../src/lib/ssrf.js";
import { getBreaker } from "../../src/lib/breaker.js";

describe("OpenRouterAdapter", () => {
  let adapter: OpenRouterAdapter;
  const mockApiKey = "sk-or-test-key-123";

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new OpenRouterAdapter(mockApiKey);
    vi.stubGlobal("fetch", vi.fn());
  });

  describe("constructor", () => {
    it("sets providerId to 'openrouter'", () => {
      expect(adapter.providerId).toBe("openrouter");
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
        model: "openai/gpt-4o",
        messages: [{ role: "user", content: "Hi" }],
      });

      expect(validateSafeUrl).toHaveBeenCalledWith("https://openrouter.ai/api/v1");
    });

    it("sends correct headers including OpenRouter-specific ones", async () => {
      const sseBody = createSSEStream([
        'data: {"choices":[{"delta":{"content":"Hello"}}]}',
        "data: [DONE]",
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: sseBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      await adapter.generate({
        model: "openai/gpt-4o",
        messages: [{ role: "user", content: "Hello" }],
      });

      const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const url = fetchCall[0];
      const options = fetchCall[1];

      expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
      expect(options.method).toBe("POST");
      expect(options.headers["Content-Type"]).toBe("application/json");
      expect(options.headers["Authorization"]).toBe(`Bearer ${mockApiKey}`);
      expect(options.headers["HTTP-Referer"]).toBe("https://aibyai.app");
      expect(options.headers["X-Title"]).toBe("AIBYAI Council");
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
        model: "openai/gpt-4o",
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
      expect(body.model).toBe("openai/gpt-4o");
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
        model: "openai/gpt-4o",
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
        model: "openai/gpt-4o",
        messages: [{ role: "user", content: "Hi" }],
      });

      const collected = await result.collect();
      expect(collected.text).toBe("Hello world");
      expect(collected.usage.prompt_tokens).toBe(8);
      expect(collected.usage.completion_tokens).toBe(2);
    });

    it("throws on non-ok response with error message", async () => {
      const mockResponse = new Response(
        JSON.stringify({ error: { message: "Rate limit exceeded" } }),
        { status: 429 }
      );

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      await expect(
        adapter.generate({
          model: "openai/gpt-4o",
          messages: [{ role: "user", content: "Hi" }],
        })
      ).rejects.toThrow("Rate limit exceeded");
    });

    it("throws generic error when response has no error message", async () => {
      const mockResponse = new Response("{}", { status: 500 });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      await expect(
        adapter.generate({
          model: "openai/gpt-4o",
          messages: [{ role: "user", content: "Hi" }],
        })
      ).rejects.toThrow("OpenRouter API error: 500");
    });

    it("throws generic error when response body is not JSON", async () => {
      const mockResponse = new Response("Internal Server Error", { status: 500 });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      await expect(
        adapter.generate({
          model: "openai/gpt-4o",
          messages: [{ role: "user", content: "Hi" }],
        })
      ).rejects.toThrow("OpenRouter API error: 500");
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
        model: "openai/gpt-4o",
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
        model: "openai/gpt-4o",
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

    it("omits optional params when not provided", async () => {
      const sseBody = createSSEStream([
        'data: {"choices":[{"delta":{"content":"ok"}}]}',
        "data: [DONE]",
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: sseBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      await adapter.generate({
        model: "openai/gpt-4o",
        messages: [{ role: "user", content: "Test" }],
      });

      const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
      expect(body.temperature).toBeUndefined();
      expect(body.top_p).toBeUndefined();
      expect(body.max_tokens).toBeUndefined();
      expect(body.tools).toBeUndefined();
      expect(body.tool_choice).toBeUndefined();
    });

    it("throws when SSRF validation rejects the URL", async () => {
      (validateSafeUrl as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("SSRF: blocked private IP")
      );

      await expect(
        adapter.generate({
          model: "openai/gpt-4o",
          messages: [{ role: "user", content: "Hi" }],
        })
      ).rejects.toThrow("SSRF: blocked private IP");
    });
  });

  describe("formatMessages", () => {
    it("formats plain text messages", async () => {
      const sseBody = createSSEStream([
        'data: {"choices":[{"delta":{"content":"ok"}}]}',
        "data: [DONE]",
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: sseBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      await adapter.generate({
        model: "openai/gpt-4o",
        messages: [{ role: "user", content: "Hello world" }],
      });

      const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
      expect(body.messages).toEqual([{ role: "user", content: "Hello world" }]);
    });

    it("formats non-string content as JSON string", async () => {
      const sseBody = createSSEStream([
        'data: {"choices":[{"delta":{"content":"ok"}}]}',
        "data: [DONE]",
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: sseBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      const imageContent = [
        { type: "text", text: "What is this?" },
        { type: "image_url", image_url: { url: "https://example.com/img.png" } },
      ];

      await adapter.generate({
        model: "openai/gpt-4o",
        messages: [{ role: "user", content: imageContent as any }],
      });

      const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
      expect(body.messages[0].role).toBe("user");
      expect(body.messages[0].content).toBe(JSON.stringify(imageContent));
    });

    it("formats tool result messages with tool_call_id", async () => {
      const sseBody = createSSEStream([
        'data: {"choices":[{"delta":{"content":"ok"}}]}',
        "data: [DONE]",
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: sseBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      await adapter.generate({
        model: "openai/gpt-4o",
        messages: [
          {
            role: "tool",
            tool_call_id: "call_abc123",
            content: '{"temp": 72}',
          },
        ],
      });

      const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
      expect(body.messages[0]).toEqual({
        role: "tool",
        tool_call_id: "call_abc123",
        content: '{"temp": 72}',
      });
    });

    it("formats tool result messages with non-string content as JSON", async () => {
      const sseBody = createSSEStream([
        'data: {"choices":[{"delta":{"content":"ok"}}]}',
        "data: [DONE]",
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: sseBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      await adapter.generate({
        model: "openai/gpt-4o",
        messages: [
          {
            role: "tool",
            tool_call_id: "call_abc123",
            content: { temp: 72, unit: "F" } as any,
          },
        ],
      });

      const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
      expect(body.messages[0]).toEqual({
        role: "tool",
        tool_call_id: "call_abc123",
        content: JSON.stringify({ temp: 72, unit: "F" }),
      });
    });

    it("formats messages with tool_calls (assistant requesting tools)", async () => {
      const sseBody = createSSEStream([
        'data: {"choices":[{"delta":{"content":"ok"}}]}',
        "data: [DONE]",
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: sseBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      await adapter.generate({
        model: "openai/gpt-4o",
        messages: [
          {
            role: "assistant",
            content: "Let me check the weather",
            tool_calls: [
              {
                id: "call_abc",
                name: "get_weather",
                arguments: { city: "London" },
              },
            ],
          },
        ],
      });

      const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
      expect(body.messages[0]).toEqual({
        role: "assistant",
        content: "Let me check the weather",
        tool_calls: [
          {
            id: "call_abc",
            type: "function",
            function: {
              name: "get_weather",
              arguments: JSON.stringify({ city: "London" }),
            },
          },
        ],
      });
    });

    it("sets content to null for assistant tool_calls with non-string content", async () => {
      const sseBody = createSSEStream([
        'data: {"choices":[{"delta":{"content":"ok"}}]}',
        "data: [DONE]",
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: sseBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      await adapter.generate({
        model: "openai/gpt-4o",
        messages: [
          {
            role: "assistant",
            content: ["some", "array"] as any,
            tool_calls: [
              {
                id: "call_xyz",
                name: "search",
                arguments: { query: "test" },
              },
            ],
          },
        ],
      });

      const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
      expect(body.messages[0].content).toBeNull();
    });
  });

  describe("streaming tool calls", () => {
    it("parses streamed tool calls and emits them at DONE", async () => {
      const sseBody = createSSEStream([
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"get_weather","arguments":""}}]}}]}',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"city\\""}}]}}]}',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":": \\"London\\"}"}}]}}]}',
        'data: {"usage":{"prompt_tokens":10,"completion_tokens":5}}',
        "data: [DONE]",
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: sseBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      const result = await adapter.generate({
        model: "openai/gpt-4o",
        messages: [{ role: "user", content: "weather?" }],
      });

      const collected = await result.collect();
      expect(collected.tool_calls).toHaveLength(1);
      expect(collected.tool_calls[0]).toEqual({
        id: "call_1",
        name: "get_weather",
        arguments: { city: "London" },
      });
      expect(collected.usage.prompt_tokens).toBe(10);
      expect(collected.usage.completion_tokens).toBe(5);
    });

    it("parses multiple parallel tool calls in a stream", async () => {
      const sseBody = createSSEStream([
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"get_weather","arguments":""}},{"index":1,"id":"call_2","function":{"name":"get_time","arguments":""}}]}}]}',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"city\\": \\"Paris\\"}"}},{"index":1,"function":{"arguments":"{\\"tz\\": \\"UTC\\"}"}}]}}]}',
        "data: [DONE]",
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: sseBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      const result = await adapter.generate({
        model: "openai/gpt-4o",
        messages: [{ role: "user", content: "weather and time?" }],
      });

      const collected = await result.collect();
      expect(collected.tool_calls).toHaveLength(2);
      expect(collected.tool_calls[0]).toEqual({
        id: "call_1",
        name: "get_weather",
        arguments: { city: "Paris" },
      });
      expect(collected.tool_calls[1]).toEqual({
        id: "call_2",
        name: "get_time",
        arguments: { tz: "UTC" },
      });
    });

    it("handles tool calls with invalid JSON arguments gracefully", async () => {
      const sseBody = createSSEStream([
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_bad","function":{"name":"broken","arguments":"not-json"}}]}}]}',
        "data: [DONE]",
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: sseBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      const result = await adapter.generate({
        model: "openai/gpt-4o",
        messages: [{ role: "user", content: "test" }],
      });

      const collected = await result.collect();
      expect(collected.tool_calls).toHaveLength(1);
      expect(collected.tool_calls[0].id).toBe("call_bad");
      expect(collected.tool_calls[0].name).toBe("broken");
      expect(collected.tool_calls[0].arguments).toEqual({});
    });

    it("handles mixed text and tool calls in stream", async () => {
      const sseBody = createSSEStream([
        'data: {"choices":[{"delta":{"content":"Let me check"}}]}',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_mix","function":{"name":"search","arguments":"{\\"q\\": \\"test\\"}"}}]}}]}',
        "data: [DONE]",
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: sseBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      const result = await adapter.generate({
        model: "openai/gpt-4o",
        messages: [{ role: "user", content: "search for test" }],
      });

      const collected = await result.collect();
      expect(collected.text).toBe("Let me check");
      expect(collected.tool_calls).toHaveLength(1);
      expect(collected.tool_calls[0].name).toBe("search");
    });
  });

  describe("streaming edge cases", () => {
    it("handles empty response body", async () => {
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: null });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      const result = await adapter.generate({
        model: "openai/gpt-4o",
        messages: [{ role: "user", content: "Hi" }],
      });

      const collected = await result.collect();
      expect(collected.text).toBe("");
      expect(collected.tool_calls).toEqual([]);
    });

    it("skips non-SSE lines in stream", async () => {
      const sseBody = createSSEStream([
        ": this is a comment",
        "",
        'data: {"choices":[{"delta":{"content":"ok"}}]}',
        "event: ping",
        "data: [DONE]",
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: sseBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      const result = await adapter.generate({
        model: "openai/gpt-4o",
        messages: [{ role: "user", content: "Hi" }],
      });

      const collected = await result.collect();
      expect(collected.text).toBe("ok");
    });

    it("skips malformed JSON in stream data", async () => {
      const sseBody = createSSEStream([
        "data: {broken json",
        'data: {"choices":[{"delta":{"content":"fine"}}]}',
        "data: [DONE]",
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: sseBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      const result = await adapter.generate({
        model: "openai/gpt-4o",
        messages: [{ role: "user", content: "Hi" }],
      });

      const collected = await result.collect();
      expect(collected.text).toBe("fine");
    });
  });

  describe("listModels", () => {
    it("returns sorted model IDs from API", async () => {
      const mockResponse = new Response(
        JSON.stringify({
          data: [
            { id: "openai/gpt-4o" },
            { id: "anthropic/claude-3.5-sonnet" },
            { id: "meta-llama/llama-3-70b" },
          ],
        }),
        { status: 200 }
      );

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      const models = await adapter.listModels();
      expect(models).toEqual([
        "anthropic/claude-3.5-sonnet",
        "meta-llama/llama-3-70b",
        "openai/gpt-4o",
      ]);

      const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(fetchCall[0]).toBe("https://openrouter.ai/api/v1/models");
      expect(fetchCall[1].headers["Authorization"]).toBe(`Bearer ${mockApiKey}`);
    });

    it("returns empty array on non-ok response", async () => {
      const mockResponse = new Response("", { status: 401 });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      const models = await adapter.listModels();
      expect(models).toEqual([]);
    });

    it("returns empty array on fetch error", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Network error"));

      const models = await adapter.listModels();
      expect(models).toEqual([]);
    });

    it("returns empty array when data field is missing", async () => {
      const mockResponse = new Response(JSON.stringify({}), { status: 200 });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      const models = await adapter.listModels();
      expect(models).toEqual([]);
    });
  });

  describe("isAvailable", () => {
    it("returns true when API responds with ok", async () => {
      const mockResponse = new Response(JSON.stringify({ data: [] }), { status: 200 });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      const available = await adapter.isAvailable();
      expect(available).toBe(true);

      const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(fetchCall[0]).toBe("https://openrouter.ai/api/v1/models");
      expect(fetchCall[1].headers["Authorization"]).toBe(`Bearer ${mockApiKey}`);
    });

    it("returns false when API responds with error", async () => {
      const mockResponse = new Response("", { status: 401 });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      const available = await adapter.isAvailable();
      expect(available).toBe(false);
    });

    it("returns false on fetch error", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Network error"));

      const available = await adapter.isAvailable();
      expect(available).toBe(false);
    });
  });
});
