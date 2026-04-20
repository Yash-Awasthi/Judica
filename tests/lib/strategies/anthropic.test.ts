import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock fetch globally
vi.stubGlobal("fetch", vi.fn());

// Mock the tools module
vi.mock("../../../src/lib/tools/index.js", () => ({
  getToolDefinitions: vi.fn().mockReturnValue([]),
  callTool: vi.fn().mockResolvedValue("tool result"),
}));

import { askAnthropic, streamAnthropic } from "../../../src/lib/strategies/anthropic.js";
import type { Provider, Message } from "../../../src/lib/providers.js";

function makeProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    name: "anthropic",
    apiKey: "sk-ant-test-key",
    model: "claude-3-5-sonnet-20241022",
    systemPrompt: "",
    tools: [],
    ...overrides,
  } as Provider;
}

describe("Anthropic Strategy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("askAnthropic", () => {
    it("sends request to Anthropic API with correct headers", async () => {
      const mockData = {
        content: [{ type: "text", text: "Hello!" }],
        usage: { input_tokens: 10, output_tokens: 5 },
      };

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockData),
      });

      const provider = makeProvider();
      const messages: Message[] = [{ role: "user", content: "Hi" }];

      const result = await askAnthropic(provider, messages, 4096, AbortSignal.timeout(30000));

      const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(fetchCall[0]).toBe("https://api.anthropic.com/v1/messages");

      const options = fetchCall[1];
      expect(options.headers["x-api-key"]).toBe("sk-ant-test-key");
      expect(options.headers["anthropic-version"]).toBe("2023-10-01");
      expect(options.headers["Content-Type"]).toBe("application/json");
      expect(options.method).toBe("POST");
    });

    it("sends model and max_tokens in request body", async () => {
      const mockData = {
        content: [{ type: "text", text: "Response" }],
        usage: { input_tokens: 5, output_tokens: 3 },
      };

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockData),
      });

      const provider = makeProvider({ model: "claude-3-5-haiku-20241022" });
      const messages: Message[] = [{ role: "user", content: "Hello" }];

      await askAnthropic(provider, messages, 2048, AbortSignal.timeout(30000));

      const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
      expect(body.model).toBe("claude-3-5-haiku-20241022");
      expect(body.max_tokens).toBe(2048);
    });

    it("includes system prompt when provided", async () => {
      const mockData = {
        content: [{ type: "text", text: "Ok" }],
        usage: { input_tokens: 5, output_tokens: 1 },
      };

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockData),
      });

      const provider = makeProvider({ systemPrompt: "You are helpful" });
      const messages: Message[] = [{ role: "user", content: "Hi" }];

      await askAnthropic(provider, messages, 4096, AbortSignal.timeout(30000));

      const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
      expect(body.system).toBe("You are helpful");
    });

    it("returns text and usage from response", async () => {
      const mockData = {
        content: [{ type: "text", text: "Hello from Claude!" }],
        usage: { input_tokens: 10, output_tokens: 5 },
      };

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockData),
      });

      const provider = makeProvider();
      const messages: Message[] = [{ role: "user", content: "Hi" }];

      const result = await askAnthropic(provider, messages, 4096, AbortSignal.timeout(30000));

      expect(result.text).toBe("Hello from Claude!");
      expect(result.usage.promptTokens).toBe(10);
      expect(result.usage.completionTokens).toBe(5);
      expect(result.usage.totalTokens).toBe(15);
    });

    it("throws on non-ok response", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error: { message: "Invalid API key" } }),
      });

      const provider = makeProvider();
      const messages: Message[] = [{ role: "user", content: "Hi" }];

      await expect(
        askAnthropic(provider, messages, 4096, AbortSignal.timeout(30000))
      ).rejects.toThrow("Invalid API key");
    });

    it("handles tool use responses by recursively calling", async () => {
      const { callTool } = await import("../../../src/lib/tools/index.js");

      // First call returns tool_use
      const toolUseResponse = {
        content: [
          { type: "tool_use", id: "tool-1", name: "get_weather", input: { city: "NYC" } },
        ],
        usage: { input_tokens: 10, output_tokens: 5 },
      };

      // Second call returns text
      const textResponse = {
        content: [{ type: "text", text: "The weather is sunny" }],
        usage: { input_tokens: 20, output_tokens: 8 },
      };

      (globalThis.fetch as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(toolUseResponse) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(textResponse) });

      (callTool as ReturnType<typeof vi.fn>).mockResolvedValue("Sunny, 72F");

      const provider = makeProvider();
      const messages: Message[] = [{ role: "user", content: "Weather in NYC?" }];

      const result = await askAnthropic(provider, messages, 4096, AbortSignal.timeout(30000));

      expect(result.text).toBe("The weather is sunny");
      expect(callTool).toHaveBeenCalledWith({
        id: "tool-1",
        name: "get_weather",
        arguments: { city: "NYC" },
      });
    });
  });

  describe("streamAnthropic", () => {
    it("sends streaming request with correct headers", async () => {
      const encoder = new TextEncoder();
      const sseData = [
        'data: {"type":"message_start","message":{"usage":{"input_tokens":10}}}',
        'data: {"type":"content_block_delta","delta":{"text":"Hello"}}',
        'data: {"type":"message_delta","usage":{"output_tokens":3}}',
      ].join("\n") + "\n";

      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(sseData));
          controller.close();
        },
      });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        body: { getReader: () => stream.getReader() },
      });

      const provider = makeProvider();
      const messages: Message[] = [{ role: "user", content: "Hi" }];
      const chunks: string[] = [];

      const result = await streamAnthropic(
        provider,
        messages,
        4096,
        AbortSignal.timeout(30000),
        (chunk) => chunks.push(chunk)
      );

      const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      expect(body.stream).toBe(true);
      expect(fetchCall[1].headers["x-api-key"]).toBe("sk-ant-test-key");
    });

    it("collects streamed text and usage", async () => {
      const encoder = new TextEncoder();
      const sseData = [
        'data: {"type":"message_start","message":{"usage":{"input_tokens":10}}}',
        'data: {"type":"content_block_delta","delta":{"text":"Hello"}}',
        'data: {"type":"content_block_delta","delta":{"text":" world"}}',
        'data: {"type":"message_delta","usage":{"output_tokens":5}}',
      ].join("\n") + "\n";

      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(sseData));
          controller.close();
        },
      });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        body: { getReader: () => stream.getReader() },
      });

      const provider = makeProvider();
      const messages: Message[] = [{ role: "user", content: "Hi" }];
      const chunks: string[] = [];

      const result = await streamAnthropic(
        provider,
        messages,
        4096,
        AbortSignal.timeout(30000),
        (chunk) => chunks.push(chunk)
      );

      expect(result.text).toBe("Hello world");
      expect(chunks).toContain("Hello");
      expect(chunks).toContain(" world");
      expect(result.usage.promptTokens).toBe(10);
      expect(result.usage.completionTokens).toBe(5);
      expect(result.usage.totalTokens).toBe(15);
    });

    it("throws on non-ok response", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: { message: "Server error" } }),
      });

      const provider = makeProvider();
      const messages: Message[] = [{ role: "user", content: "Hi" }];

      await expect(
        streamAnthropic(provider, messages, 4096, AbortSignal.timeout(30000), () => {})
      ).rejects.toThrow("Server error");
    });
  });
});
