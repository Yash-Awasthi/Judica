import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../src/lib/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../../../src/lib/cost.js", () => ({
  calculateCost: vi.fn().mockReturnValue(0.002),
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

import { OpenAIProvider } from "../../../../src/lib/providers/concrete/openai.js";
import { calculateCost } from "../../../../src/lib/cost.js";
import { getToolDefinitions, callTool } from "../../../../src/lib/tools/index.js";

function makeProvider(overrides = {}) {
  return new OpenAIProvider({
    name: "test-openai",
    type: "api",
    apiKey: "sk-test-key",
    model: "gpt-4o",
    ...overrides,
  });
}

describe("OpenAIProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getToolDefinitions as any).mockReturnValue([]);
    vi.stubGlobal("fetch", vi.fn());
  });

  it("has correct name and type", () => {
    const provider = makeProvider();
    expect(provider.name).toBe("test-openai");
    expect(provider.type).toBe("api");
  });

  it("sends correct request to /chat/completions", async () => {
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        choices: [{ message: { content: "Hello!" } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    };
    (global.fetch as any).mockResolvedValue(mockResponse);

    const provider = makeProvider();
    const result = await provider.call({
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.openai.com/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer sk-test-key",
        }),
      })
    );

    expect(result.text).toBe("Hello!");
    expect(result.usage.promptTokens).toBe(10);
    expect(result.usage.completionTokens).toBe(5);
    expect(result.usage.totalTokens).toBe(15);
  });

  it("strips <think> tags from response", async () => {
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        choices: [{ message: { content: "<think>reasoning</think>The answer is 42" } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    };
    (global.fetch as any).mockResolvedValue(mockResponse);

    const provider = makeProvider();
    const result = await provider.call({
      messages: [{ role: "user", content: "test" }],
    });

    expect(result.text).toBe("The answer is 42");
  });

  it("includes system prompt in messages when configured", async () => {
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        choices: [{ message: { content: "ok" } }],
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
      }),
    };
    (global.fetch as any).mockResolvedValue(mockResponse);

    const provider = makeProvider({ systemPrompt: "Be helpful." });
    await provider.call({ messages: [{ role: "user", content: "test" }] });

    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(body.messages[0]).toEqual({ role: "system", content: "Be helpful." });
  });

  it("throws on API error", async () => {
    const mockResponse = {
      ok: false,
      status: 401,
      json: vi.fn().mockResolvedValue({ error: { message: "Unauthorized" } }),
    };
    (global.fetch as any).mockResolvedValue(mockResponse);

    const provider = makeProvider();
    await expect(
      provider.call({ messages: [{ role: "user", content: "test" }] })
    ).rejects.toThrow("Unauthorized");
  });

  it("throws generic error when error response has no message", async () => {
    const mockResponse = {
      ok: false,
      status: 500,
      json: vi.fn().mockRejectedValue(new Error("json parse error")),
    };
    (global.fetch as any).mockResolvedValue(mockResponse);

    const provider = makeProvider();
    await expect(
      provider.call({ messages: [{ role: "user", content: "test" }] })
    ).rejects.toThrow("OpenAI API error: 500");
  });

  it("uses custom baseUrl (strips trailing slash)", async () => {
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        choices: [{ message: { content: "ok" } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    };
    (global.fetch as any).mockResolvedValue(mockResponse);

    const provider = makeProvider({ baseUrl: "https://custom.api.com/v1/" });
    await provider.call({ messages: [{ role: "user", content: "test" }] });

    expect(global.fetch).toHaveBeenCalledWith(
      "https://custom.api.com/v1/chat/completions",
      expect.anything()
    );
  });

  it("handles tool calls and recurses", async () => {
    const toolCallResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        choices: [{
          message: {
            content: null,
            tool_calls: [{
              id: "tc1",
              function: { name: "search", arguments: '{"q":"test"}' },
            }],
          },
        }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    };
    const finalResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        choices: [{ message: { content: "Final answer" } }],
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
      }),
    };
    (global.fetch as any)
      .mockResolvedValueOnce(toolCallResponse)
      .mockResolvedValueOnce(finalResponse);

    (callTool as any).mockResolvedValue({ result: "search results" });

    const provider = makeProvider();
    const result = await provider.call({
      messages: [{ role: "user", content: "search" }],
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
      provider.call({ messages: [{ role: "user", content: "test" }], _depth: 10 })
    ).rejects.toThrow("Tool call depth limit exceeded");
  });

  it("includes tools in request when configured", async () => {
    (getToolDefinitions as any).mockReturnValue([{
      name: "search",
      description: "Search the web",
      parameters: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
    }]);

    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        choices: [{ message: { content: "ok" } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    };
    (global.fetch as any).mockResolvedValue(mockResponse);

    const provider = makeProvider({ tools: ["search"] });
    await provider.call({ messages: [{ role: "user", content: "test" }] });

    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0].type).toBe("function");
    expect(body.tools[0].function.name).toBe("search");
    expect(body.tool_choice).toBe("auto");
  });

  it("calculates cost with correct provider type for non-api types", async () => {
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        choices: [{ message: { content: "ok" } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    };
    (global.fetch as any).mockResolvedValue(mockResponse);

    const provider = makeProvider({ type: "api" });
    await provider.call({ messages: [{ role: "user", content: "test" }] });

    expect(calculateCost).toHaveBeenCalledWith("openai", "gpt-4o", 10, 5);
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
