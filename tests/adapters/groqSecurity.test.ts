import { describe, it, expect, vi, beforeEach } from "vitest";

// P11-22: Groq-specific feature tests
// P11-23: 429 rate-limit retry test
// P11-24: Strict schema validation

vi.mock("../../src/lib/ssrf.js", () => ({
  validateSafeUrl: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/lib/breaker.js", () => ({
  getBreaker: vi.fn((_provider: any, action: any) => ({
    fire: (...args: any[]) => action(...args),
  })),
}));

vi.mock("../../src/lib/logger.js", () => ({
  default: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { GroqAdapter } from "../../src/adapters/groq.adapter.js";

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

describe("P11-22: Groq-specific features", () => {
  let adapter: GroqAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new GroqAdapter("gsk_test123");
    vi.stubGlobal("fetch", vi.fn());
  });

  it("has providerId 'groq'", () => {
    expect(adapter.providerId).toBe("groq");
  });

  it("uses correct Groq base URL", async () => {
    const sseBody = createSSEStream([
      'data: {"choices":[{"delta":{"content":"fast"}}]}',
      'data: {"x_groq":{"usage":{"prompt_tokens":5,"completion_tokens":2}}}',
      "data: [DONE]",
    ]);
    const mockResponse = new Response(null, { status: 200 });
    Object.defineProperty(mockResponse, "ok", { value: true });
    Object.defineProperty(mockResponse, "body", { value: sseBody });
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    await adapter.generate({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: "test" }],
    });

    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
  });

  it("extracts usage from x_groq.usage field (Groq-specific)", async () => {
    const sseBody = createSSEStream([
      'data: {"choices":[{"delta":{"content":"response"}}]}',
      'data: {"x_groq":{"usage":{"prompt_tokens":15,"completion_tokens":8}}}',
      "data: [DONE]",
    ]);
    const mockResponse = new Response(null, { status: 200 });
    Object.defineProperty(mockResponse, "ok", { value: true });
    Object.defineProperty(mockResponse, "body", { value: sseBody });
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    const result = await adapter.generate({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: "test" }],
    });

    const collected = await result.collect();
    expect(collected.text).toBe("response");
    expect(collected.usage.prompt_tokens).toBe(15);
    expect(collected.usage.completion_tokens).toBe(8);
  });

  it("filters whisper/guard/embed models from listModels", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            { id: "llama-3.3-70b-versatile" },
            { id: "whisper-large-v3" },
            { id: "llama-guard-3-8b" },
            { id: "nomic-embed-text-v1.5" },
            { id: "llama-3.1-8b-instant" },
          ],
        }),
        { status: 200 }
      )
    );

    const models = await adapter.listModels();
    expect(models).toContain("llama-3.3-70b-versatile");
    expect(models).toContain("llama-3.1-8b-instant");
    expect(models).not.toContain("whisper-large-v3");
    expect(models).not.toContain("llama-guard-3-8b");
    expect(models).not.toContain("nomic-embed-text-v1.5");
  });
});

describe("P11-23: 429 rate-limit handling", () => {
  let adapter: GroqAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new GroqAdapter("gsk_test123");
    vi.stubGlobal("fetch", vi.fn());
  });

  it("should throw error with message on 429 response", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(
        JSON.stringify({ error: { message: "Rate limit reached for model" } }),
        { status: 429 }
      )
    );

    await expect(
      adapter.generate({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: "test" }],
      })
    ).rejects.toThrow("Rate limit reached for model");
  });

  it("should throw generic error when 429 has no parseable error message", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response("Too Many Requests", { status: 429 })
    );

    await expect(
      adapter.generate({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: "test" }],
      })
    ).rejects.toThrow("groq API error: 429");
  });
});

describe("P11-24: Strict schema validation", () => {
  let adapter: GroqAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new GroqAdapter("gsk_test123");
    vi.stubGlobal("fetch", vi.fn());
  });

  it("should produce correct response shape with all required fields", async () => {
    const sseBody = createSSEStream([
      'data: {"id":"chatcmpl-123","choices":[{"index":0,"delta":{"role":"assistant","content":"Hello"},"finish_reason":null}]}',
      'data: {"id":"chatcmpl-123","choices":[{"index":0,"delta":{"content":" world"},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":2}}',
      "data: [DONE]",
    ]);
    const mockResponse = new Response(null, { status: 200 });
    Object.defineProperty(mockResponse, "ok", { value: true });
    Object.defineProperty(mockResponse, "body", { value: sseBody });
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    const result = await adapter.generate({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: "test" }],
    });

    const collected = await result.collect();

    // Exact shape assertions (not just toBeDefined())
    expect(typeof collected.text).toBe("string");
    expect(collected.text).toBe("Hello world");
    expect(Array.isArray(collected.tool_calls)).toBe(true);
    expect(typeof collected.usage.prompt_tokens).toBe("number");
    expect(typeof collected.usage.completion_tokens).toBe("number");
    expect(collected.usage.prompt_tokens).toBe(10);
    expect(collected.usage.completion_tokens).toBe(2);
  });

  it("should handle empty choices array gracefully", async () => {
    const sseBody = createSSEStream([
      'data: {"choices":[]}',
      "data: [DONE]",
    ]);
    const mockResponse = new Response(null, { status: 200 });
    Object.defineProperty(mockResponse, "ok", { value: true });
    Object.defineProperty(mockResponse, "body", { value: sseBody });
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    const result = await adapter.generate({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: "test" }],
    });

    const collected = await result.collect();
    expect(collected.text).toBe("");
    expect(collected.tool_calls).toEqual([]);
  });
});
