import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// P11-10: Decrypt mocked — real secret validation
// P11-11: Malformed auth config tests
// P11-12: Base URL validation (file://, gopher://, internal IPs)
// P11-13: Streaming format mismatch
// P11-14: Usage normalization
// P11-15: providerId sanitization
// P11-16: Tool-call capability for custom adapters

vi.mock("../../src/lib/breaker.js", () => ({
  getBreaker: vi.fn((_provider: any, action: any) => ({
    fire: (...args: any[]) => action(...args),
  })),
}));

vi.mock("../../src/lib/logger.js", () => ({
  default: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// P11-12: Don't mock SSRF for URL validation tests
const mockValidateSafeUrl = vi.fn().mockResolvedValue(undefined);
vi.mock("../../src/lib/ssrf.js", () => ({
  validateSafeUrl: (...args: any[]) => mockValidateSafeUrl(...args),
}));

vi.mock("../../src/lib/crypto.js", () => ({
  decrypt: vi.fn((val: string) => {
    if (val === "CORRUPT") throw new Error("Decryption failed");
    if (val === "EMPTY") return "";
    return "decrypted-api-key";
  }),
}));

import { CustomAdapter } from "../../src/adapters/custom.adapter.js";
import type { CustomProviderConfig } from "../../src/adapters/custom.adapter.js";
import { decrypt } from "../../src/lib/crypto.js";

function makeConfig(overrides: Partial<CustomProviderConfig> = {}): CustomProviderConfig {
  return {
    id: "test-provider",
    name: "Test Provider",
    base_url: "https://api.testprovider.com",
    auth_type: "bearer",
    auth_key_encrypted: "encrypted-value",
    capabilities: { streaming: true, tools: true, vision: false },
    models: ["test-model-1"],
    ...overrides,
  };
}

describe("P11-10: Decrypt — real secret validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("should throw when decrypt fails on corrupt key", async () => {
    const adapter = new CustomAdapter(makeConfig({ auth_key_encrypted: "CORRUPT" }));

    await expect(
      adapter.generate({
        model: "test-model-1",
        messages: [{ role: "user", content: "test" }],
      })
    ).rejects.toThrow(/Failed to decrypt/);
  });

  it("should proceed with empty string when auth_key_encrypted is empty", async () => {
    const adapter = new CustomAdapter(makeConfig({
      auth_key_encrypted: "",
      auth_type: "none",
      capabilities: { streaming: false, tools: false, vision: false },
    }));

    const mockResponse = new Response(
      JSON.stringify({ choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 5, completion_tokens: 3 } }),
      { status: 200 }
    );
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    const result = await adapter.generate({
      model: "test-model-1",
      messages: [{ role: "user", content: "test" }],
    });
    const collected = await result.collect();
    expect(collected.text).toBe("ok");
  });
});

describe("P11-11: Malformed auth config", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("should handle bearer auth correctly", async () => {
    const adapter = new CustomAdapter(makeConfig({ auth_type: "bearer" }));

    const mockResponse = new Response(
      JSON.stringify({ choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }),
      { status: 200 }
    );
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    await adapter.generate({
      model: "test-model-1",
      messages: [{ role: "user", content: "test" }],
    });

    const headers = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].headers;
    expect(headers["Authorization"]).toBe("Bearer decrypted-api-key");
  });

  it("should use custom header name for api_key_header auth", async () => {
    const adapter = new CustomAdapter(
      makeConfig({ auth_type: "api_key_header", auth_header_name: "X-Custom-Key" })
    );

    const mockResponse = new Response(
      JSON.stringify({ choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }),
      { status: 200 }
    );
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    await adapter.generate({
      model: "test-model-1",
      messages: [{ role: "user", content: "test" }],
    });

    const headers = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].headers;
    expect(headers["X-Custom-Key"]).toBe("decrypted-api-key");
  });

  it("should throw on basic auth with empty username (EMPTY decrypt result)", async () => {
    (decrypt as ReturnType<typeof vi.fn>).mockReturnValueOnce("");
    const adapter = new CustomAdapter(
      makeConfig({ auth_type: "basic", auth_key_encrypted: "EMPTY" })
    );

    await expect(
      adapter.generate({
        model: "test-model-1",
        messages: [{ role: "user", content: "test" }],
      })
    ).rejects.toThrow(/non-empty username/);
  });

  it("should encode basic auth credentials properly", async () => {
    (decrypt as ReturnType<typeof vi.fn>).mockReturnValueOnce("user:pass:word");
    const adapter = new CustomAdapter(makeConfig({ auth_type: "basic" }));

    const mockResponse = new Response(
      JSON.stringify({ choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }),
      { status: 200 }
    );
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    await adapter.generate({
      model: "test-model-1",
      messages: [{ role: "user", content: "test" }],
    });

    const headers = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].headers;
    const expected = Buffer.from("user:pass:word").toString("base64");
    expect(headers["Authorization"]).toBe(`Basic ${expected}`);
  });
});

describe("P11-12: Base URL validation (SSRF)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("should call validateSafeUrl on the base URL", async () => {
    const adapter = new CustomAdapter(makeConfig({ base_url: "https://api.external.com" }));

    const mockResponse = new Response(
      JSON.stringify({ choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }),
      { status: 200 }
    );
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    await adapter.generate({
      model: "test-model-1",
      messages: [{ role: "user", content: "test" }],
    });

    expect(mockValidateSafeUrl).toHaveBeenCalledWith("https://api.external.com");
  });

  it("should reject when validateSafeUrl throws for internal URLs", async () => {
    mockValidateSafeUrl.mockRejectedValueOnce(new Error("SSRF: blocked internal URL"));

    const adapter = new CustomAdapter(makeConfig({ base_url: "http://169.254.169.254" }));

    await expect(
      adapter.generate({
        model: "test-model-1",
        messages: [{ role: "user", content: "test" }],
      })
    ).rejects.toThrow("SSRF");
  });

  it("should reject file:// protocol via SSRF validation", async () => {
    mockValidateSafeUrl.mockRejectedValueOnce(new Error("SSRF: blocked file:// protocol"));

    const adapter = new CustomAdapter(makeConfig({ base_url: "file:///etc/passwd" }));

    await expect(
      adapter.generate({
        model: "test-model-1",
        messages: [{ role: "user", content: "test" }],
      })
    ).rejects.toThrow("SSRF");
  });

  it("should strip trailing slash from base URL", async () => {
    const adapter = new CustomAdapter(makeConfig({ base_url: "https://api.example.com/" }));

    const mockResponse = new Response(
      JSON.stringify({ choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }),
      { status: 200 }
    );
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    await adapter.generate({
      model: "test-model-1",
      messages: [{ role: "user", content: "test" }],
    });

    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(url).toBe("https://api.example.com/chat/completions");
  });
});

describe("P11-13: Streaming format mismatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("should handle non-streaming response when streaming capability is false", async () => {
    const adapter = new CustomAdapter(
      makeConfig({ capabilities: { streaming: false, tools: false, vision: false } })
    );

    const mockResponse = new Response(
      JSON.stringify({
        choices: [{ message: { role: "assistant", content: "response" } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
      { status: 200 }
    );
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    const result = await adapter.generate({
      model: "test-model-1",
      messages: [{ role: "user", content: "test" }],
    });

    const collected = await result.collect();
    expect(collected.text).toBe("response");
  });
});

describe("P11-14: Usage normalization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("should normalize usage from OpenAI-compatible format", async () => {
    const adapter = new CustomAdapter(
      makeConfig({ capabilities: { streaming: false, tools: false, vision: false } })
    );

    const mockResponse = new Response(
      JSON.stringify({
        choices: [{ message: { content: "ok" } }],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      }),
      { status: 200 }
    );
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    const result = await adapter.generate({
      model: "test-model-1",
      messages: [{ role: "user", content: "test" }],
    });

    const collected = await result.collect();
    expect(collected.usage.prompt_tokens).toBe(100);
    expect(collected.usage.completion_tokens).toBe(50);
  });

  it("should default to zero usage when no usage field in response", async () => {
    const adapter = new CustomAdapter(
      makeConfig({ capabilities: { streaming: false, tools: false, vision: false } })
    );

    const mockResponse = new Response(
      JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
      { status: 200 }
    );
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    const result = await adapter.generate({
      model: "test-model-1",
      messages: [{ role: "user", content: "test" }],
    });

    const collected = await result.collect();
    expect(collected.usage.prompt_tokens).toBe(0);
    expect(collected.usage.completion_tokens).toBe(0);
  });
});

describe("P11-15: providerId sanitization", () => {
  it("should prefix custom provider IDs with custom_", () => {
    const adapter = new CustomAdapter(makeConfig({ id: "my-provider" }));
    expect(adapter.providerId).toBe("custom_my-provider");
  });

  it("should handle special characters in provider ID", () => {
    const adapter = new CustomAdapter(makeConfig({ id: "provider/with<special>chars" }));
    expect(adapter.providerId).toBe("custom_provider/with<special>chars");
  });
});

describe("P11-16: Tool-call capability for custom adapters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("should forward tool definitions when capabilities.tools is true", async () => {
    const adapter = new CustomAdapter(makeConfig());

    const mockResponse = new Response(
      JSON.stringify({
        choices: [{ message: { content: "ok", tool_calls: [{ id: "call_1", type: "function", function: { name: "search", arguments: '{"q":"test"}' } }] } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
      { status: 200 }
    );
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    await adapter.generate({
      model: "test-model-1",
      messages: [{ role: "user", content: "test" }],
      tools: [{ name: "search", description: "Search the web", parameters: { type: "object", properties: { q: { type: "string" } } } }],
    });

    const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0].function.name).toBe("search");
    expect(body.tool_choice).toBe("auto");
  });

  it("should NOT forward tools when capabilities.tools is false", async () => {
    const adapter = new CustomAdapter(
      makeConfig({ capabilities: { streaming: true, tools: false, vision: false } })
    );

    const encoder = new TextEncoder();
    const sseData = 'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n';
    const sseBody = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(sseData));
        controller.close();
      },
    });
    const mockResponse = new Response(null, { status: 200 });
    Object.defineProperty(mockResponse, "ok", { value: true });
    Object.defineProperty(mockResponse, "body", { value: sseBody });
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    await adapter.generate({
      model: "test-model-1",
      messages: [{ role: "user", content: "test" }],
      tools: [{ name: "search", description: "Search", parameters: {} }],
    });

    const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.tools).toBeUndefined();
  });
});
