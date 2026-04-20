import { describe, it, expect, vi, beforeEach } from "vitest";

// P11-37: Double JSON stringify risk
// P11-38: OpenRouter-specific error format

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

describe("P11-37: Double JSON stringify prevention", () => {
  let adapter: OpenRouterAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new OpenRouterAdapter("sk-or-test");
    vi.stubGlobal("fetch", vi.fn());
  });

  it("should serialize tool arguments correctly (no double-encoding)", async () => {
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
      messages: [
        { role: "user", content: "search" },
        {
          role: "assistant",
          content: "",
          tool_calls: [{ id: "call_1", name: "search", arguments: { query: "test" } }],
        },
        { role: "tool", content: '{"result": "found"}', tool_call_id: "call_1" },
      ],
    });

    const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    // The assistant message should have tool_calls with arguments as a JSON string
    const toolCall = body.messages[1].tool_calls[0];
    expect(toolCall.function.arguments).toBe('{"query":"test"}');
    // Verify it's NOT double-encoded (e.g., '"{\"query\":\"test\"}"')
    expect(toolCall.function.arguments).not.toContain('\\"');
    // Parse should work on first try
    expect(JSON.parse(toolCall.function.arguments)).toEqual({ query: "test" });
  });
});

describe("P11-38: OpenRouter-specific error format", () => {
  let adapter: OpenRouterAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new OpenRouterAdapter("sk-or-test");
    vi.stubGlobal("fetch", vi.fn());
  });

  it("should parse standard OpenAI error format from OpenRouter", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(
        JSON.stringify({ error: { message: "No credits remaining", code: 402 } }),
        { status: 402 }
      )
    );

    await expect(
      adapter.generate({
        model: "openai/gpt-4o",
        messages: [{ role: "user", content: "test" }],
      })
    ).rejects.toThrow("No credits remaining");
  });

  it("should handle OpenRouter error with no message (fallback to status)", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response("Service Unavailable", { status: 503 })
    );

    await expect(
      adapter.generate({
        model: "openai/gpt-4o",
        messages: [{ role: "user", content: "test" }],
      })
    ).rejects.toThrow("OpenRouter API error: 503");
  });

  it("should handle OpenRouter model-not-found format", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(
        JSON.stringify({ error: { message: "Model 'invalid/model' not found" } }),
        { status: 404 }
      )
    );

    await expect(
      adapter.generate({
        model: "invalid/model",
        messages: [{ role: "user", content: "test" }],
      })
    ).rejects.toThrow("not found");
  });
});
