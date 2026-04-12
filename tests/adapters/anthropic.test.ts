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

    it("returns false for empty string", async () => {
      const a = new AnthropicAdapter("");
      expect(await a.isAvailable()).toBe(false);
    });

    it("returns false for non-string value coerced", async () => {
      const a = new AnthropicAdapter(undefined as any);
      expect(await a.isAvailable()).toBe(false);
    });
  });

  describe("stream parsing – tool_use blocks", () => {
    it("accumulates tool call arguments across multiple input_json_delta chunks", async () => {
      const sseBody = createSSEStream([
        'data: {"type":"message_start","message":{"usage":{"input_tokens":15}}}',
        'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_01","name":"get_weather"}}',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"ci"}}',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"ty\\": \\"San"}}',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":" Francisco\\"}"}}',
        'data: {"type":"content_block_stop","index":0}',
        'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":20}}',
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: sseBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      const result = await adapter.generate({
        model: "claude-3-5-sonnet-20241022",
        messages: [{ role: "user", content: "What is the weather?" }],
        tools: [{ name: "get_weather", description: "Get weather", parameters: { type: "object", properties: { city: { type: "string" } } } }],
      });

      const collected = await result.collect();
      expect(collected.tool_calls).toHaveLength(1);
      expect(collected.tool_calls[0].id).toBe("toolu_01");
      expect(collected.tool_calls[0].name).toBe("get_weather");
      expect(collected.tool_calls[0].arguments).toEqual({ city: "San Francisco" });
    });

    it("handles multiple tool_use blocks in one response", async () => {
      const sseBody = createSSEStream([
        'data: {"type":"message_start","message":{"usage":{"input_tokens":10}}}',
        'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_01","name":"get_weather"}}',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"city\\": \\"NYC\\"}"}}',
        'data: {"type":"content_block_stop","index":0}',
        'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_02","name":"get_time"}}',
        'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"tz\\": \\"EST\\"}"}}',
        'data: {"type":"content_block_stop","index":1}',
        'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":30}}',
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: sseBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      const result = await adapter.generate({
        model: "claude-3-5-sonnet-20241022",
        messages: [{ role: "user", content: "weather and time?" }],
      });

      const collected = await result.collect();
      expect(collected.tool_calls).toHaveLength(2);
      expect(collected.tool_calls[0]).toMatchObject({ id: "toolu_01", name: "get_weather", arguments: { city: "NYC" } });
      expect(collected.tool_calls[1]).toMatchObject({ id: "toolu_02", name: "get_time", arguments: { tz: "EST" } });
    });

    it("handles text followed by a tool_use block", async () => {
      const sseBody = createSSEStream([
        'data: {"type":"message_start","message":{"usage":{"input_tokens":10}}}',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Let me check "}}',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"the weather."}}',
        'data: {"type":"content_block_stop","index":0}',
        'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_03","name":"get_weather"}}',
        'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"city\\": \\"LA\\"}"}}',
        'data: {"type":"content_block_stop","index":1}',
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: sseBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      const result = await adapter.generate({
        model: "claude-3-5-sonnet-20241022",
        messages: [{ role: "user", content: "weather in LA?" }],
      });

      const collected = await result.collect();
      expect(collected.text).toBe("Let me check the weather.");
      expect(collected.tool_calls).toHaveLength(1);
      expect(collected.tool_calls[0].arguments).toEqual({ city: "LA" });
    });

    it("yields empty args object when tool call JSON is malformed", async () => {
      const sseBody = createSSEStream([
        'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_bad","name":"broken_tool"}}',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"not valid json{{"}}',
        'data: {"type":"content_block_stop","index":0}',
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: sseBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      const result = await adapter.generate({
        model: "claude-3-5-sonnet-20241022",
        messages: [{ role: "user", content: "test" }],
      });

      const collected = await result.collect();
      expect(collected.tool_calls).toHaveLength(1);
      expect(collected.tool_calls[0].name).toBe("broken_tool");
      expect(collected.tool_calls[0].arguments).toEqual({});
    });
  });

  describe("formatMessages – image content", () => {
    it("formats image_base64 content blocks", async () => {
      const sseBody = createSSEStream([
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"I see an image"}}',
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: sseBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      await adapter.generate({
        model: "claude-3-5-sonnet-20241022",
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
      expect(body.messages[0].content).toEqual([
        { type: "text", text: "What is this?" },
        { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } },
      ]);
    });

    it("converts image_url blocks to text placeholders (Anthropic does not natively support URLs)", async () => {
      const sseBody = createSSEStream([
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ok"}}',
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: sseBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      await adapter.generate({
        model: "claude-3-5-sonnet-20241022",
        messages: [
          {
            role: "user",
            content: [
              { type: "image_url", url: "https://example.com/photo.jpg" },
            ],
          },
        ],
      });

      const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
      expect(body.messages[0].content).toEqual([
        { type: "text", text: "[Image: https://example.com/photo.jpg]" },
      ]);
    });

    it("handles unknown content block types as text fallback", async () => {
      const sseBody = createSSEStream([
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ok"}}',
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: sseBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      await adapter.generate({
        model: "claude-3-5-sonnet-20241022",
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
      expect(body.messages[0].content).toEqual([
        { type: "text", text: "fallback text" },
      ]);
    });
  });

  describe("formatMessages – tool role messages", () => {
    it("formats tool result messages as user role with tool_result content", async () => {
      const sseBody = createSSEStream([
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ok"}}',
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: sseBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      await adapter.generate({
        model: "claude-3-5-sonnet-20241022",
        messages: [
          { role: "user", content: "weather?" },
          {
            role: "assistant",
            content: "",
            tool_calls: [{ id: "toolu_01", name: "get_weather", arguments: { city: "NYC" } }],
          },
          { role: "tool", tool_call_id: "toolu_01", content: '{"temp": 72}' },
        ],
      });

      const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);

      // Assistant with tool_calls
      expect(body.messages[1].role).toBe("assistant");
      expect(body.messages[1].content).toEqual([
        { type: "tool_use", id: "toolu_01", name: "get_weather", input: { city: "NYC" } },
      ]);

      // Tool result as user message
      expect(body.messages[2].role).toBe("user");
      expect(body.messages[2].content).toEqual([
        { type: "tool_result", tool_use_id: "toolu_01", content: '{"temp": 72}' },
      ]);
    });

    it("formats assistant tool_calls with preceding text content", async () => {
      const sseBody = createSSEStream([
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ok"}}',
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: sseBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      await adapter.generate({
        model: "claude-3-5-sonnet-20241022",
        messages: [
          { role: "user", content: "weather?" },
          {
            role: "assistant",
            content: "Let me check",
            tool_calls: [{ id: "toolu_01", name: "get_weather", arguments: { city: "NYC" } }],
          },
        ],
      });

      const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
      expect(body.messages[1].content).toEqual([
        { type: "text", text: "Let me check" },
        { type: "tool_use", id: "toolu_01", name: "get_weather", input: { city: "NYC" } },
      ]);
    });
  });

  describe("stream parsing – malformed/edge cases", () => {
    it("skips lines that are not data: prefixed", async () => {
      const sseBody = createSSEStream([
        "event: message_start",
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}',
        ": this is a comment",
        "",
        'data: {"type":"message_delta","usage":{"output_tokens":3}}',
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: sseBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      const result = await adapter.generate({
        model: "claude-3-5-sonnet-20241022",
        messages: [{ role: "user", content: "Hi" }],
      });

      const collected = await result.collect();
      expect(collected.text).toBe("Hello");
    });

    it("skips data lines with invalid JSON without crashing", async () => {
      const sseBody = createSSEStream([
        "data: {invalid json{{{",
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"works"}}',
        "data: also not json",
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: sseBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      const result = await adapter.generate({
        model: "claude-3-5-sonnet-20241022",
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
        model: "claude-3-5-sonnet-20241022",
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
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ok"}}',
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: sseBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      const result = await adapter.generate({
        model: "claude-3-5-sonnet-20241022",
        messages: [{ role: "user", content: "test" }],
      });

      const collected = await result.collect();
      expect(collected.text).toBe("ok");
    });

    it("throws generic error when non-ok response has no JSON body", async () => {
      const mockResponse = new Response("Internal Server Error", { status: 500 });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      await expect(
        adapter.generate({
          model: "claude-3-5-sonnet-20241022",
          messages: [{ role: "user", content: "Hi" }],
        })
      ).rejects.toThrow("Anthropic API error: 500");
    });
  });

  describe("listModels – edge cases", () => {
    it("returns array containing all expected model names", async () => {
      const models = await adapter.listModels();
      expect(models).toContain("claude-3-5-haiku-20241022");
      expect(models).toContain("claude-3-opus-20240229");
      expect(models).toContain("claude-3-haiku-20240307");
      expect(models.length).toBe(6);
    });

    it("returns the same static list on repeated calls", async () => {
      const first = await adapter.listModels();
      const second = await adapter.listModels();
      expect(first).toEqual(second);
    });
  });
});
