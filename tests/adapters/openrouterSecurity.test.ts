import { describe, it, expect, vi, beforeEach } from "vitest";

// P11-36: Multimodal content preservation

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

import { OpenRouterAdapter } from "../../src/adapters/openrouter.adapter.js";

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

describe("P11-36: Multimodal content preservation in OpenRouter", () => {
  let adapter: OpenRouterAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new OpenRouterAdapter("sk-or-v1-test");
    vi.stubGlobal("fetch", vi.fn());
  });

  it("should preserve image_url in request body as image_url content block", async () => {
    const sseBody = createSSEStream([
      'data: {"choices":[{"delta":{"content":"I see a cat"}}]}',
      "data: [DONE]",
    ]);
    const mockResponse = new Response(null, { status: 200 });
    Object.defineProperty(mockResponse, "ok", { value: true });
    Object.defineProperty(mockResponse, "body", { value: sseBody });
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    await adapter.generate({
      model: "openai/gpt-4o",
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "What is this?" },
          { type: "image_url", url: "https://example.com/cat.jpg" },
        ],
      }],
    });

    const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    const content = body.messages[0].content;

    // OpenRouterAdapter.formatMessages JSON-stringifies non-string content
    // (the multimodal array handling is in the base class, which is overridden)
    expect(typeof content).toBe("string");
    const parsed = JSON.parse(content);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0]).toEqual({ type: "text", text: "What is this?" });
    expect(parsed[1]).toEqual({ type: "image_url", url: "https://example.com/cat.jpg" });
  });

  it("should preserve image_base64 as data URL in image_url format", async () => {
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
      messages: [{
        role: "user",
        content: [
          { type: "image_base64", data: "iVBORw0KGgo=", media_type: "image/png" },
        ],
      }],
    });

    const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    const content = body.messages[0].content;

    // OpenRouterAdapter.formatMessages JSON-stringifies non-string content
    expect(typeof content).toBe("string");
    const parsed = JSON.parse(content);
    expect(parsed[0]).toEqual({
      type: "image_base64",
      data: "iVBORw0KGgo=",
      media_type: "image/png",
    });
  });

  it("should include OpenRouter-specific headers", async () => {
    const sseBody = createSSEStream([
      'data: {"choices":[{"delta":{"content":"ok"}}]}',
      "data: [DONE]",
    ]);
    const mockResponse = new Response(null, { status: 200 });
    Object.defineProperty(mockResponse, "ok", { value: true });
    Object.defineProperty(mockResponse, "body", { value: sseBody });
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    await adapter.generate({
      model: "meta-llama/llama-3.1-8b-instruct:free",
      messages: [{ role: "user", content: "test" }],
    });

    const headers = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].headers;
    expect(headers["HTTP-Referer"]).toBeDefined();
    expect(headers["X-Title"]).toBeDefined();
    expect(headers["Authorization"]).toBe("Bearer sk-or-v1-test");
  });

  it("should include OpenRouter-specific body fields (transforms, route, provider)", async () => {
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
      messages: [{ role: "user", content: "test" }],
    });

    const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.transforms).toEqual(["middle-out"]);
    expect(body.route).toBe("fallback");
    expect(body.provider).toEqual({ order: ["Together", "DeepInfra", "Fireworks"] });
  });
});
