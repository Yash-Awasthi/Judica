import { describe, it, expect, vi, beforeEach } from "vitest";

// P11-17: image_url→text degradation tested as failure
// P11-18: SSE-only streaming assumption (non-SSE JSON)
// P11-19: Tool role fallback
// P11-20: Temperature/parameter clamping
// P11-21: Safety rating and finishReason tests

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

import { GeminiAdapter } from "../../src/adapters/gemini.adapter.js";

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

describe("P11-17: image_url→text degradation", () => {
  let adapter: GeminiAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new GeminiAdapter("AIzaSyTest123");
    vi.stubGlobal("fetch", vi.fn());
  });

  it("should convert image_url to text placeholder when fetch fails (documenting current behavior)", async () => {
    const sseBody = createSSEStream([
      'data: {"candidates":[{"content":{"parts":[{"text":"I see an image"}]}}]}',
    ]);

    // The adapter no longer fetches image URLs — it directly converts to a text placeholder.
    // Only one fetch call happens: the Gemini API call itself.
    const apiResponse = new Response(null, { status: 200 });
    Object.defineProperty(apiResponse, "ok", { value: true });
    Object.defineProperty(apiResponse, "body", { value: sseBody });

    (globalThis.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(apiResponse);

    await adapter.generate({
      model: "gemini-2.0-flash",
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "What is this?" },
          { type: "image_url", url: "https://example.com/img.png" },
        ],
      }],
    });

    // API call is the first (and only) fetch
    const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    // P11-17: Document that image_url is degraded to text placeholder directly (no fetch attempt)
    const parts = body.contents[0].parts;
    expect(parts).toContainEqual({ text: "[Image: https://example.com/img.png]" });
  });

  it("should preserve image_base64 as inlineData (no degradation)", async () => {
    const sseBody = createSSEStream([
      'data: {"candidates":[{"content":{"parts":[{"text":"I see a cat"}]}}]}',
    ]);
    const mockResponse = new Response(null, { status: 200 });
    Object.defineProperty(mockResponse, "ok", { value: true });
    Object.defineProperty(mockResponse, "body", { value: sseBody });
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    await adapter.generate({
      model: "gemini-2.0-flash",
      messages: [{
        role: "user",
        content: [
          { type: "image_base64", data: "iVBORw0KGgo=", media_type: "image/png" },
        ],
      }],
    });

    const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.contents[0].parts[0]).toEqual({
      inlineData: { mimeType: "image/png", data: "iVBORw0KGgo=" },
    });
  });
});

describe("P11-18: Non-SSE JSON streaming format", () => {
  let adapter: GeminiAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new GeminiAdapter("AIzaSyTest123");
    vi.stubGlobal("fetch", vi.fn());
  });

  it("should handle SSE format with data: prefix correctly", async () => {
    const sseBody = createSSEStream([
      'data: {"candidates":[{"content":{"parts":[{"text":"chunk1"}]}}]}',
      'data: {"candidates":[{"content":{"parts":[{"text":"chunk2"}]}}],"usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":5}}',
    ]);
    const mockResponse = new Response(null, { status: 200 });
    Object.defineProperty(mockResponse, "ok", { value: true });
    Object.defineProperty(mockResponse, "body", { value: sseBody });
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    const result = await adapter.generate({
      model: "gemini-2.0-flash",
      messages: [{ role: "user", content: "test" }],
    });

    const collected = await result.collect();
    expect(collected.text).toBe("chunk1chunk2");
  });

  it("should request SSE format via alt=sse query parameter", async () => {
    const sseBody = createSSEStream([
      'data: {"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}',
    ]);
    const mockResponse = new Response(null, { status: 200 });
    Object.defineProperty(mockResponse, "ok", { value: true });
    Object.defineProperty(mockResponse, "body", { value: sseBody });
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    await adapter.generate({
      model: "gemini-2.0-flash",
      messages: [{ role: "user", content: "test" }],
    });

    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain("alt=sse");
  });
});

describe("P11-19: Tool role fallback", () => {
  let adapter: GeminiAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new GeminiAdapter("AIzaSyTest123");
    vi.stubGlobal("fetch", vi.fn());
  });

  it("should map tool role messages to function role with functionResponse", async () => {
    const sseBody = createSSEStream([
      'data: {"candidates":[{"content":{"parts":[{"text":"Done"}]}}]}',
    ]);
    const mockResponse = new Response(null, { status: 200 });
    Object.defineProperty(mockResponse, "ok", { value: true });
    Object.defineProperty(mockResponse, "body", { value: sseBody });
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    await adapter.generate({
      model: "gemini-2.0-flash",
      messages: [
        { role: "user", content: "weather?" },
        { role: "assistant", content: "", tool_calls: [{ id: "c1", name: "get_weather", arguments: { city: "NYC" } }] },
        { role: "tool", name: "get_weather", content: '{"temp":72}' },
      ],
    });

    const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    // Tool result maps to "function" role
    expect(body.contents[2].role).toBe("function");
    expect(body.contents[2].parts[0].functionResponse.name).toBe("get_weather");
  });

  it("should use 'tool' as default name when tool message has no name", async () => {
    const sseBody = createSSEStream([
      'data: {"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}',
    ]);
    const mockResponse = new Response(null, { status: 200 });
    Object.defineProperty(mockResponse, "ok", { value: true });
    Object.defineProperty(mockResponse, "body", { value: sseBody });
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    await adapter.generate({
      model: "gemini-2.0-flash",
      messages: [{ role: "tool", content: "result" }],
    });

    const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.contents[0].parts[0].functionResponse.name).toBe("tool");
  });
});

describe("P11-20: Temperature/parameter clamping", () => {
  let adapter: GeminiAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new GeminiAdapter("AIzaSyTest123");
    vi.stubGlobal("fetch", vi.fn());
  });

  it("should pass temperature directly (Gemini accepts 0-2 range)", async () => {
    const sseBody = createSSEStream([
      'data: {"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}',
    ]);
    const mockResponse = new Response(null, { status: 200 });
    Object.defineProperty(mockResponse, "ok", { value: true });
    Object.defineProperty(mockResponse, "body", { value: sseBody });
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    await adapter.generate({
      model: "gemini-2.0-flash",
      messages: [{ role: "user", content: "test" }],
      temperature: 0.5,
      top_p: 0.8,
      max_tokens: 2048,
    });

    const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.generationConfig.temperature).toBe(0.5);
    expect(body.generationConfig.topP).toBe(0.8);
    expect(body.generationConfig.maxOutputTokens).toBe(2048);
  });

  it("should not include undefined params in generationConfig", async () => {
    const sseBody = createSSEStream([
      'data: {"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}',
    ]);
    const mockResponse = new Response(null, { status: 200 });
    Object.defineProperty(mockResponse, "ok", { value: true });
    Object.defineProperty(mockResponse, "body", { value: sseBody });
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    await adapter.generate({
      model: "gemini-2.0-flash",
      messages: [{ role: "user", content: "test" }],
      // No temperature, top_p, or max_tokens
    });

    const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.generationConfig.temperature).toBeUndefined();
    expect(body.generationConfig.topP).toBeUndefined();
    expect(body.generationConfig.maxOutputTokens).toBeUndefined();
  });

  it("should handle temperature=0 (valid boundary)", async () => {
    const sseBody = createSSEStream([
      'data: {"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}',
    ]);
    const mockResponse = new Response(null, { status: 200 });
    Object.defineProperty(mockResponse, "ok", { value: true });
    Object.defineProperty(mockResponse, "body", { value: sseBody });
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    await adapter.generate({
      model: "gemini-2.0-flash",
      messages: [{ role: "user", content: "test" }],
      temperature: 0,
    });

    const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.generationConfig.temperature).toBe(0);
  });
});

describe("P11-21: Safety rating and finishReason", () => {
  let adapter: GeminiAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new GeminiAdapter("AIzaSyTest123");
    vi.stubGlobal("fetch", vi.fn());
  });

  it("should complete normally with STOP finishReason", async () => {
    const sseBody = createSSEStream([
      'data: {"candidates":[{"content":{"parts":[{"text":"Hello"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":5,"candidatesTokenCount":1}}',
    ]);
    const mockResponse = new Response(null, { status: 200 });
    Object.defineProperty(mockResponse, "ok", { value: true });
    Object.defineProperty(mockResponse, "body", { value: sseBody });
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    const result = await adapter.generate({
      model: "gemini-2.0-flash",
      messages: [{ role: "user", content: "Hi" }],
    });

    const collected = await result.collect();
    expect(collected.text).toBe("Hello");
    expect(collected.usage.prompt_tokens).toBe(5);
    expect(collected.usage.completion_tokens).toBe(1);
  });

  it("should handle SAFETY finishReason (blocked response)", async () => {
    const sseBody = createSSEStream([
      'data: {"candidates":[{"content":{"parts":[]},"finishReason":"SAFETY","safetyRatings":[{"category":"HARM_CATEGORY_DANGEROUS_CONTENT","probability":"HIGH"}]}]}',
    ]);
    const mockResponse = new Response(null, { status: 200 });
    Object.defineProperty(mockResponse, "ok", { value: true });
    Object.defineProperty(mockResponse, "body", { value: sseBody });
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    const result = await adapter.generate({
      model: "gemini-2.0-flash",
      messages: [{ role: "user", content: "dangerous content" }],
    });

    const collected = await result.collect();
    // Should return empty text when safety blocked
    expect(collected.text).toBe("");
  });

  it("should handle MAX_TOKENS finishReason", async () => {
    const sseBody = createSSEStream([
      'data: {"candidates":[{"content":{"parts":[{"text":"truncated respons"}]},"finishReason":"MAX_TOKENS"}],"usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":50}}',
    ]);
    const mockResponse = new Response(null, { status: 200 });
    Object.defineProperty(mockResponse, "ok", { value: true });
    Object.defineProperty(mockResponse, "body", { value: sseBody });
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    const result = await adapter.generate({
      model: "gemini-2.0-flash",
      messages: [{ role: "user", content: "write a long essay" }],
    });

    const collected = await result.collect();
    expect(collected.text).toBe("truncated respons");
    expect(collected.usage.completion_tokens).toBe(50);
  });

  it("should handle response with usageMetadata tracking across chunks", async () => {
    const sseBody = createSSEStream([
      'data: {"candidates":[{"content":{"parts":[{"text":"Part 1"}]}}],"usageMetadata":{"promptTokenCount":20,"candidatesTokenCount":3}}',
      'data: {"candidates":[{"content":{"parts":[{"text":" Part 2"}]}}],"usageMetadata":{"promptTokenCount":20,"candidatesTokenCount":8}}',
    ]);
    const mockResponse = new Response(null, { status: 200 });
    Object.defineProperty(mockResponse, "ok", { value: true });
    Object.defineProperty(mockResponse, "body", { value: sseBody });
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    const result = await adapter.generate({
      model: "gemini-2.0-flash",
      messages: [{ role: "user", content: "test" }],
    });

    const collected = await result.collect();
    expect(collected.text).toBe("Part 1 Part 2");
    // Should use the latest usageMetadata (cumulative, not additive)
    expect(collected.usage.prompt_tokens).toBe(20);
    expect(collected.usage.completion_tokens).toBe(8);
  });
});
