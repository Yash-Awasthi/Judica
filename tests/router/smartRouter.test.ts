import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/lib/logger.js", () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../src/adapters/registry.js", () => ({
  getAdapter: vi.fn(),
  resolveProviderFromModel: vi.fn(),
  listAvailableProviders: vi.fn(() => []),
  hasAdapter: vi.fn(),
}));

vi.mock("../../src/router/quotaTracker.js", () => ({
  recordUsage: vi.fn(),
}));

vi.mock("../../src/router/rpmLimiter.js", () => ({
  recordRequest: vi.fn(),
}));

vi.mock("../../src/router/tokenEstimator.js", () => ({
  estimateTokens: vi.fn(() => 100),
}));

vi.mock("../../src/router/providerChain.js", () => ({
  selectProvider: vi.fn(),
  FREE_TIER_CHAIN: [
    { provider: "gemini", model: "gemini-2.0-flash", rpm: 15, daily_tokens: 1000000, daily_requests: 1500 },
    { provider: "groq", model: "llama-3.3-70b-versatile", rpm: 30, daily_tokens: 500000, daily_requests: 14400 },
    { provider: "openrouter", model: "meta-llama/llama-3.1-8b-instruct:free", rpm: 20, daily_tokens: 200000, daily_requests: 200 },
  ],
  PAID_CHAIN: [
    { provider: "openai", model: "gpt-4o", rpm: 500, daily_tokens: 10000000, daily_requests: 10000 },
    { provider: "anthropic", model: "claude-3-5-sonnet", rpm: 50, daily_tokens: 5000000, daily_requests: 4000 },
  ],
}));

import { route, routeAndCollect } from "../../src/router/smartRouter.js";
import { getAdapter, resolveProviderFromModel, hasAdapter, listAvailableProviders } from "../../src/adapters/registry.js";
import { recordUsage } from "../../src/router/quotaTracker.js";
import { recordRequest } from "../../src/router/rpmLimiter.js";
import { selectProvider } from "../../src/router/providerChain.js";
import type { AdapterRequest, AdapterStreamResult, AdapterChunk } from "../../src/adapters/types.js";
import { createStreamResult } from "../../src/adapters/types.js";

const mockedGetAdapter = vi.mocked(getAdapter);
const mockedResolveProvider = vi.mocked(resolveProviderFromModel);
const mockedHasAdapter = vi.mocked(hasAdapter);
const mockedSelectProvider = vi.mocked(selectProvider);
const mockedListAvailable = vi.mocked(listAvailableProviders);
const mockedRecordRequest = vi.mocked(recordRequest);

function makeStreamResult(text: string, usage?: { prompt_tokens: number; completion_tokens: number }): AdapterStreamResult {
  async function* gen(): AsyncGenerator<AdapterChunk> {
    yield { type: "text", text };
    if (usage) {
      yield { type: "usage", usage };
    }
    yield { type: "done" };
  }
  return createStreamResult(gen());
}

function makeFailingAdapter(error: Error) {
  return {
    providerId: "failing",
    generate: vi.fn().mockRejectedValue(error),
    listModels: vi.fn(),
    isAvailable: vi.fn(),
  };
}

function makeSuccessAdapter(text: string, usage = { prompt_tokens: 10, completion_tokens: 20 }) {
  return {
    providerId: "success",
    generate: vi.fn().mockResolvedValue(makeStreamResult(text, usage)),
    listModels: vi.fn(),
    isAvailable: vi.fn(),
  };
}

const baseReq: AdapterRequest = {
  model: "test-model",
  messages: [{ role: "user", content: "Hello" }],
};

describe("smartRouter — route()", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockedListAvailable.mockReturnValue([]);
  });

  it("should use preferred provider when set and available", async () => {
    const adapter = makeSuccessAdapter("response from preferred");
    mockedHasAdapter.mockReturnValue(true);
    mockedGetAdapter.mockReturnValue(adapter);

    const result = await route(baseReq, { preferredProvider: "openai" });
    const collected = await result.collect();

    expect(collected.text).toBe("response from preferred");
    expect(mockedGetAdapter).toHaveBeenCalledWith("openai");
    expect(mockedRecordRequest).toHaveBeenCalledWith("openai");
  });

  it("should resolve provider from preferredModel", async () => {
    const adapter = makeSuccessAdapter("model-resolved");
    mockedResolveProvider.mockReturnValue("anthropic");
    mockedHasAdapter.mockReturnValue(true);
    mockedGetAdapter.mockReturnValue(adapter);

    const result = await route(baseReq, { preferredModel: "claude-3-5-sonnet" });
    const collected = await result.collect();

    expect(collected.text).toBe("model-resolved");
    expect(mockedResolveProvider).toHaveBeenCalledWith("claude-3-5-sonnet");
  });

  it("should resolve provider from req.model when no preference set", async () => {
    const adapter = makeSuccessAdapter("auto-resolved");
    mockedResolveProvider.mockImplementation((model) =>
      model === "test-model" ? "gemini" : null
    );
    mockedHasAdapter.mockReturnValue(true);
    mockedGetAdapter.mockReturnValue(adapter);

    const result = await route(baseReq);
    const collected = await result.collect();

    expect(collected.text).toBe("auto-resolved");
  });

  it("should fall back to chain when preferred provider fails", async () => {
    const failAdapter = makeFailingAdapter(new Error("rate limited"));
    const successAdapter = makeSuccessAdapter("chain fallback");

    mockedHasAdapter.mockReturnValue(true);
    mockedGetAdapter
      .mockReturnValueOnce(failAdapter)  // preferred fails
      .mockReturnValueOnce(successAdapter); // chain succeeds

    mockedSelectProvider.mockReturnValueOnce({ provider: "groq", model: "llama-3" });

    const result = await route(baseReq, { preferredProvider: "openai" });
    const collected = await result.collect();

    expect(collected.text).toBe("chain fallback");
  });

  it("should try multiple chain providers on failure", async () => {
    // No preferred provider
    mockedHasAdapter.mockReturnValue(false); // no preferred resolves
    mockedResolveProvider.mockReturnValue(null);

    const failAdapter = makeFailingAdapter(new Error("fail"));
    const successAdapter = makeSuccessAdapter("third try");

    mockedSelectProvider
      .mockReturnValueOnce({ provider: "gemini", model: "gemini-2.0-flash" })
      .mockReturnValueOnce({ provider: "groq", model: "llama" });

    mockedGetAdapter
      .mockReturnValueOnce(failAdapter)
      .mockReturnValueOnce(successAdapter);

    const result = await route(baseReq);
    const collected = await result.collect();
    expect(collected.text).toBe("third try");
  });

  it("should throw 503 when all providers are exhausted", async () => {
    mockedHasAdapter.mockReturnValue(false);
    mockedResolveProvider.mockReturnValue(null);
    mockedSelectProvider.mockReturnValue(null);

    await expect(route(baseReq)).rejects.toThrow(/All providers exhausted/);
  });

  it("should record usage after stream completes with usage chunk", async () => {
    const adapter = makeSuccessAdapter("hello", { prompt_tokens: 50, completion_tokens: 100 });
    mockedHasAdapter.mockReturnValue(true);
    mockedGetAdapter.mockReturnValue(adapter);

    const result = await route(baseReq, { preferredProvider: "openai" });
    // Must consume the stream to trigger usage tracking
    const collected = await result.collect();

    expect(collected.text).toBe("hello");
    expect(recordUsage).toHaveBeenCalledWith("openai", 150);
  });

  it("should use PAID_CHAIN when usePaid is true", async () => {
    mockedHasAdapter.mockReturnValue(false);
    mockedResolveProvider.mockReturnValue(null);
    mockedSelectProvider.mockReturnValueOnce({ provider: "openai", model: "gpt-4o" });

    const adapter = makeSuccessAdapter("paid response");
    mockedGetAdapter.mockReturnValue(adapter);

    const result = await route(baseReq, { usePaid: true });
    const collected = await result.collect();
    expect(collected.text).toBe("paid response");
  });
});

describe("smartRouter — routeAndCollect()", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockedListAvailable.mockReturnValue([]);
  });

  it("should return collected text and usage", async () => {
    const adapter = makeSuccessAdapter("collected text", { prompt_tokens: 10, completion_tokens: 20 });
    mockedHasAdapter.mockReturnValue(true);
    mockedGetAdapter.mockReturnValue(adapter);

    const result = await routeAndCollect(baseReq, { preferredProvider: "openai" });
    expect(result.text).toBe("collected text");
    expect(result.provider).toBe("openai");
    expect(result.usage).toEqual({ prompt_tokens: 10, completion_tokens: 20 });
  });

  it("should return 'auto' as provider when no preference", async () => {
    mockedHasAdapter.mockReturnValue(false);
    mockedResolveProvider.mockReturnValue(null);
    mockedSelectProvider.mockReturnValueOnce({ provider: "gemini", model: "gemini-2.0-flash" });

    const adapter = makeSuccessAdapter("auto result");
    mockedGetAdapter.mockReturnValue(adapter);

    const result = await routeAndCollect(baseReq);
    expect(result.provider).toBe("auto");
  });
});
