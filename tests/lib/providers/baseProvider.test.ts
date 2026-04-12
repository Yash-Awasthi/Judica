import { describe, it, expect, vi, beforeEach } from "vitest";

const mockBreakerFire = vi.fn();

vi.mock("../../../src/lib/breaker.js", () => ({
  getBreaker: vi.fn(() => ({
    fire: mockBreakerFire,
  })),
}));

vi.mock("../../../src/lib/logger.js", () => ({
  default: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { BaseProvider } from "../../../src/lib/providers/baseProvider.js";
import { getBreaker } from "../../../src/lib/breaker.js";

// Concrete subclass for testing the abstract base
class TestProvider extends BaseProvider {
  async call() {
    return { text: "ok", usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } };
  }

  // Expose protected methods for testing
  async testProtectedFetch(url: string, init: RequestInit) {
    return this.protectedFetch(url, init);
  }

  testMaskConfig() {
    return this.maskConfig();
  }
}

describe("BaseProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("wraps calls with circuit breaker via protectedFetch", async () => {
    const fakeResponse = new Response("ok", { status: 200 });
    mockBreakerFire.mockResolvedValue(fakeResponse);

    const provider = new TestProvider({
      name: "test-provider",
      type: "api",
      apiKey: "sk-secret-key-long",
      model: "gpt-4",
    });

    const result = await provider.testProtectedFetch("https://api.example.com", {
      method: "POST",
    });

    expect(getBreaker).toHaveBeenCalledWith(
      expect.objectContaining({ name: "test-provider" }),
      expect.any(Function)
    );
    expect(mockBreakerFire).toHaveBeenCalled();
    expect(result).toBe(fakeResponse);
  });

  it("masks sensitive config fields", () => {
    const provider = new TestProvider({
      name: "test-provider",
      type: "api",
      apiKey: "sk-very-secret-api-key",
      model: "gpt-4",
    });

    const masked = provider.testMaskConfig();
    expect(masked.apiKey).toBe("sk-v****");
    expect(masked.apiKey).not.toContain("secret");
    expect(masked.name).toBe("test-provider");
    expect(masked.model).toBe("gpt-4");
  });

  it("masks short api keys with just asterisks", () => {
    const provider = new TestProvider({
      name: "test",
      type: "api",
      apiKey: "key",
      model: "m",
    });

    const masked = provider.testMaskConfig();
    expect(masked.apiKey).toBe("****");
  });

  it("sets name and type from config", () => {
    const provider = new TestProvider({
      name: "my-provider",
      type: "local",
      apiKey: "",
      model: "llama2",
    });

    expect(provider.name).toBe("my-provider");
    expect(provider.type).toBe("local");
  });
});
