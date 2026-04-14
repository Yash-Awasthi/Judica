import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../src/lib/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../../../src/lib/breaker.js", () => ({
  getBreaker: vi.fn().mockImplementation((_provider: any, fn: any) => ({
    fire: fn,
  })),
}));

vi.mock("../../../../src/lib/ssrf.js", () => ({
  validateSafeUrl: vi.fn().mockResolvedValue(undefined),
}));

import { OllamaProvider } from "../../../../src/lib/providers/concrete/ollama.js";

function makeProvider(overrides = {}) {
  return new OllamaProvider({
    name: "test-ollama",
    type: "local",
    apiKey: "",
    model: "llama3",
    ...overrides,
  });
}

describe("OllamaProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("has correct name and type", () => {
    const provider = makeProvider();
    expect(provider.name).toBe("test-ollama");
    expect(provider.type).toBe("local");
  });

  it("sends POST to /api/generate with correct body", async () => {
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        response: "Hello from Ollama!",
        done: true,
        prompt_eval_count: 20,
        eval_count: 10,
      }),
    };
    (global.fetch as any).mockResolvedValue(mockResponse);

    const provider = makeProvider();
    const result = await provider.call({
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:11434/api/generate",
      expect.objectContaining({
        method: "POST",
      })
    );

    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(body.model).toBe("llama3");
    expect(body.prompt).toBe("Hi");
    expect(body.stream).toBe(false);

    expect(result.text).toBe("Hello from Ollama!");
    expect(result.usage.promptTokens).toBe(20);
    expect(result.usage.completionTokens).toBe(10);
    expect(result.cost).toBe(0);
  });

  it("uses custom baseUrl", async () => {
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        response: "ok",
        done: true,
      }),
    };
    (global.fetch as any).mockResolvedValue(mockResponse);

    const provider = makeProvider({ baseUrl: "http://myhost:1234" });
    await provider.call({ messages: [{ role: "user", content: "test" }] });

    expect(global.fetch).toHaveBeenCalledWith(
      "http://myhost:1234/api/generate",
      expect.anything()
    );
  });

  it("uses prompt parameter when provided", async () => {
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        response: "ok",
        done: true,
      }),
    };
    (global.fetch as any).mockResolvedValue(mockResponse);

    const provider = makeProvider();
    await provider.call({
      messages: [{ role: "user", content: "from messages" }],
      prompt: "explicit prompt",
    });

    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(body.prompt).toBe("explicit prompt");
  });

  it("includes system prompt when configured", async () => {
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        response: "ok",
        done: true,
      }),
    };
    (global.fetch as any).mockResolvedValue(mockResponse);

    const provider = makeProvider({ systemPrompt: "You are helpful." });
    await provider.call({ messages: [{ role: "user", content: "test" }] });

    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(body.system).toBe("You are helpful.");
  });

  it("throws on non-ok response", async () => {
    const mockResponse = {
      ok: false,
      status: 404,
      statusText: "Not Found",
    };
    (global.fetch as any).mockResolvedValue(mockResponse);

    const provider = makeProvider();
    await expect(
      provider.call({ messages: [{ role: "user", content: "test" }] })
    ).rejects.toThrow("Ollama error: 404 Not Found");
  });

  it("estimates tokens when response has no token counts", async () => {
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        response: "short reply",
        done: true,
      }),
    };
    (global.fetch as any).mockResolvedValue(mockResponse);

    const provider = makeProvider();
    const result = await provider.call({
      messages: [{ role: "user", content: "test" }],
    });

    // Should estimate based on string length / 4
    expect(result.usage.promptTokens).toBe(Math.ceil("test".length / 4));
    expect(result.usage.completionTokens).toBe(Math.ceil("short reply".length / 4));
    expect(result.cost).toBe(0);
  });

  it("returns empty text when response is empty", async () => {
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        done: true,
      }),
    };
    (global.fetch as any).mockResolvedValue(mockResponse);

    const provider = makeProvider();
    const result = await provider.call({
      messages: [{ role: "user", content: "test" }],
    });

    expect(result.text).toBe("");
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

  describe("healthCheck", () => {
    it("returns true when Ollama is reachable", async () => {
      (global.fetch as any).mockResolvedValue({ ok: true });

      const provider = makeProvider();
      const healthy = await provider.healthCheck();
      expect(healthy).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith("http://localhost:11434/api/version");
    });

    it("returns false when Ollama is unreachable", async () => {
      (global.fetch as any).mockRejectedValue(new Error("ECONNREFUSED"));

      const provider = makeProvider();
      const healthy = await provider.healthCheck();
      expect(healthy).toBe(false);
    });

    it("returns false when Ollama returns non-ok", async () => {
      (global.fetch as any).mockResolvedValue({ ok: false });

      const provider = makeProvider();
      const healthy = await provider.healthCheck();
      expect(healthy).toBe(false);
    });
  });
});
