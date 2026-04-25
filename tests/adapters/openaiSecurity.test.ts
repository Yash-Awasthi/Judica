import { describe, it, expect, vi, beforeEach } from "vitest";

// P11-30: Tool-call parse errors
// P11-31: Unknown content block coercion
// P11-32: Cost accumulation end-to-end
// P11-33: Function-call-only response
// P11-34: Provider ID ambiguity
// P11-35: Reasoning/thinking token tracking

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

vi.mock("../../src/lib/drizzle.js", () => ({
  db: {
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockResolvedValue([]),
      limit: vi.fn().mockResolvedValue([]),
    }),
  },
}));

import { OpenAIAdapter } from "../../src/adapters/openai.adapter.js";
import { calculateCost } from "../../src/lib/cost.js";

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

describe("P11-30: Tool-call parse errors", () => {
  let adapter: OpenAIAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new OpenAIAdapter("sk-test-key");
    vi.stubGlobal("fetch", vi.fn());
  });

  it("should handle malformed tool arguments JSON gracefully", async () => {
    const sseBody = createSSEStream([
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"search","arguments":""}}]}}]}',
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"q\\": invalid"}}]}}]}',
      'data: {"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}',
      "data: [DONE]",
    ]);
    const mockResponse = new Response(null, { status: 200 });
    Object.defineProperty(mockResponse, "ok", { value: true });
    Object.defineProperty(mockResponse, "body", { value: sseBody });
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    const result = await adapter.generate({
      model: "gpt-4o",
      messages: [{ role: "user", content: "test" }],
    });

    const collected = await result.collect();
    // Tool call should still be emitted even with malformed JSON
    expect(collected.tool_calls).toHaveLength(1);
    expect(collected.tool_calls[0].name).toBe("search");
    // Arguments should be kept as raw string when JSON parsing fails
    const args = collected.tool_calls[0].arguments;
    expect(args).toBeDefined();
  });
});

describe("P11-31: Unknown content block coercion", () => {
  let adapter: OpenAIAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new OpenAIAdapter("sk-test-key");
    vi.stubGlobal("fetch", vi.fn());
  });

  it("should format unknown content block types as text fallback", async () => {
    const sseBody = createSSEStream([
      'data: {"choices":[{"delta":{"content":"response"}}]}',
      "data: [DONE]",
    ]);
    const mockResponse = new Response(null, { status: 200 });
    Object.defineProperty(mockResponse, "ok", { value: true });
    Object.defineProperty(mockResponse, "body", { value: sseBody });
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    await adapter.generate({
      model: "gpt-4o",
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "Hello" },
          { type: "unknown_type" as any, text: "fallback" },
        ],
      }],
    });

    const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    const content = body.messages[0].content;
    // text blocks pass through
    expect(content[0]).toEqual({ type: "text", text: "Hello" });
    // unknown blocks get converted to text
    expect(content[1]).toEqual({ type: "text", text: "fallback" });
  });
});

describe("P11-32: Cost accumulation end-to-end via stream", () => {
  let adapter: OpenAIAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new OpenAIAdapter("sk-test-key");
    vi.stubGlobal("fetch", vi.fn());
  });

  it("should accumulate usage from multi-chunk stream and compute correct cost", async () => {
    const sseBody = createSSEStream([
      'data: {"choices":[{"delta":{"content":"Hello"}}]}',
      'data: {"choices":[{"delta":{"content":" world"}}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":50,"completion_tokens":10}}',
      "data: [DONE]",
    ]);
    const mockResponse = new Response(null, { status: 200 });
    Object.defineProperty(mockResponse, "ok", { value: true });
    Object.defineProperty(mockResponse, "body", { value: sseBody });
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    const result = await adapter.generate({
      model: "gpt-4o",
      messages: [{ role: "user", content: "test" }],
    });

    const collected = await result.collect();
    expect(collected.text).toBe("Hello world");
    expect(collected.usage.prompt_tokens).toBe(50);
    expect(collected.usage.completion_tokens).toBe(10);

    // Verify cost calculation with real pricing
    const cost = calculateCost("openai", "gpt-4o", 50, 10);
    const expected = (50 * 0.0025 + 10 * 0.01) / 1000;
    expect(cost).toBeCloseTo(expected, 10);
  });
});

describe("P11-33: Function-call-only response (no text)", () => {
  let adapter: OpenAIAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new OpenAIAdapter("sk-test-key");
    vi.stubGlobal("fetch", vi.fn());
  });

  it("should handle response with only tool calls and no text content", async () => {
    const sseBody = createSSEStream([
      'data: {"choices":[{"index":0,"delta":{"role":"assistant","tool_calls":[{"index":0,"id":"call_abc","type":"function","function":{"name":"get_weather","arguments":""}}]}}]}',
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"city\\":"}}]}}]}',
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"NYC\\"}"}}]}}]}',
      'data: {"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":20,"completion_tokens":15}}',
      "data: [DONE]",
    ]);
    const mockResponse = new Response(null, { status: 200 });
    Object.defineProperty(mockResponse, "ok", { value: true });
    Object.defineProperty(mockResponse, "body", { value: sseBody });
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    const result = await adapter.generate({
      model: "gpt-4o",
      messages: [{ role: "user", content: "weather in NYC?" }],
    });

    const collected = await result.collect();
    // Text should be empty
    expect(collected.text).toBe("");
    // Tool calls should be properly parsed
    expect(collected.tool_calls).toHaveLength(1);
    expect(collected.tool_calls[0].id).toBe("call_abc");
    expect(collected.tool_calls[0].name).toBe("get_weather");
    expect(collected.tool_calls[0].arguments).toEqual({ city: "NYC" });
  });
});

describe("P11-34: Provider ID differentiation", () => {
  it("should default providerId to 'openai'", () => {
    const adapter = new OpenAIAdapter("sk-test");
    expect(adapter.providerId).toBe("openai");
  });

  it("should accept custom providerId for OpenAI-compatible endpoints", () => {
    const adapter = new OpenAIAdapter("sk-test", "https://custom.api.com/v1", "openai-compat");
    expect(adapter.providerId).toBe("openai-compat");
  });

  it("should use the correct base URL for custom provider", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const adapter = new OpenAIAdapter("sk-test", "https://custom.api.com/v1", "custom-openai");

    const sseBody = createSSEStream([
      'data: {"choices":[{"delta":{"content":"ok"}}]}',
      "data: [DONE]",
    ]);
    const mockResponse = new Response(null, { status: 200 });
    Object.defineProperty(mockResponse, "ok", { value: true });
    Object.defineProperty(mockResponse, "body", { value: sseBody });
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    await adapter.generate({
      model: "local-model",
      messages: [{ role: "user", content: "test" }],
    });

    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toBe("https://custom.api.com/v1/chat/completions");
  });
});

describe("P11-35: Reasoning/thinking token tracking", () => {
  let adapter: OpenAIAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new OpenAIAdapter("sk-test-key");
    vi.stubGlobal("fetch", vi.fn());
  });

  it("should track usage including reasoning tokens from o1/o3 models", async () => {
    const sseBody = createSSEStream([
      'data: {"choices":[{"delta":{"content":"The answer is 42."}}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":100,"completion_tokens":50,"completion_tokens_details":{"reasoning_tokens":30}}}',
      "data: [DONE]",
    ]);
    const mockResponse = new Response(null, { status: 200 });
    Object.defineProperty(mockResponse, "ok", { value: true });
    Object.defineProperty(mockResponse, "body", { value: sseBody });
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    const result = await adapter.generate({
      model: "o1",
      messages: [{ role: "user", content: "What is 6*7?" }],
    });

    const collected = await result.collect();
    expect(collected.text).toBe("The answer is 42.");
    // Total completion tokens include reasoning tokens
    expect(collected.usage.prompt_tokens).toBe(100);
    expect(collected.usage.completion_tokens).toBe(50);
  });

  it("should include stream_options for usage tracking", async () => {
    const sseBody = createSSEStream([
      'data: {"choices":[{"delta":{"content":"ok"}}]}',
      "data: [DONE]",
    ]);
    const mockResponse = new Response(null, { status: 200 });
    Object.defineProperty(mockResponse, "ok", { value: true });
    Object.defineProperty(mockResponse, "body", { value: sseBody });
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    await adapter.generate({
      model: "gpt-4o",
      messages: [{ role: "user", content: "test" }],
    });

    const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    // OpenAI adapter should include stream_options to get usage in streaming
    expect(body.stream_options).toEqual({ include_usage: true });
  });
});
