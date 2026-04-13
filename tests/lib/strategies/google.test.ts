import { describe, it, expect, vi, beforeEach } from "vitest";

vi.stubGlobal("fetch", vi.fn());

vi.mock("../../../src/lib/tools/index.js", () => ({
  getToolDefinitions: vi.fn().mockReturnValue([]),
  callTool: vi.fn().mockResolvedValue("tool result"),
}));

import { askGoogle, streamGoogle } from "../../../src/lib/strategies/google.js";
import type { Provider, Message } from "../../../src/lib/providers.js";

function makeProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    name: "google",
    apiKey: "AIzaSyTestKey123",
    model: "gemini-2.5-flash",
    systemPrompt: "",
    tools: [],
    ...overrides,
  } as Provider;
}

describe("Google Strategy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("askGoogle", () => {
    it("sends request to Gemini API with correct URL containing API key", async () => {
      const mockData = {
        candidates: [{ content: { parts: [{ text: "Hello!" }] } }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
      };

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockData),
      });

      const provider = makeProvider();
      const messages: Message[] = [{ role: "user", content: "Hi" }];

      await askGoogle(provider, messages, 4096, AbortSignal.timeout(30000));

      const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const url = fetchCall[0] as string;

      expect(url).toContain("generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent");
      expect(url).toContain("key=AIzaSyTestKey123");
      expect(fetchCall[1].method).toBe("POST");
      expect(fetchCall[1].headers["Content-Type"]).toBe("application/json");
    });

    it("maps message roles correctly (assistant -> model)", async () => {
      const mockData = {
        candidates: [{ content: { parts: [{ text: "Ok" }] } }],
      };

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockData),
      });

      const provider = makeProvider();
      const messages: Message[] = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi" },
        { role: "user", content: "How are you?" },
      ];

      await askGoogle(provider, messages, 4096, AbortSignal.timeout(30000));

      const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
      expect(body.contents[0].role).toBe("user");
      expect(body.contents[1].role).toBe("model");
      expect(body.contents[2].role).toBe("user");
    });

    it("includes systemInstruction when systemPrompt is provided", async () => {
      const mockData = {
        candidates: [{ content: { parts: [{ text: "Ok" }] } }],
      };

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockData),
      });

      const provider = makeProvider({ systemPrompt: "Be helpful" });
      const messages: Message[] = [{ role: "user", content: "Hi" }];

      await askGoogle(provider, messages, 4096, AbortSignal.timeout(30000));

      const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
      expect(body.systemInstruction).toEqual({ parts: [{ text: "Be helpful" }] });
    });

    it("includes maxOutputTokens in generationConfig", async () => {
      const mockData = {
        candidates: [{ content: { parts: [{ text: "Ok" }] } }],
      };

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockData),
      });

      const provider = makeProvider();
      const messages: Message[] = [{ role: "user", content: "Hi" }];

      await askGoogle(provider, messages, 2048, AbortSignal.timeout(30000));

      const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
      expect(body.generationConfig.maxOutputTokens).toBe(2048);
    });

    it("returns text and usage from response", async () => {
      const mockData = {
        candidates: [{ content: { parts: [{ text: "Hello from Gemini!" }] } }],
        usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 4, totalTokenCount: 12 },
      };

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockData),
      });

      const provider = makeProvider();
      const messages: Message[] = [{ role: "user", content: "Hi" }];

      const result = await askGoogle(provider, messages, 4096, AbortSignal.timeout(30000));

      expect(result.text).toBe("Hello from Gemini!");
      expect(result.usage.promptTokens).toBe(8);
      expect(result.usage.completionTokens).toBe(4);
      expect(result.usage.totalTokens).toBe(12);
    });

    it("throws on non-ok response", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 403,
        json: () => Promise.resolve({ error: { message: "Forbidden" } }),
      });

      const provider = makeProvider();
      const messages: Message[] = [{ role: "user", content: "Hi" }];

      await expect(
        askGoogle(provider, messages, 4096, AbortSignal.timeout(30000))
      ).rejects.toThrow("Forbidden");
    });

    it("handles function call responses by recursively calling", async () => {
      const { callTool } = await import("../../../src/lib/tools/index.js");

      const functionCallResponse = {
        candidates: [
          {
            content: {
              parts: [{ functionCall: { name: "get_weather", args: { city: "NYC" } } }],
            },
          },
        ],
      };

      const textResponse = {
        candidates: [{ content: { parts: [{ text: "It is sunny in NYC" }] } }],
        usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 8, totalTokenCount: 28 },
      };

      (globalThis.fetch as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(functionCallResponse) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(textResponse) });

      (callTool as ReturnType<typeof vi.fn>).mockResolvedValue("Sunny, 72F");

      const provider = makeProvider();
      const messages: Message[] = [{ role: "user", content: "Weather in NYC?" }];

      const result = await askGoogle(provider, messages, 4096, AbortSignal.timeout(30000));

      expect(result.text).toBe("It is sunny in NYC");
      expect(callTool).toHaveBeenCalled();
    });
  });

  describe("streamGoogle", () => {
    it("sends streaming request to correct URL with alt=sse", async () => {
      const encoder = new TextEncoder();
      const sseData = [
        'data: {"candidates":[{"content":{"parts":[{"text":"Hello"}]}}]}',
        'data: {"candidates":[{"content":{"parts":[{"text":" world"}]}}],"usageMetadata":{"promptTokenCount":5,"candidatesTokenCount":2,"totalTokenCount":7}}',
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

      await streamGoogle(provider, messages, 4096, AbortSignal.timeout(30000), () => {});

      const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(url).toContain("streamGenerateContent");
      expect(url).toContain("alt=sse");
    });

    it("collects streamed text and calls onChunk", async () => {
      const encoder = new TextEncoder();
      const sseData = [
        'data: {"candidates":[{"content":{"parts":[{"text":"Hello"}]}}]}',
        'data: {"candidates":[{"content":{"parts":[{"text":" Gemini"}]}}],"usageMetadata":{"promptTokenCount":5,"candidatesTokenCount":3,"totalTokenCount":8}}',
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

      const result = await streamGoogle(
        provider,
        messages,
        4096,
        AbortSignal.timeout(30000),
        (chunk) => chunks.push(chunk)
      );

      expect(result.text).toBe("Hello Gemini");
      expect(chunks).toContain("Hello");
      expect(chunks).toContain(" Gemini");
      expect(result.usage.promptTokens).toBe(5);
      expect(result.usage.completionTokens).toBe(3);
    });

    it("throws on non-ok response", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: { message: "Internal error" } }),
      });

      const provider = makeProvider();
      const messages: Message[] = [{ role: "user", content: "Hi" }];

      await expect(
        streamGoogle(provider, messages, 4096, AbortSignal.timeout(30000), () => {})
      ).rejects.toThrow("Internal error");
    });
  });
});
