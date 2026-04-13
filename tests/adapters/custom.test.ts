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

vi.mock("../../src/lib/crypto.js", () => ({
  decrypt: vi.fn((val: string) => `decrypted-${val}`),
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

import { CustomAdapter, type CustomProviderConfig } from "../../src/adapters/custom.adapter.js";
import { validateSafeUrl } from "../../src/lib/ssrf.js";
import { getBreaker } from "../../src/lib/breaker.js";

function makeConfig(overrides: Partial<CustomProviderConfig> = {}): CustomProviderConfig {
  return {
    id: "test-provider",
    name: "Test Provider",
    base_url: "https://api.custom-llm.example.com",
    auth_type: "bearer",
    auth_key_encrypted: "encrypted-key-abc",
    capabilities: { streaming: true, tools: true, vision: false },
    models: ["custom-model-v1", "custom-model-v2"],
    ...overrides,
  };
}

describe("CustomAdapter", () => {
  let adapter: CustomAdapter;
  let config: CustomProviderConfig;

  beforeEach(() => {
    vi.clearAllMocks();
    config = makeConfig();
    adapter = new CustomAdapter(config);
    vi.stubGlobal("fetch", vi.fn());
  });

  describe("constructor", () => {
    it("sets providerId to custom_{id}", () => {
      expect(adapter.providerId).toBe("custom_test-provider");
    });

    it("uses the config id for providerId", () => {
      const a = new CustomAdapter(makeConfig({ id: "my-llm" }));
      expect(a.providerId).toBe("custom_my-llm");
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
        model: "custom-model-v1",
        messages: [{ role: "user", content: "Hi" }],
      });

      expect(validateSafeUrl).toHaveBeenCalledWith("https://api.custom-llm.example.com");
    });

    it("sends Bearer auth header for auth_type='bearer'", async () => {
      const sseBody = createSSEStream([
        'data: {"choices":[{"delta":{"content":"Hello"}}]}',
        "data: [DONE]",
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: sseBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      await adapter.generate({
        model: "custom-model-v1",
        messages: [{ role: "user", content: "Hello" }],
      });

      const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const url = fetchCall[0] as string;
      const options = fetchCall[1];

      expect(url).toBe("https://api.custom-llm.example.com/chat/completions");
      expect(options.headers["Authorization"]).toBe("Bearer decrypted-encrypted-key-abc");
      expect(options.method).toBe("POST");
    });

    it("sends custom header for auth_type='api_key_header'", async () => {
      const cfg = makeConfig({
        auth_type: "api_key_header",
        auth_header_name: "X-Custom-Key",
      });
      const customAdapter = new CustomAdapter(cfg);

      const sseBody = createSSEStream([
        'data: {"choices":[{"delta":{"content":"ok"}}]}',
        "data: [DONE]",
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: sseBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      await customAdapter.generate({
        model: "custom-model-v1",
        messages: [{ role: "user", content: "Test" }],
      });

      const options = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(options.headers["X-Custom-Key"]).toBe("decrypted-encrypted-key-abc");
    });

    it("uses api_key query param for auth_type='api_key_query'", async () => {
      const cfg = makeConfig({ auth_type: "api_key_query" });
      const queryAdapter = new CustomAdapter(cfg);

      const sseBody = createSSEStream([
        'data: {"choices":[{"delta":{"content":"ok"}}]}',
        "data: [DONE]",
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: sseBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      await queryAdapter.generate({
        model: "custom-model-v1",
        messages: [{ role: "user", content: "Test" }],
      });

      const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(url).toContain("api_key=decrypted-encrypted-key-abc");
    });

    it("formats messages in OpenAI-compatible format", async () => {
      const sseBody = createSSEStream([
        'data: {"choices":[{"delta":{"content":"ok"}}]}',
        "data: [DONE]",
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: sseBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      await adapter.generate({
        model: "custom-model-v1",
        messages: [{ role: "user", content: "Hello" }],
        system_prompt: "System instruction",
      });

      const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
      expect(body.messages[0]).toEqual({ role: "system", content: "System instruction" });
      expect(body.messages[1]).toEqual({ role: "user", content: "Hello" });
      expect(body.stream).toBe(true);
    });

    it("handles streaming response and collects text", async () => {
      const sseBody = createSSEStream([
        'data: {"choices":[{"delta":{"content":"Hello"}}]}',
        'data: {"choices":[{"delta":{"content":" custom"}}]}',
        "data: [DONE]",
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: sseBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      const result = await adapter.generate({
        model: "custom-model-v1",
        messages: [{ role: "user", content: "Hi" }],
      });

      const collected = await result.collect();
      expect(collected.text).toBe("Hello custom");
    });

    it("handles non-streaming response when streaming capability is false", async () => {
      const cfg = makeConfig({
        capabilities: { streaming: false, tools: false, vision: false },
      });
      const nonStreamAdapter = new CustomAdapter(cfg);

      const mockResponse = new Response(
        JSON.stringify({
          choices: [{ message: { content: "Non-stream response" } }],
          usage: { prompt_tokens: 5, completion_tokens: 3 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      const result = await nonStreamAdapter.generate({
        model: "custom-model-v1",
        messages: [{ role: "user", content: "Hi" }],
      });

      const collected = await result.collect();
      expect(collected.text).toBe("Non-stream response");
      expect(collected.usage.prompt_tokens).toBe(5);
      expect(collected.usage.completion_tokens).toBe(3);
    });

    it("throws on non-ok response", async () => {
      const mockResponse = new Response(
        JSON.stringify({ error: { message: "Server error" } }),
        { status: 500 }
      );

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      await expect(
        adapter.generate({
          model: "custom-model-v1",
          messages: [{ role: "user", content: "Hi" }],
        })
      ).rejects.toThrow("Server error");
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
        model: "custom-model-v1",
        messages: [{ role: "user", content: "Test" }],
      });

      expect(getBreaker).toHaveBeenCalled();
    });
  });

  describe("listModels", () => {
    it("returns the models from config", async () => {
      const models = await adapter.listModels();
      expect(models).toEqual(["custom-model-v1", "custom-model-v2"]);
    });
  });
});
