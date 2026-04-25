import { describe, it, expect } from "vitest";
import {
  requestContext,
  withContext,
  withContextAsync,
  getContextOrThrow,
  type RequestContext,
} from "../../src/lib/context.js";

const baseCtx: RequestContext = { requestId: "test-123" };

// ── requestContext (AsyncLocalStorage) ───────────────────────────────────────

describe("Request Context Utility", () => {
  it("should store and retrieve context", async () => {
    const mockContext = { requestId: "test-id" };

    await requestContext.run(mockContext, () => {
      const stored = requestContext.getStore();
      expect(stored).toEqual(mockContext);
    });

    expect(requestContext.getStore()).toBeUndefined();
  });
});

// ── withContext ───────────────────────────────────────────────────────────────

describe("withContext", () => {
  it("runs sync fn inside the provided context", () => {
    withContext(baseCtx, () => {
      expect(requestContext.getStore()).toEqual(baseCtx);
    });
  });

  it("restores undefined context after fn returns", () => {
    withContext(baseCtx, () => {});
    expect(requestContext.getStore()).toBeUndefined();
  });

  it("propagates the return value of fn", () => {
    const result = withContext(baseCtx, () => 42);
    expect(result).toBe(42);
  });

  it("propagates thrown errors from fn", () => {
    expect(() =>
      withContext(baseCtx, () => {
        throw new Error("boom");
      })
    ).toThrow("boom");
  });

  it("propagates context with all optional fields", () => {
    const full: RequestContext = {
      requestId: "r1",
      traceId: "trace",
      spanId: "span",
      userId: 7,
      tenantId: "tenant-abc",
      userRole: "admin",
    };
    withContext(full, () => {
      expect(requestContext.getStore()).toEqual(full);
    });
  });

  it("allows nested withContext calls to shadow the outer context", () => {
    const outer: RequestContext = { requestId: "outer" };
    const inner: RequestContext = { requestId: "inner" };

    withContext(outer, () => {
      withContext(inner, () => {
        expect(requestContext.getStore()?.requestId).toBe("inner");
      });
      // After inner context exits, outer context is restored
      expect(requestContext.getStore()?.requestId).toBe("outer");
    });
  });
});

// ── withContextAsync ──────────────────────────────────────────────────────────

describe("withContextAsync", () => {
  it("runs async fn inside the provided context", async () => {
    const result = await withContextAsync(baseCtx, async () => {
      await Promise.resolve();
      return requestContext.getStore()?.requestId;
    });
    expect(result).toBe("test-123");
  });

  it("propagates async return value", async () => {
    const val = await withContextAsync(baseCtx, async () => "async-result");
    expect(val).toBe("async-result");
  });

  it("propagates async errors", async () => {
    await expect(
      withContextAsync(baseCtx, async () => {
        throw new Error("async-boom");
      })
    ).rejects.toThrow("async-boom");
  });

  it("restores undefined context after async fn resolves", async () => {
    await withContextAsync(baseCtx, async () => {
      await Promise.resolve();
    });
    expect(requestContext.getStore()).toBeUndefined();
  });
});

// ── getContextOrThrow ─────────────────────────────────────────────────────────

describe("getContextOrThrow", () => {
  it("throws when called outside any context", () => {
    expect(() => getContextOrThrow()).toThrow(
      "No request context available"
    );
  });

  it("error message mentions middleware", () => {
    expect(() => getContextOrThrow()).toThrow("middleware");
  });

  it("returns the active context when called inside withContext", () => {
    const result = withContext(baseCtx, () => getContextOrThrow());
    expect(result).toEqual(baseCtx);
  });

  it("returns correct context in deeply nested calls", () => {
    const inner: RequestContext = { requestId: "deep", userId: 99 };
    withContext(baseCtx, () => {
      const val = withContext(inner, () => getContextOrThrow());
      expect(val).toEqual(inner);
    });
  });
});
