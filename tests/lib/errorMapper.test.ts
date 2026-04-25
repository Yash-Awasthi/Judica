import { describe, it, expect, vi } from "vitest";
import { mapProviderError } from "../../src/lib/errorMapper.js";

// Mock logger
vi.mock("../../src/lib/logger.js", () => ({
  default: { warn: vi.fn() }
}));

describe("Error Mapper Utility", () => {
  it("should handle null/undefined errors", () => {
    expect(mapProviderError(null)).toBe("Unknown error occurred");
    expect(mapProviderError(undefined)).toBe("Unknown error occurred");
  });

  it("should detect rate limit errors by status, type, and message", () => {
    expect(mapProviderError({ status: 429 })).toContain("Rate limit exceeded");
    expect(mapProviderError({ type: "rate_limit_error" })).toContain("Rate limit exceeded");
    expect(mapProviderError({ error: { code: "rate_limit_exceeded" } })).toContain("Rate limit exceeded");
    expect(mapProviderError(new Error("Rate limit hit"))).toContain("Rate limit exceeded");
  });

  it("should detect authentication errors", () => {
    expect(mapProviderError({ statusCode: 401 })).toContain("Authentication failed");
    expect(mapProviderError({ type: "invalid_api_key" })).toContain("Authentication failed");
    expect(mapProviderError(new Error("Unauthorized access"))).toContain("Authentication failed");
  });

  it("should detect quota/billing errors", () => {
    expect(mapProviderError({ code: 402 })).toContain("API quota exceeded");
    expect(mapProviderError({ error: { type: "insufficient_quota" } })).toContain("API quota exceeded");
    expect(mapProviderError(new Error("Insufficient funds"))).toContain("API quota exceeded");
  });

  it("should detect model not found errors", () => {
    expect(mapProviderError({ response: { status: 404 } })).toContain("Model not found");
    expect(mapProviderError({ type: "model_not_found" })).toContain("Model not found");
    expect(mapProviderError(new Error("The model gpt-99 was not found"))).toContain("Model not found");
  });

  it("should detect safety/content filter errors", () => {
    expect(mapProviderError({ type: "content_filter" })).toContain("Content was blocked");
    expect(mapProviderError(new Error("safety violation"))).toContain("Content was blocked");
  });

  it("should detect timeout errors", () => {
    expect(mapProviderError({ type: "timeout" })).toContain("timed out");
    expect(mapProviderError(new Error("ETIMEDOUT"))).toContain("timed out");
  });

  it("should detect server errors (5xx)", () => {
    expect(mapProviderError({ status: 500 })).toContain("AI service is temporarily unavailable");
    expect(mapProviderError({ status: 503 })).toContain("AI service is temporarily unavailable");
    expect(mapProviderError({ type: "server_error" })).toContain("AI service is temporarily unavailable");
    expect(mapProviderError(new Error("Internal Server Error"))).toContain("AI service is temporarily unavailable");
  });

  it("should detect network errors", () => {
    expect(mapProviderError(new Error("ENOTFOUND service.local"))).toContain("Network error");
    expect(mapProviderError(new Error("fetch failed"))).toContain("Network error");
  });

  it("should fallback to generic message and log warning for unknown errors", async () => {
    const { default: logger } = await import("../../src/lib/logger.js");
    const result = mapProviderError({ some: "weird error" });
    expect(result).toBe("An error occurred while processing your request. Please try again.");
    expect(logger.warn).toHaveBeenCalled();
  });
});
