import { describe, it, expect, vi, beforeEach } from "vitest";

vi.stubGlobal("fetch", vi.fn());

vi.mock("../../../src/lib/ssrf.js", () => ({
  validateSafeUrl: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../src/lib/tools/index.js", () => ({
  getToolDefinitions: vi.fn().mockReturnValue([]),
  callTool: vi.fn().mockResolvedValue({ result: "tool result" }),
}));

import { askOpenAI, streamOpenAI } from "../../../src/lib/providers/strategies/openai.js";
import { validateSafeUrl } from "../../../src/lib/ssrf.js";
import type { Provider, Message } from "../../../src/lib/providers.js";

function makeProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    name: "openai",
    apiKey: "sk-test-openai-key",
    model: "gpt-4o",
    systemPrompt: "",
    tools: [],
    ...overrides,
  } as Provider;
}

describe("OpenAI Strategy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("askOpenAI", () => {
    it("sends request to OpenAI API with correct headers", async () => {
      const mockData = {
        choices: [{ message: { content: "Hello!" } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      };

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockData),
      });

      const provider = makeProvider();
      const messages: Message[] = [{ role: "user", content: "Hi" }];
      const askFn = vi.fn();

      await askOpenAI(provider, messages, undefined, 4096, AbortSignal.timeout(30000), false, askFn);

      const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const url = fetchCall[0] as string;
      const options = fetchCall[1];

      expect(url).toBe("https://api.openai.com/v1/chat/completions");
      expect(options.headers["Authorization"]).toBe("Bearer sk-test-openai-key");
      expect(options.headers["Content-Type"]).toBe("application/json");
      expect(options.method).toBe("POST");
    });

    it("validates base URL via SSRF check", async () => {
      const mockData = {
        choices: [{ message: { content: "Ok" } }],
      };

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockData),
      });

      const provider = makeProvider();
      const messages: Message[] = [{ role: "user", content: "Hi" }];

      await askOpenAI(provider, messages, undefined, 4096, AbortSignal.timeout(30000), false, vi.fn());

      expect(validateSafeUrl).toHaveBeenCalledWith("https://api.openai.com/v1");
    });

    it("uses custom base URL when provided", async () => {
      const mockData = {
        choices: [{ message: { content: "Ok" } }],
      };

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockData),
      });

      const provider = makeProvider();
      const messages: Message[] = [{ role: "user", content: "Hi" }];

      await askOpenAI(
        provider,
        messages,
        "https://api.custom-openai.com/v1",
        4096,
        AbortSignal.timeout(30000),
        false,
        vi.fn()
      );

      const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(url).toBe("https://api.custom-openai.com/v1/chat/completions");
      expect(validateSafeUrl).toHaveBeenCalledWith("https://api.custom-openai.com/v1");
    });

    it("includes system prompt in messages", async () => {
      const mockData = {
        choices: [{ message: { content: "Ok" } }],
      };

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockData),
      });

      const provider = makeProvider({ systemPrompt: "Be helpful" });
      const messages: Message[] = [{ role: "user", content: "Hi" }];

      await askOpenAI(provider, messages, undefined, 4096, AbortSignal.timeout(30000), false, vi.fn());

      const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
      expect(body.messages[0]).toEqual({ role: "system", content: "Be helpful" });
      expect(body.messages[1]).toEqual({ role: "user", content: "Hi" });
    });

    it("returns text and usage from response", async () => {
      const mockData = {
        choices: [{ message: { content: "Hello from GPT!" } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      };

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockData),
      });

      const provider = makeProvider();
      const messages: Message[] = [{ role: "user", content: "Hi" }];

      const result = await askOpenAI(
        provider, messages, undefined, 4096, AbortSignal.timeout(30000), false, vi.fn()
      );

      expect(result.text).toBe("Hello from GPT!");
      expect(result.usage.promptTokens).toBe(10);
      expect(result.usage.completionTokens).toBe(5);
      expect(result.usage.totalTokens).toBe(15);
    });

    it("strips <think> tags from response", async () => {
      const mockData = {
        choices: [{ message: { content: "<think>reasoning</think>Final answer" } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      };

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockData),
      });

      const provider = makeProvider();
      const messages: Message[] = [{ role: "user", content: "Hi" }];

      const result = await askOpenAI(
        provider, messages, undefined, 4096, AbortSignal.timeout(30000), false, vi.fn()
      );

      expect(result.text).toBe("Final answer");
    });

    it("throws on non-ok response", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 429,
        json: () => Promise.resolve({ error: { message: "Rate limit" } }),
      });

      const provider = makeProvider();
      const messages: Message[] = [{ role: "user", content: "Hi" }];

      await expect(
        askOpenAI(provider, messages, undefined, 4096, AbortSignal.timeout(30000), false, vi.fn())
      ).rejects.toThrow("Rate limit");
    });

    it("handles tool call responses by calling askFn recursively", async () => {
      const { callTool } = await import("../../../src/lib/tools/index.js");

      const toolCallResponse = {
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: { name: "get_weather", arguments: '{"city":"NYC"}' },
                },
              ],
            },
          },
        ],
      };

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(toolCallResponse),
      });

      (callTool as ReturnType<typeof vi.fn>).mockResolvedValue("Sunny, 72F");

      const askFn = vi.fn().mockResolvedValue({ text: "It is sunny", usage: {} });
      const provider = makeProvider();
      const messages: Message[] = [{ role: "user", content: "Weather?" }];

      await askOpenAI(provider, messages, undefined, 4096, AbortSignal.timeout(30000), false, askFn);

      expect(callTool).toHaveBeenCalledWith({
        id: "call_1",
        name: "get_weather",
        arguments: { city: "NYC" },
      });
      expect(askFn).toHaveBeenCalled();
    });
  });

  describe("streamOpenAI", () => {
    it("sends streaming request with stream=true", async () => {
      const encoder = new TextEncoder();
      const sseData = [
        'data: {"choices":[{"delta":{"content":"Hello"}}]}',
        'data: {"choices":[{"delta":{"content":" world"}}]}',
        "data: [DONE]",
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

      await streamOpenAI(
        provider,
        messages,
        undefined,
        4096,
        AbortSignal.timeout(30000),
        false,
        (chunk) => chunks.push(chunk),
        vi.fn()
      );

      const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
      expect(body.stream).toBe(true);
      expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].headers["Authorization"]).toBe(
        "Bearer sk-test-openai-key"
      );
    });

    it("collects streamed text and calls onChunk", async () => {
      const encoder = new TextEncoder();
      const sseData = [
        'data: {"choices":[{"delta":{"content":"Hello"}}]}',
        'data: {"choices":[{"delta":{"content":" GPT"}}]}',
        'data: {"usage":{"prompt_tokens":5,"completion_tokens":2,"total_tokens":7}}',
        "data: [DONE]",
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

      const result = await streamOpenAI(
        provider,
        messages,
        undefined,
        4096,
        AbortSignal.timeout(30000),
        false,
        (chunk) => chunks.push(chunk),
        vi.fn()
      );

      expect(result.text).toBe("Hello GPT");
      expect(chunks).toContain("Hello");
      expect(chunks).toContain(" GPT");
      expect(result.usage.promptTokens).toBe(5);
      expect(result.usage.completionTokens).toBe(2);
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
        streamOpenAI(
          provider,
          messages,
          undefined,
          4096,
          AbortSignal.timeout(30000),
          false,
          () => {},
          vi.fn()
        )
      ).rejects.toThrow("Server error");
    });

    it("filters out <think> tags during streaming", async () => {
      const encoder = new TextEncoder();
      const sseData = [
        'data: {"choices":[{"delta":{"content":"<think>reasoning</think>"}}]}',
        'data: {"choices":[{"delta":{"content":"Final answer"}}]}',
        "data: [DONE]",
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

      await streamOpenAI(
        provider,
        messages,
        undefined,
        4096,
        AbortSignal.timeout(30000),
        false,
        (chunk) => chunks.push(chunk),
        vi.fn()
      );

      // The onChunk callback should not receive the <think> content
      const joinedChunks = chunks.join("");
      expect(joinedChunks).not.toContain("<think>");
      expect(joinedChunks).toContain("Final answer");
    });
  });
});
