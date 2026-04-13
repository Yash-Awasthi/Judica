import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock opossum
vi.mock("opossum", () => {
  const MockBreaker = vi.fn().mockImplementation(function(this: any) {
    this.fire = vi.fn();
    this.fallback = vi.fn();
    this.on = vi.fn();
    this.emit = vi.fn();
  });
  return {
    default: MockBreaker
  };
});

// Mock logger
vi.mock("../../src/lib/logger.js", () => ({
  default: { warn: vi.fn(), info: vi.fn() }
}));

describe("Circuit Breaker Utility", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  const mockProvider = { name: "test-provider" } as any;

  it("should create and registry common breakers", async () => {
    const { getBreaker } = await import("../../src/lib/breaker.js");
    const { default: CircuitBreaker } = await import("opossum");

    const action = async () => "ok";
    const breaker = getBreaker(mockProvider, action);

    expect(CircuitBreaker).toHaveBeenCalled();
    expect(breaker).toBeDefined();

    // Second call should return same instance
    const breaker2 = getBreaker(mockProvider, action);
    expect(CircuitBreaker).toHaveBeenCalledTimes(1);
    expect(breaker2).toBe(breaker);
  });

  it("should setup events and fallbacks", async () => {
    const { getBreaker } = await import("../../src/lib/breaker.js");
    const action = async () => "ok";
    const breaker = getBreaker(mockProvider, action);

    expect(breaker.fallback).toHaveBeenCalled();
    expect(breaker.on).toHaveBeenCalledWith("open", expect.any(Function));
    expect(breaker.on).toHaveBeenCalledWith("halfOpen", expect.any(Function));
    expect(breaker.on).toHaveBeenCalledWith("close", expect.any(Function));
  });

  it("should trigger logger on events", async () => {
    const { getBreaker } = await import("../../src/lib/breaker.js");
    const { default: logger } = await import("../../src/lib/logger.js");
    const action = async () => "ok";
    const breaker = getBreaker(mockProvider, action);

    // Get the event listeners
    const onMock = breaker.on as any;
    const openHandler = onMock.mock.calls.find((c: any) => c[0] === "open")?.[1];
    const halfOpenHandler = onMock.mock.calls.find((c: any) => c[0] === "halfOpen")?.[1];
    const closeHandler = onMock.mock.calls.find((c: any) => c[0] === "close")?.[1];

    if (openHandler) openHandler();
    expect(logger.warn).toHaveBeenCalled();

    if (halfOpenHandler) halfOpenHandler();
    expect(logger.info).toHaveBeenCalled();

    if (closeHandler) closeHandler();
    expect(logger.info).toHaveBeenCalledTimes(2);
  });

  it("should handle fallbacks that throw specific errors", async () => {
    const { getBreaker } = await import("../../src/lib/breaker.js");
    const action = async () => "ok";
    const breaker = getBreaker(mockProvider, action);

    const fallbackHandler = (breaker.fallback as any).mock.calls[0][0];
    expect(fallbackHandler).toBeDefined();

    expect(() => fallbackHandler()).toThrow(/CircuitBreaker opened/);
  });
});
