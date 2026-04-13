import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../src/lib/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../../../src/lib/cost.js", () => ({
  calculateCost: vi.fn().mockReturnValue(0.0005),
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

import { GoogleProvider } from "../../../../src/lib/providers/concrete/google.js";
import { calculateCost } from "../../../../src/lib/cost.js";
import { callTool } from "../../../../src/lib/tools/index.js";

function makeProvider(overrides = {}) {
  return new GoogleProvider({
    name: "test-google",
    type: "api",
    apiKey: "google-test-key",
    model: "gemini-2.0-flash",
    ...overrides,
  });
}

describe("GoogleProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("has correct name and type", () => {
    const provider = makeProvider();
    expect(provider.name).toBe("test-google");
    expect(provider.type).toBe("api");
  });

  it("sends correct request to Google Generative AI API", async () => {
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        candidates: [{ content: { parts: [{ text: "Hello!" }] } }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
      }),
    };
    (global.fetch as any).mockResolvedValue(mockResponse);

    const provider = makeProvider();
    const result = await provider.call({
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "x-goog-api-key": "google-test-key",
        }),
      })
    );

    expect(result.text).toBe("Hello!");
    expect(result.usage.promptTokens).toBe(10);
    expect(result.usage.completionTokens).toBe(5);
    expect(result.usage.totalTokens).toBe(15);
  });

  it("maps assistant role to model for Google API", async () => {
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        candidates: [{ content: { parts: [{ text: "ok" }] } }],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2, totalTokenCount: 7 },
      }),
    };
    (global.fetch as any).mockResolvedValue(mockResponse);

    const provider = makeProvider();
    await provider.call({
      messages: [
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Hello" },
        { role: "user", content: "Bye" },
      ],
    });

    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(body.contents[0].role).toBe("user");
    expect(body.contents[1].role).toBe("model");
    expect(body.contents[2].role).toBe("user");
  });

  it("includes system instruction when systemPrompt is set", async () => {
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        candidates: [{ content: { parts: [{ text: "ok" }] } }],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2, totalTokenCount: 7 },
      }),
    };
    (global.fetch as any).mockResolvedValue(mockResponse);

    const provider = makeProvider({ systemPrompt: "Be concise." });
    await provider.call({ messages: [{ role: "user", content: "test" }] });

    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(body.systemInstruction).toEqual({ parts: [{ text: "Be concise." }] });
  });

  it("throws on API error", async () => {
    const mockResponse = {
      ok: false,
      status: 403,
      json: vi.fn().mockResolvedValue({ error: { message: "Forbidden" } }),
    };
    (global.fetch as any).mockResolvedValue(mockResponse);

    const provider = makeProvider();
    await expect(
      provider.call({ messages: [{ role: "user", content: "test" }] })
    ).rejects.toThrow("Forbidden");
  });

  it("throws generic error when no error message in response", async () => {
    const mockResponse = {
      ok: false,
      status: 500,
      json: vi.fn().mockRejectedValue(new Error("json failed")),
    };
    (global.fetch as any).mockResolvedValue(mockResponse);

    const provider = makeProvider();
    await expect(
      provider.call({ messages: [{ role: "user", content: "test" }] })
    ).rejects.toThrow("Google API error: 500");
  });

  it("handles function calls and recurses", async () => {
    const toolCallResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        candidates: [{
          content: {
            parts: [{ functionCall: { name: "search", args: { q: "test" } } }],
          },
        }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
      }),
    };
    const finalResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        candidates: [{ content: { parts: [{ text: "Found it" }] } }],
        usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 10, totalTokenCount: 30 },
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

    expect(callTool).toHaveBeenCalledWith(expect.objectContaining({
      name: "search",
      arguments: { q: "test" },
    }));
    expect(result.text).toBe("Found it");
  });

  it("throws when tool call depth limit is exceeded", async () => {
    const provider = makeProvider();
    await expect(
      provider.call({ messages: [{ role: "user", content: "test" }], _depth: 10 })
    ).rejects.toThrow("Tool call depth limit exceeded");
  });

  it("returns empty text when no parts in response", async () => {
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        candidates: [{ content: { parts: [] } }],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 0, totalTokenCount: 5 },
      }),
    };
    (global.fetch as any).mockResolvedValue(mockResponse);

    const provider = makeProvider();
    const result = await provider.call({
      messages: [{ role: "user", content: "test" }],
    });
    expect(result.text).toBe("");
  });

  it("calculates cost with google provider", async () => {
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        candidates: [{ content: { parts: [{ text: "ok" }] } }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
      }),
    };
    (global.fetch as any).mockResolvedValue(mockResponse);

    const provider = makeProvider();
    await provider.call({ messages: [{ role: "user", content: "test" }] });

    expect(calculateCost).toHaveBeenCalledWith("google", "gemini-2.0-flash", 10, 5);
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

  it("uses default model gemini-2.0-flash when none specified", async () => {
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        candidates: [{ content: { parts: [{ text: "ok" }] } }],
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
      }),
    };
    (global.fetch as any).mockResolvedValue(mockResponse);

    const provider = makeProvider({ model: undefined });
    await provider.call({ messages: [{ role: "user", content: "test" }] });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("gemini-2.0-flash"),
      expect.anything()
    );
  });
});
