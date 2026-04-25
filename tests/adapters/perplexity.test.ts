import { describe, it, expect, vi, beforeEach } from "vitest";

// There is no dedicated Perplexity adapter file in the codebase.
// Perplexity is served via the OpenAI-compatible OpenAIAdapter with a custom baseUrl.
// This test verifies that usage pattern.

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

describe("PerplexityAdapter (OpenAI-compatible via OpenAIAdapter)", () => {
  let adapter: OpenAIAdapter;
  const mockApiKey = "pplx-test-key-123";
  const perplexityBaseUrl = "https://api.perplexity.ai";

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new OpenAIAdapter(mockApiKey, perplexityBaseUrl, "perplexity");
    vi.stubGlobal("fetch", vi.fn());
  });

  describe("constructor", () => {
    it("sets providerId to 'perplexity'", () => {
      expect(adapter.providerId).toBe("perplexity");
    });
  });

  describe("generate", () => {
    it("validates the Perplexity base URL via SSRF check", async () => {
      const sseBody = createSSEStream([
        'data: {"choices":[{"delta":{"content":"Hi"}}]}',
        "data: [DONE]",
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: sseBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      await adapter.generate({
        model: "llama-3.1-sonar-large-128k-online",
        messages: [{ role: "user", content: "Hi" }],
      });

      expect(validateSafeUrl).toHaveBeenCalledWith(perplexityBaseUrl);
    });

    it("sends correct Authorization: Bearer header to Perplexity", async () => {
      const sseBody = createSSEStream([
        'data: {"choices":[{"delta":{"content":"Hello"}}]}',
        "data: [DONE]",
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: sseBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      await adapter.generate({
        model: "llama-3.1-sonar-large-128k-online",
        messages: [{ role: "user", content: "Hello" }],
      });

      const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const url = fetchCall[0];
      const options = fetchCall[1];

      expect(url).toBe("https://api.perplexity.ai/chat/completions");
      expect(options.headers["Authorization"]).toBe(`Bearer ${mockApiKey}`);
      expect(options.method).toBe("POST");
    });

    it("formats messages in OpenAI-compatible format with system_prompt", async () => {
      const sseBody = createSSEStream([
        'data: {"choices":[{"delta":{"content":"ok"}}]}',
        "data: [DONE]",
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: sseBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      await adapter.generate({
        model: "llama-3.1-sonar-large-128k-online",
        messages: [{ role: "user", content: "Search for X" }],
        system_prompt: "You are a search assistant",
      });

      const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
      expect(body.messages[0]).toEqual({ role: "system", content: "You are a search assistant" });
      expect(body.messages[1]).toEqual({ role: "user", content: "Search for X" });
      expect(body.stream).toBe(true);
    });

    it("handles streaming response and collects text", async () => {
      const sseBody = createSSEStream([
        'data: {"choices":[{"delta":{"content":"Search"}}]}',
        'data: {"choices":[{"delta":{"content":" result"}}]}',
        'data: {"usage":{"prompt_tokens":12,"completion_tokens":4}}',
        "data: [DONE]",
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: sseBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      const result = await adapter.generate({
        model: "llama-3.1-sonar-large-128k-online",
        messages: [{ role: "user", content: "Hi" }],
      });

      const collected = await result.collect();
      expect(collected.text).toBe("Search result");
      expect(collected.usage.prompt_tokens).toBe(12);
      expect(collected.usage.completion_tokens).toBe(4);
    });

    it("throws on non-ok response", async () => {
      const mockResponse = new Response(
        JSON.stringify({ error: { message: "Unauthorized" } }),
        { status: 401 }
      );

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      await expect(
        adapter.generate({
          model: "llama-3.1-sonar-large-128k-online",
          messages: [{ role: "user", content: "Hi" }],
        })
      ).rejects.toThrow("Unauthorized");
    });
  });
});
