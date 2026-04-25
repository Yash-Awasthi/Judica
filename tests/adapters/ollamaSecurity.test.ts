import { describe, it, expect, vi, beforeEach } from "vitest";

// P11-25: SSRF localhost bypass tested as rejection
// P11-26: Tool role mapping verification
// P11-27: Auth header tests
// P11-28: NDJSON fragmentation
// P11-29: Tool call support

vi.mock("../../src/lib/ssrf.js", () => ({
  validateSafeUrl: vi.fn().mockRejectedValue(new Error("SSRF: blocked non-local URL")),
}));

vi.mock("../../src/lib/breaker.js", () => ({
  getBreaker: vi.fn((_provider: any, action: any) => ({
    fire: (...args: any[]) => action(...args),
  })),
}));

vi.mock("../../src/lib/logger.js", () => ({
  default: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { OllamaAdapter } from "../../src/adapters/ollama.adapter.js";
import { validateSafeUrl } from "../../src/lib/ssrf.js";

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

describe("P11-25: SSRF localhost handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("should NOT call validateSafeUrl for localhost (allowed by design)", async () => {
    const adapter = new OllamaAdapter("http://localhost:11434");

    const chatStream = createNDJSONStream([
      '{"message":{"content":"hi"},"done":false}',
      '{"message":{"content":""},"done":true,"prompt_eval_count":5,"eval_count":2}',
    ]);
    const chatResponse = new Response(null, { status: 200 });
    Object.defineProperty(chatResponse, "ok", { value: true });
    Object.defineProperty(chatResponse, "body", { value: chatStream });

    (globalThis.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(chatResponse);

    const result = await adapter.generate({
      model: "llama3.2",
      messages: [{ role: "user", content: "hi" }],
    });

    const collected = await result.collect();
    expect(collected.text).toBe("hi");
    // validateSafeUrl should NOT be called for localhost
    expect(validateSafeUrl).not.toHaveBeenCalled();
  });

  it("should call validateSafeUrl for non-localhost URLs", async () => {
    const adapter = new OllamaAdapter("https://remote-ollama.example.com:11434");

    await expect(
      adapter.generate({
        model: "llama3.2",
        messages: [{ role: "user", content: "test" }],
      })
    ).rejects.toThrow("SSRF");

    expect(validateSafeUrl).toHaveBeenCalledWith("https://remote-ollama.example.com:11434");
  });

  it("should treat 127.0.0.1 as localhost (skip SSRF)", async () => {
    const adapter = new OllamaAdapter("http://127.0.0.1:11434");

    const chatStream = createNDJSONStream([
      '{"message":{"content":"ok"},"done":true,"prompt_eval_count":1,"eval_count":1}',
    ]);
    const chatResponse = new Response(null, { status: 200 });
    Object.defineProperty(chatResponse, "ok", { value: true });
    Object.defineProperty(chatResponse, "body", { value: chatStream });

    (globalThis.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(chatResponse);

    const result = await adapter.generate({
      model: "llama3.2",
      messages: [{ role: "user", content: "test" }],
    });

    const collected = await result.collect();
    expect(collected.text).toBe("ok");
    expect(validateSafeUrl).not.toHaveBeenCalled();
  });
});

describe("P11-26: Tool role mapping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("should map 'tool' role to 'user' in Ollama messages (known limitation)", async () => {
    const adapter = new OllamaAdapter("http://localhost:11434");

    const chatStream = createNDJSONStream([
      '{"message":{"content":"received"},"done":true,"prompt_eval_count":10,"eval_count":3}',
    ]);
    const chatResponse = new Response(null, { status: 200 });
    Object.defineProperty(chatResponse, "ok", { value: true });
    Object.defineProperty(chatResponse, "body", { value: chatStream });

    (globalThis.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(chatResponse);

    await adapter.generate({
      model: "llama3.2",
      messages: [
        { role: "user", content: "search" },
        { role: "tool", content: '{"result":"data"}', tool_call_id: "tc_1" },
      ],
    });

    // Verify that the API request body maps tool->user
    const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.messages[1].role).toBe("user");
    expect(body.messages[1].content).toBe('{"result":"data"}');
  });
});

describe("P11-27: Auth header for protected Ollama instances", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("should not send auth headers by default (local Ollama)", async () => {
    const adapter = new OllamaAdapter("http://localhost:11434");

    const chatStream = createNDJSONStream([
      '{"message":{"content":"ok"},"done":true,"prompt_eval_count":1,"eval_count":1}',
    ]);
    const chatResponse = new Response(null, { status: 200 });
    Object.defineProperty(chatResponse, "ok", { value: true });
    Object.defineProperty(chatResponse, "body", { value: chatStream });

    (globalThis.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(chatResponse);

    await adapter.generate({
      model: "llama3.2",
      messages: [{ role: "user", content: "test" }],
    });

    const headers = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].headers;
    expect(headers["Authorization"]).toBeUndefined();
    expect(headers["Content-Type"]).toBe("application/json");
  });
});

describe("P11-28: NDJSON fragmentation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("should parse multiple NDJSON lines from a single chunk", async () => {
    const adapter = new OllamaAdapter("http://localhost:11434");

    const chatStream = createNDJSONStream([
      '{"message":{"content":"Hello"},"done":false}',
      '{"message":{"content":" world"},"done":false}',
      '{"message":{"content":"!"},"done":true,"prompt_eval_count":8,"eval_count":3}',
    ]);
    const chatResponse = new Response(null, { status: 200 });
    Object.defineProperty(chatResponse, "ok", { value: true });
    Object.defineProperty(chatResponse, "body", { value: chatStream });

    (globalThis.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(chatResponse);

    const result = await adapter.generate({
      model: "llama3.2",
      messages: [{ role: "user", content: "test" }],
    });

    const collected = await result.collect();
    expect(collected.text).toBe("Hello world!");
    expect(collected.usage.prompt_tokens).toBe(8);
    expect(collected.usage.completion_tokens).toBe(3);
  });

  it("should handle split JSON across multiple read() calls", async () => {
    const adapter = new OllamaAdapter("http://localhost:11434");

    // Simulate fragmented delivery (partial JSON in first chunk)
    const encoder = new TextEncoder();
    const chatStream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('{"message":{"content":"frag'));
        controller.enqueue(encoder.encode('mented"},"done":true,"prompt_eval_count":5,"eval_count":1}\n'));
        controller.close();
      },
    });
    const chatResponse = new Response(null, { status: 200 });
    Object.defineProperty(chatResponse, "ok", { value: true });
    Object.defineProperty(chatResponse, "body", { value: chatStream });

    (globalThis.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(chatResponse);

    const result = await adapter.generate({
      model: "llama3.2",
      messages: [{ role: "user", content: "test" }],
    });

    const collected = await result.collect();
    expect(collected.text).toBe("fragmented");
    expect(collected.usage.prompt_tokens).toBe(5);
  });
});

describe("P11-29: Tool call support", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("should send tool definitions in request body", async () => {
    const adapter = new OllamaAdapter("http://localhost:11434");

    const chatStream = createNDJSONStream([
      '{"message":{"role":"assistant","content":"","tool_calls":[{"function":{"name":"get_weather","arguments":{"city":"NYC"}}}]},"done":true,"prompt_eval_count":10,"eval_count":5}',
    ]);
    const chatResponse = new Response(null, { status: 200 });
    Object.defineProperty(chatResponse, "ok", { value: true });
    Object.defineProperty(chatResponse, "body", { value: chatStream });

    (globalThis.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(chatResponse);

    const result = await adapter.generate({
      model: "llama3.2",
      messages: [{ role: "user", content: "weather in NYC?" }],
      tools: [{ name: "get_weather", description: "Get weather", parameters: { type: "object", properties: { city: { type: "string" } } } }],
    });

    // Verify tools sent in request
    const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0].function.name).toBe("get_weather");

    // Verify tool call parsed from response
    const collected = await result.collect();
    expect(collected.tool_calls).toHaveLength(1);
    expect(collected.tool_calls[0].name).toBe("get_weather");
    expect(collected.tool_calls[0].arguments).toEqual({ city: "NYC" });
  });
});
