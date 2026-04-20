import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock env before importing the module under test
vi.mock("../../src/config/env.js", () => ({
  env: {
    GOOGLE_API_KEY: "",
  },
}));

// Mock the providers types module
vi.mock("../../src/lib/providers.js", () => ({}));

import { getFallbackProvider, FALLBACK_MAP } from "../../src/config/fallbacks.js";
import { env } from "../../src/config/env.js";
import type { Provider } from "../../src/lib/providers.js";

function makeProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    name: "Test Provider",
    type: "api",
    apiKey: "test-key",
    model: "gpt-4",
    ...overrides,
  } as Provider;
}

describe("FALLBACK_MAP", () => {
  it("should have entry for api only", () => {
    expect(FALLBACK_MAP).toHaveProperty("api");
    expect(FALLBACK_MAP).not.toHaveProperty("local");
    expect(FALLBACK_MAP).not.toHaveProperty("rpa");
  });

  it("should use gemini-2.5-flash-preview-05-20 as the fallback model", () => {
    expect(FALLBACK_MAP["api"]!.model).toBe("gemini-2.5-flash-preview-05-20");
  });
});

describe("getFallbackProvider", () => {
  it("should return null when no API key is configured", () => {
    const provider = makeProvider({ type: "api" });
    const result = getFallbackProvider(provider);
    expect(result).toBeNull();
  });

  it("should return a fallback provider with correct name when API key is set", () => {
    // Mutate the mocked env to provide a key
    (env as any).GOOGLE_API_KEY = "fake-google-key";
    // FALLBACK_MAP reads env at import time, so we need to patch the map entry
    FALLBACK_MAP["api"]!.apiKey = "fake-google-key";

    const provider = makeProvider({ name: "My Provider", type: "api" });
    const result = getFallbackProvider(provider);

    expect(result).not.toBeNull();
    expect(result!.name).toBe("My Provider (Emergency Fallback: gemini-2.5-flash-preview-05-20)");
  });

  it("should merge original provider fields into the fallback", () => {
    FALLBACK_MAP["api"]!.apiKey = "fake-google-key";

    const provider = makeProvider({
      name: "Local Model",
      type: "api",
      model: "gpt-4",
      baseUrl: "http://localhost:11434",
    });
    const result = getFallbackProvider(provider);

    expect(result).not.toBeNull();
    // model overridden by fallback fields
    expect(result!.model).toBe("gemini-2.5-flash-preview-05-20");
    expect(result!.type).toBe("api");
  });

  it("should return null for a local provider type", () => {
    const provider = makeProvider({ type: "local" as any });
    const result = getFallbackProvider(provider);
    expect(result).toBeNull();
  });
});
