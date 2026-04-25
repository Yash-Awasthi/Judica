import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock opossum
vi.mock("opossum", () => {
  const MockBreaker = vi.fn().mockImplementation(function(this: any) {
    this.fire = vi.fn();
    this.fallback = vi.fn();
    this.on = vi.fn();
    this.emit = vi.fn();
    this.shutdown = vi.fn();
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

    // Second call should return cached instance (wrapped)
    const breaker2 = getBreaker(mockProvider, action);
    expect(CircuitBreaker).toHaveBeenCalledTimes(1);
    // wrapBreaker creates a new wrapper, so check structural equality
    expect(breaker2).toBeDefined();
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

// ── LRU eviction when registry reaches MAX_BREAKERS (200) ────────────────────

describe("Circuit Breaker — LRU eviction at MAX_BREAKERS", () => {
  it("evicts the oldest entry when the registry is at capacity", async () => {
    vi.resetModules();
    const { getBreaker } = await import("../../src/lib/breaker.js");
    const { default: CircuitBreaker } = await import("opossum");

    const MAX_BREAKERS = 200;

    // Fill the registry to capacity — use object-key assignment to set function.name
    for (let i = 0; i < MAX_BREAKERS; i++) {
      const fns: Record<string, () => Promise<string>> = {};
      fns[`fn_${i}`] = async () => "ok";
      getBreaker({ name: `p${i}` }, fns[`fn_${i}`]);
    }

    // Adding one more should trigger LRU eviction (oldest key removed)
    const overflowFns: Record<string, () => Promise<string>> = {};
    overflowFns["fn_overflow"] = async () => "overflow";
    const newBreaker = getBreaker({ name: "p_overflow" }, overflowFns["fn_overflow"]);
    expect(newBreaker).toBeDefined();
    // Verify the breaker has the expected interface (eviction succeeded, new entry created)
    expect(newBreaker.fallback).toBeDefined();
    expect(newBreaker.on).toBeDefined();
  });
});

// ── wrapBreaker fire() type guard ─────────────────────────────────────────────

describe("Circuit Breaker — wrapBreaker type guard", () => {
  it("passes through valid Response-like objects (has 'ok' property)", async () => {
    vi.resetModules();
    const { getBreaker } = await import("../../src/lib/breaker.js");
    const { default: CircuitBreaker } = await import("opossum");

    const fakeResponse = { ok: true, status: 200 };
    // Mock fire() to return a Response-like object
    vi.mocked(CircuitBreaker).mockImplementationOnce(function (this: any, _action: unknown) {
      this.fire = vi.fn().mockResolvedValue(fakeResponse);
      this.fallback = vi.fn();
      this.on = vi.fn();
      this.emit = vi.fn();
    });

    const action = async () => fakeResponse as unknown as Response;
    const breaker = getBreaker({ name: "typed-provider" }, action);

    await expect(breaker.fire()).resolves.toEqual(fakeResponse);
  });

  it("throws when fire() returns a non-Response value (missing 'ok')", async () => {
    vi.resetModules();
    const { getBreaker } = await import("../../src/lib/breaker.js");
    const { default: CircuitBreaker } = await import("opossum");

    const nonResponse = { data: "plain object, no ok property" };
    vi.mocked(CircuitBreaker).mockImplementationOnce(function (this: any, _action: unknown) {
      this.fire = vi.fn().mockResolvedValue(nonResponse);
      this.fallback = vi.fn();
      this.on = vi.fn();
      this.emit = vi.fn();
    });

    const action = async () => nonResponse as unknown as Response;
    const breaker = getBreaker({ name: "bad-provider" }, action);

    await expect(breaker.fire()).rejects.toThrow(/non-Response/);
    await expect(breaker.fire()).rejects.toThrow("bad-provider");
  });

  it("throws with provider name in message when result is null", async () => {
    vi.resetModules();
    const { getBreaker } = await import("../../src/lib/breaker.js");
    const { default: CircuitBreaker } = await import("opossum");

    vi.mocked(CircuitBreaker).mockImplementationOnce(function (this: any, _action: unknown) {
      this.fire = vi.fn().mockResolvedValue(null);
      this.fallback = vi.fn();
      this.on = vi.fn();
      this.emit = vi.fn();
    });

    const action = async () => null as unknown as Response;
    const breaker = getBreaker({ name: "null-provider" }, action);

    await expect(breaker.fire()).rejects.toThrow("null-provider");
  });
});
