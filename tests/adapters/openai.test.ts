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

  describe("stream parsing – tool call accumulation", () => {
    it("accumulates tool call arguments across multiple chunks and emits on [DONE]", async () => {
      const sseBody = createSSEStream([
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_abc","type":"function","function":{"name":"get_weather","arguments":""}}]}}]}',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"ci"}}]}}]}',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"ty\\": \\"B"}}]}}]}',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"oston\\"}"}}]}}]}',
        "data: [DONE]",
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: sseBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      const result = await adapter.generate({
        model: "gpt-4o",
        messages: [{ role: "user", content: "weather?" }],
      });

      const collected = await result.collect();
      expect(collected.tool_calls).toHaveLength(1);
      expect(collected.tool_calls[0].id).toBe("call_abc");
      expect(collected.tool_calls[0].name).toBe("get_weather");
      expect(collected.tool_calls[0].arguments).toEqual({ city: "Boston" });
    });

    it("accumulates multiple parallel tool calls with different indices", async () => {
      const sseBody = createSSEStream([
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"get_weather","arguments":""}}]}}]}',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":1,"id":"call_2","type":"function","function":{"name":"get_time","arguments":""}}]}}]}',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"city\\": \\"NYC\\"}"}}]}}]}',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":1,"function":{"arguments":"{\\"tz\\": \\"EST\\"}"}}]}}]}',
        "data: [DONE]",
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: sseBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      const result = await adapter.generate({
        model: "gpt-4o",
        messages: [{ role: "user", content: "weather and time?" }],
      });

      const collected = await result.collect();
      expect(collected.tool_calls).toHaveLength(2);
      expect(collected.tool_calls[0]).toMatchObject({ id: "call_1", name: "get_weather", arguments: { city: "NYC" } });
      expect(collected.tool_calls[1]).toMatchObject({ id: "call_2", name: "get_time", arguments: { tz: "EST" } });
    });

    it("handles text content mixed with tool calls", async () => {
      const sseBody = createSSEStream([
        'data: {"choices":[{"delta":{"content":"Sure, "}}]}',
        'data: {"choices":[{"delta":{"content":"let me check."}}]}',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_x","type":"function","function":{"name":"search","arguments":"{\\"q\\":\\"test\\"}"}}]}}]}',
        "data: [DONE]",
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: sseBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      const result = await adapter.generate({
        model: "gpt-4o",
        messages: [{ role: "user", content: "search" }],
      });

      const collected = await result.collect();
      expect(collected.text).toBe("Sure, let me check.");
      expect(collected.tool_calls).toHaveLength(1);
      expect(collected.tool_calls[0].name).toBe("search");
    });

    it("yields empty args object when tool call JSON is malformed", async () => {
      const sseBody = createSSEStream([
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_bad","type":"function","function":{"name":"broken","arguments":"not valid json{{"}}]}}]}',
        "data: [DONE]",
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: sseBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      const result = await adapter.generate({
        model: "gpt-4o",
        messages: [{ role: "user", content: "test" }],
      });

      const collected = await result.collect();
      expect(collected.tool_calls).toHaveLength(1);
      expect(collected.tool_calls[0].name).toBe("broken");
      expect(collected.tool_calls[0].arguments).toEqual({});
    });
  });

  describe("formatMessages – image content", () => {
    it("formats image_url content blocks as OpenAI image_url type", async () => {
      const sseBody = createSSEStream([
        'data: {"choices":[{"delta":{"content":"I see"}}]}',
        "data: [DONE]",
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: sseBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      await adapter.generate({
        model: "gpt-4o",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "What is this?" },
              { type: "image_url", url: "https://example.com/photo.jpg" },
            ],
          },
        ],
      });

      const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
      expect(body.messages[0].content).toEqual([
        { type: "text", text: "What is this?" },
        { type: "image_url", image_url: { url: "https://example.com/photo.jpg" } },
      ]);
    });

    it("formats image_base64 content as data URI in image_url type", async () => {
      const sseBody = createSSEStream([
        'data: {"choices":[{"delta":{"content":"I see"}}]}',
        "data: [DONE]",
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: sseBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      await adapter.generate({
        model: "gpt-4o",
        messages: [
          {
            role: "user",
            content: [
              { type: "image_base64", data: "abc123", media_type: "image/jpeg" },
            ],
          },
        ],
      });

      const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
      expect(body.messages[0].content).toEqual([
        { type: "image_url", image_url: { url: "data:image/jpeg;base64,abc123" } },
      ]);
    });

    it("falls back to text for unknown content block types", async () => {
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
          {
            role: "user",
            content: [
              { type: "unknown_type" as any, text: "fallback" },
            ],
          },
        ],
      });

      const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
      expect(body.messages[0].content).toEqual([
        { type: "text", text: "fallback" },
      ]);
    });
  });

  describe("formatMessages – tool role", () => {
    it("formats tool result messages correctly", async () => {
      const sseBody = createSSEStream([
        'data: {"choices":[{"delta":{"content":"The weather is 72F"}}]}',
        "data: [DONE]",
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: sseBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      await adapter.generate({
        model: "gpt-4o",
        messages: [
          { role: "user", content: "weather?" },
          {
            role: "assistant",
            content: "",
            tool_calls: [{ id: "call_1", name: "get_weather", arguments: { city: "NYC" } }],
          },
          { role: "tool", tool_call_id: "call_1", content: '{"temp": 72}' },
        ],
      });

      const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);

      // messages[0] is user, messages[1] is assistant with tool_calls, messages[2] is tool result
      expect(body.messages[0].role).toBe("user");
      expect(body.messages[1].role).toBe("assistant");
      expect(body.messages[1].content).toBe("");
      expect(body.messages[1].tool_calls).toEqual([
        { id: "call_1", type: "function", function: { name: "get_weather", arguments: '{"city":"NYC"}' } },
      ]);

      // Tool result
      expect(body.messages[2]).toEqual({
        role: "tool",
        tool_call_id: "call_1",
        content: '{"temp": 72}',
      });
    });
  });

  describe("stream parsing – malformed/edge cases", () => {
    it("skips non-data lines and comments", async () => {
      const sseBody = createSSEStream([
        "event: message",
        ": comment",
        "",
        'data: {"choices":[{"delta":{"content":"Hello"}}]}',
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
      expect(collected.text).toBe("Hello");
    });

    it("skips invalid JSON in data lines", async () => {
      const sseBody = createSSEStream([
        "data: {not json",
        'data: {"choices":[{"delta":{"content":"works"}}]}',
        "data: [DONE]",
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: sseBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      const result = await adapter.generate({
        model: "gpt-4o",
        messages: [{ role: "user", content: "test" }],
      });

      const collected = await result.collect();
      expect(collected.text).toBe("works");
    });

    it("handles response with no body gracefully", async () => {
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: null });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      const result = await adapter.generate({
        model: "gpt-4o",
        messages: [{ role: "user", content: "test" }],
      });

      const collected = await result.collect();
      expect(collected.text).toBe("");
      expect(collected.tool_calls).toEqual([]);
    });

    it("throws generic error when non-ok response has no parseable JSON", async () => {
      const mockResponse = new Response("Bad Gateway", { status: 502 });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      await expect(
        adapter.generate({
          model: "gpt-4o",
          messages: [{ role: "user", content: "Hi" }],
        })
      ).rejects.toThrow("OpenAI API error: 502");
    });
  });

  describe("listModels", () => {
    it("returns models filtered to gpt/o1/o3/o4 names, sorted", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [
              { id: "gpt-4o" },
              { id: "gpt-3.5-turbo" },
              { id: "dall-e-3" },
              { id: "whisper-1" },
              { id: "o1-preview" },
              { id: "o3-mini" },
              { id: "o4-mini" },
            ],
          }),
          { status: 200 }
        )
      );

      const models = await adapter.listModels();
      expect(models).toEqual(["gpt-3.5-turbo", "gpt-4o", "o1-preview", "o3-mini", "o4-mini"]);
      expect(models).not.toContain("dall-e-3");
      expect(models).not.toContain("whisper-1");
    });

    it("returns empty array on non-ok response", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        new Response("Unauthorized", { status: 401 })
      );

      const models = await adapter.listModels();
      expect(models).toEqual([]);
    });

    it("returns empty array on network error", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Network error"));

      const models = await adapter.listModels();
      expect(models).toEqual([]);
    });

    it("returns empty array when data.data is missing", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        new Response(JSON.stringify({}), { status: 200 })
      );

      const models = await adapter.listModels();
      expect(models).toEqual([]);
    });
  });

  describe("isAvailable", () => {
    it("returns true when models endpoint responds ok", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        new Response(JSON.stringify({ data: [] }), { status: 200 })
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
  });
});
