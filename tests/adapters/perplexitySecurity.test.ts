import { describe, it, expect, vi, beforeEach } from "vitest";

// P11-39: Citations field handling
// P11-40: Search parameters
// P11-41: Tools rejection for Perplexity

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

import { OpenAIAdapter } from "../../src/adapters/openai.adapter.js";

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

describe("P11-39: Perplexity citations field", () => {
  let adapter: OpenAIAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new OpenAIAdapter("pplx-test", "https://api.perplexity.ai", "perplexity");
    vi.stubGlobal("fetch", vi.fn());
  });

  it("should stream text even when response includes citations metadata", async () => {
    // Perplexity may include citations in the response, but the text stream should still work
    const sseBody = createSSEStream([
      'data: {"choices":[{"delta":{"content":"The answer is 42."}}]}',
      'data: {"choices":[{"delta":{"content":" [1]"}}]}',
      'data: {"usage":{"prompt_tokens":10,"completion_tokens":5},"citations":["https://example.com"]}',
      "data: [DONE]",
    ]);
    const mockResponse = new Response(null, { status: 200 });
    Object.defineProperty(mockResponse, "ok", { value: true });
    Object.defineProperty(mockResponse, "body", { value: sseBody });
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    const result = await adapter.generate({
      model: "llama-3.1-sonar-large-128k-online",
      messages: [{ role: "user", content: "What is the meaning of life?" }],
    });

    const collected = await result.collect();
    expect(collected.text).toBe("The answer is 42. [1]");
    expect(collected.usage.prompt_tokens).toBe(10);
    expect(collected.usage.completion_tokens).toBe(5);
  });
});

describe("P11-40: Perplexity search parameters", () => {
  let adapter: OpenAIAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new OpenAIAdapter("pplx-test", "https://api.perplexity.ai", "perplexity");
    vi.stubGlobal("fetch", vi.fn());
  });

  it("should send request to correct Perplexity endpoint", async () => {
    const sseBody = createSSEStream([
      'data: {"choices":[{"delta":{"content":"result"}}]}',
      "data: [DONE]",
    ]);
    const mockResponse = new Response(null, { status: 200 });
    Object.defineProperty(mockResponse, "ok", { value: true });
    Object.defineProperty(mockResponse, "body", { value: sseBody });
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    await adapter.generate({
      model: "llama-3.1-sonar-large-128k-online",
      messages: [{ role: "user", content: "search query" }],
      system_prompt: "Be concise",
    });

    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(url).toBe("https://api.perplexity.ai/chat/completions");

    const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.model).toBe("llama-3.1-sonar-large-128k-online");
    expect(body.messages[0]).toEqual({ role: "system", content: "Be concise" });
  });
});

describe("P11-41: Tools incorrectly enabled for Perplexity", () => {
  let adapter: OpenAIAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new OpenAIAdapter("pplx-test", "https://api.perplexity.ai", "perplexity");
    vi.stubGlobal("fetch", vi.fn());
  });

  it("should forward tools in request (adapter does not filter — documented risk)", async () => {
    // P11-41: The OpenAI-compatible adapter doesn't filter tools by provider.
    // Perplexity doesn't support function calling, so sending tools will cause API errors.
    // This test documents the current behavior (tools ARE sent) as a known limitation.
    const sseBody = createSSEStream([
      'data: {"choices":[{"delta":{"content":"I cannot use tools"}}]}',
      "data: [DONE]",
    ]);
    const mockResponse = new Response(null, { status: 200 });
    Object.defineProperty(mockResponse, "ok", { value: true });
    Object.defineProperty(mockResponse, "body", { value: sseBody });
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    await adapter.generate({
      model: "llama-3.1-sonar-large-128k-online",
      messages: [{ role: "user", content: "test" }],
      tools: [{ name: "search", description: "Search", parameters: { type: "object" } }],
    });

    const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    // Documenting that tools ARE forwarded (known risk for Perplexity)
    expect(body.tools).toHaveLength(1);
    expect(body.tool_choice).toBe("auto");
  });
});
