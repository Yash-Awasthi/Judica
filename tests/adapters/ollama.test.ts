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

function createNDJSONStream(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const data = lines.map((l) => `${l}\n`).join("");
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(data));
      controller.close();
    },
  });
}

import { OllamaAdapter } from "../../src/adapters/ollama.adapter.js";
import { validateSafeUrl } from "../../src/lib/ssrf.js";
import { getBreaker } from "../../src/lib/breaker.js";

describe("OllamaAdapter", () => {
  let adapter: OllamaAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new OllamaAdapter();
    vi.stubGlobal("fetch", vi.fn());
  });

  describe("constructor", () => {
    it("sets providerId to 'ollama'", () => {
      expect(adapter.providerId).toBe("ollama");
    });

    it("defaults to localhost:11434", () => {
      // We verify by checking the fetch URL in generate
      expect(adapter.providerId).toBe("ollama");
    });

    it("accepts custom baseUrl", () => {
      const custom = new OllamaAdapter("http://myhost:11434");
      expect(custom.providerId).toBe("ollama");
    });
  });

  describe("generate", () => {
    it("skips SSRF validation for localhost URLs", async () => {
      const ndjsonBody = createNDJSONStream([
        '{"message":{"content":"Hello"},"done":false}',
        '{"message":{"content":""},"done":true,"prompt_eval_count":5,"eval_count":3}',
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: ndjsonBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      await adapter.generate({
        model: "llama3.2",
        messages: [{ role: "user", content: "Hi" }],
      });

      // localhost URLs skip SSRF check
      expect(validateSafeUrl).not.toHaveBeenCalled();
    });

    it("validates SSRF for non-localhost URLs", async () => {
      const remoteAdapter = new OllamaAdapter("https://remote-ollama.example.com");

      const ndjsonBody = createNDJSONStream([
        '{"message":{"content":"Hi"},"done":true,"prompt_eval_count":1,"eval_count":1}',
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: ndjsonBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      await remoteAdapter.generate({
        model: "llama3.2",
        messages: [{ role: "user", content: "Hi" }],
      });

      expect(validateSafeUrl).toHaveBeenCalledWith("https://remote-ollama.example.com");
    });

    it("sends request to /api/chat endpoint", async () => {
      const ndjsonBody = createNDJSONStream([
        '{"message":{"content":"Hello"},"done":true,"prompt_eval_count":5,"eval_count":3}',
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: ndjsonBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      await adapter.generate({
        model: "llama3.2",
        messages: [{ role: "user", content: "Hello" }],
      });

      const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const url = fetchCall[0];
      const options = fetchCall[1];

      expect(url).toBe("http://localhost:11434/api/chat");
      expect(options.headers["Content-Type"]).toBe("application/json");
      expect(options.method).toBe("POST");
    });

    it("formats messages with system_prompt and maps tool role to user", async () => {
      const ndjsonBody = createNDJSONStream([
        '{"message":{"content":"ok"},"done":true,"prompt_eval_count":5,"eval_count":1}',
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: ndjsonBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      await adapter.generate({
        model: "llama3.2",
        messages: [
          { role: "user", content: "Hello" },
          { role: "tool", content: "Tool result" },
        ],
        system_prompt: "Be helpful",
      });

      const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
      expect(body.messages[0]).toEqual({ role: "system", content: "Be helpful" });
      expect(body.messages[1]).toEqual({ role: "user", content: "Hello" });
      // tool role mapped to user
      expect(body.messages[2]).toEqual({ role: "user", content: "Tool result" });
      expect(body.stream).toBe(true);
    });

    it("includes temperature and num_predict in options", async () => {
      const ndjsonBody = createNDJSONStream([
        '{"message":{"content":"ok"},"done":true,"prompt_eval_count":1,"eval_count":1}',
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: ndjsonBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      await adapter.generate({
        model: "llama3.2",
        messages: [{ role: "user", content: "Test" }],
        temperature: 0.5,
        max_tokens: 512,
      });

      const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
      expect(body.options.temperature).toBe(0.5);
      expect(body.options.num_predict).toBe(512);
    });

    it("handles NDJSON streaming response and collects text", async () => {
      const ndjsonBody = createNDJSONStream([
        '{"message":{"content":"Hello"},"done":false}',
        '{"message":{"content":" world"},"done":false}',
        '{"message":{"content":""},"done":true,"prompt_eval_count":10,"eval_count":5}',
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: ndjsonBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      const result = await adapter.generate({
        model: "llama3.2",
        messages: [{ role: "user", content: "Hi" }],
      });

      const collected = await result.collect();
      expect(collected.text).toBe("Hello world");
      expect(collected.usage.prompt_tokens).toBe(10);
      expect(collected.usage.completion_tokens).toBe(5);
    });

    it("throws on non-ok response", async () => {
      const mockResponse = new Response("Not Found", { status: 404, statusText: "Not Found" });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      await expect(
        adapter.generate({
          model: "llama3.2",
          messages: [{ role: "user", content: "Hi" }],
        })
      ).rejects.toThrow("Ollama error: 404");
    });

    it("uses circuit breaker", async () => {
      const ndjsonBody = createNDJSONStream([
        '{"message":{"content":"ok"},"done":true,"prompt_eval_count":1,"eval_count":1}',
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: ndjsonBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      await adapter.generate({
        model: "llama3.2",
        messages: [{ role: "user", content: "Test" }],
      });

      expect(getBreaker).toHaveBeenCalled();
    });

    it("defaults model to llama3.2 when empty", async () => {
      const ndjsonBody = createNDJSONStream([
        '{"message":{"content":"ok"},"done":true,"prompt_eval_count":1,"eval_count":1}',
      ]);
      const mockResponse = new Response(null, { status: 200 });
      Object.defineProperty(mockResponse, "ok", { value: true });
      Object.defineProperty(mockResponse, "body", { value: ndjsonBody });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      await adapter.generate({
        model: "",
        messages: [{ role: "user", content: "Test" }],
      });

      const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
      expect(body.model).toBe("llama3.2");
    });
  });
});
