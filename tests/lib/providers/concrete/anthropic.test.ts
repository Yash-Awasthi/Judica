import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock all external dependencies
vi.mock("../../../../src/lib/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../../../src/lib/cost.js", () => ({
  calculateCost: vi.fn().mockReturnValue(0.001),
}));

vi.mock("../../../../src/lib/ssrf.js", () => ({
  validateSafeUrl: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../../src/lib/tools/index.js", () => ({
  getToolDefinitions: vi.fn().mockReturnValue([]),
  callTool: vi.fn().mockResolvedValue({ result: "tool result" }),
}));

vi.mock("../../../../src/lib/breaker.js", () => ({
  getBreaker: vi.fn().mockImplementation((_provider: any, fn: any) => ({
    fire: fn,
  })),
}));

import { AnthropicProvider } from "../../../../src/lib/providers/concrete/anthropic.js";
import { validateSafeUrl } from "../../../../src/lib/ssrf.js";
import { calculateCost } from "../../../../src/lib/cost.js";
import { getToolDefinitions, callTool } from "../../../../src/lib/tools/index.js";

function makeProvider(overrides = {}) {
  return new AnthropicProvider({
    name: "test-anthropic",
    type: "api",
    apiKey: "sk-test-key",
    model: "claude-3-5-sonnet-20241022",
    ...overrides,
  });
}

describe("AnthropicProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getToolDefinitions as any).mockReturnValue([]);
    vi.stubGlobal("fetch", vi.fn());
  });

  it("has correct name and type", () => {
    const provider = makeProvider();
    expect(provider.name).toBe("test-anthropic");
    expect(provider.type).toBe("api");
  });

  it("sends correct headers and body on non-streaming call", async () => {
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        content: [{ type: "text", text: "Hello world" }],
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    };
    (global.fetch as any).mockResolvedValue(mockResponse);

    const provider = makeProvider();
    const result = await provider.call({
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(validateSafeUrl).toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/messages",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "x-api-key": "sk-test-key",
          "anthropic-version": "2023-10-01",
        }),
      })
    );

    expect(result.text).toBe("Hello world");
    expect(result.usage.promptTokens).toBe(10);
    expect(result.usage.completionTokens).toBe(5);
    expect(result.usage.totalTokens).toBe(15);
    expect(calculateCost).toHaveBeenCalledWith("anthropic", "claude-3-5-sonnet-20241022", 10, 5);
  });

  it("uses custom baseUrl when provided", async () => {
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        content: [{ type: "text", text: "response" }],
        usage: { input_tokens: 5, output_tokens: 3 },
      }),
    };
    (global.fetch as any).mockResolvedValue(mockResponse);

    const provider = makeProvider({ baseUrl: "https://custom.api.com/v1/messages" });
    await provider.call({ messages: [{ role: "user", content: "test" }] });

    expect(global.fetch).toHaveBeenCalledWith(
      "https://custom.api.com/v1/messages",
      expect.anything()
    );
  });

  it("throws on API error response", async () => {
    const mockResponse = {
      ok: false,
      status: 429,
      json: vi.fn().mockResolvedValue({ error: { message: "Rate limited" } }),
    };
    (global.fetch as any).mockResolvedValue(mockResponse);

    const provider = makeProvider();
    await expect(
      provider.call({ messages: [{ role: "user", content: "test" }] })
    ).rejects.toThrow("Rate limited");
  });

  it("throws generic error when API error has no message", async () => {
    const mockResponse = {
      ok: false,
      status: 500,
      json: vi.fn().mockRejectedValue(new Error("parse error")),
    };
    (global.fetch as any).mockResolvedValue(mockResponse);

    const provider = makeProvider();
    await expect(
      provider.call({ messages: [{ role: "user", content: "test" }] })
    ).rejects.toThrow("Anthropic API error: 500");
  });

  it("includes system prompt when configured", async () => {
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        content: [{ type: "text", text: "Hello" }],
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    };
    (global.fetch as any).mockResolvedValue(mockResponse);

    const provider = makeProvider({ systemPrompt: "You are helpful." });
    await provider.call({ messages: [{ role: "user", content: "Hi" }] });

    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(body.system).toBe("You are helpful.");
  });

  it("maps system/tool roles to user for Anthropic API", async () => {
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        content: [{ type: "text", text: "ok" }],
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    };
    (global.fetch as any).mockResolvedValue(mockResponse);

    const provider = makeProvider();
    await provider.call({
      messages: [
        { role: "system", content: "Be helpful" },
        { role: "user", content: "Hi" },
        { role: "tool", content: "result" },
      ],
    });

    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(body.messages[0].role).toBe("user");
    expect(body.messages[2].role).toBe("user");
  });

  it("handles tool calls and recurses", async () => {
    const toolResponse = {
      ok: true,
      json: vi.fn().mockResolvedValueOnce({
        content: [{ type: "tool_use", id: "tc1", name: "search", input: { q: "test" } }],
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    };
    const finalResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        content: [{ type: "text", text: "Final answer" }],
        usage: { input_tokens: 20, output_tokens: 10 },
      }),
    };
    (global.fetch as any)
      .mockResolvedValueOnce(toolResponse)
      .mockResolvedValueOnce(finalResponse);

    (getToolDefinitions as any).mockReturnValue([]);
    (callTool as any).mockResolvedValue({ result: "search results" });

    const provider = makeProvider();
    const result = await provider.call({
      messages: [{ role: "user", content: "search for something" }],
    });

    expect(callTool).toHaveBeenCalledWith({
      id: "tc1",
      name: "search",
      arguments: { q: "test" },
    });
    expect(result.text).toBe("Final answer");
  });

  it("throws when tool call depth limit is exceeded", async () => {
    const provider = makeProvider();
    await expect(
      provider.call({
        messages: [{ role: "user", content: "test" }],
        _depth: 10,
      })
    ).rejects.toThrow("Tool call depth limit exceeded");
  });

  it("returns empty text when no text content block", async () => {
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        content: [],
        usage: { input_tokens: 5, output_tokens: 0 },
      }),
    };
    (global.fetch as any).mockResolvedValue(mockResponse);

    const provider = makeProvider();
    const result = await provider.call({
      messages: [{ role: "user", content: "test" }],
    });
    expect(result.text).toBe("");
  });

  it("uses default model and maxTokens", async () => {
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        content: [{ type: "text", text: "ok" }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    };
    (global.fetch as any).mockResolvedValue(mockResponse);

    const provider = makeProvider({ model: undefined });
    await provider.call({ messages: [{ role: "user", content: "test" }] });

    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(body.model).toBe("claude-3-5-sonnet-20241022");
    expect(body.max_tokens).toBe(4096);
  });

  it("re-throws AbortError", async () => {
    const abortError = new Error("AbortError");
    abortError.name = "AbortError";
    (global.fetch as any).mockRejectedValue(abortError);

    const provider = makeProvider();
    await expect(
      provider.call({ messages: [{ role: "user", content: "test" }] })
    ).rejects.toThrow("AbortError");
  });
});
