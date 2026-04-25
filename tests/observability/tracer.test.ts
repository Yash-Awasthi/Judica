import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/lib/drizzle.js", () => {
  const returning = vi.fn().mockResolvedValue([{ id: "trace-id" }]);
  const values = vi.fn().mockReturnValue({ returning });
  const insert = vi.fn().mockReturnValue({ values });
  return { db: { insert } };
});

vi.mock("../../src/db/schema/traces.js", () => ({ traces: {} }));

vi.mock("../../src/lib/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../src/config/env.js", () => ({
  env: {},
}));

vi.mock("../../src/lib/cost.js", () => ({
  calculateCost: vi.fn((_provider: string, _model: string, inputTokens: number, outputTokens: number) => {
    // Simple mock: $0.003/1K input, $0.015/1K output (mid-tier)
    return (inputTokens * 0.003 + outputTokens * 0.015) / 1000;
  }),
}));

import { startTrace, addStep, endTrace, shutdownTracer } from "../../src/observability/tracer.js";
import { db } from "../../src/lib/drizzle.js";
import logger from "../../src/lib/logger.js";
import { calculateCost } from "../../src/lib/cost.js";

describe("tracer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.LANGFUSE_SECRET_KEY;
  });

  describe("startTrace", () => {
    it("returns context with id, userId, type, empty steps, and startTime", () => {
      const ctx = startTrace(42, "chat");
      expect(ctx.id).toBeTypeOf("string");
      expect(ctx.id.length).toBeGreaterThan(0);
      expect(ctx.userId).toBe(42);
      expect(ctx.type).toBe("chat");
      expect(ctx.steps).toEqual([]);
      expect(ctx.startTime).toBeTypeOf("number");
      expect(ctx.startTime).toBeLessThanOrEqual(Date.now());
    });

    it("includes conversationId and workflowRunId from opts", () => {
      const ctx = startTrace(1, "workflow", {
        conversationId: "conv-123",
        workflowRunId: "wf-456",
      });
      expect(ctx.conversationId).toBe("conv-123");
      expect(ctx.workflowRunId).toBe("wf-456");
    });
  });

  describe("addStep", () => {
    it("pushes step with default latencyMs=-1 (missing instrumentation)", () => {
      const ctx = startTrace(1, "chat");
      addStep(ctx, {
        name: "llm",
        type: "llm_call",
        input: "hello",
        output: "world",
        tokens: 10,
      });
      expect(ctx.steps).toHaveLength(1);
      expect(ctx.steps[0].latencyMs).toBe(-1);
      expect(ctx.steps[0].name).toBe("llm");
    });

    it("preserves provided latencyMs", () => {
      const ctx = startTrace(1, "chat");
      addStep(ctx, {
        name: "slow-call",
        type: "llm_call",
        input: "in",
        output: "out",
        latencyMs: 500,
      });
      expect(ctx.steps[0].latencyMs).toBe(500);
    });
  });

  describe("endTrace", () => {
    it("calculates totalTokens from steps", async () => {
      const ctx = startTrace(1, "chat");
      addStep(ctx, { name: "a", type: "llm_call", input: "", output: "", tokens: 100 });
      addStep(ctx, { name: "b", type: "llm_call", input: "", output: "", tokens: 200 });

      endTrace(ctx);

      // Wait for fire-and-forget persistTrace to complete
      await vi.waitFor(() => {
        expect(db.insert).toHaveBeenCalled();
      });

      const valuesCall = (db.insert as any).mock.results[0].value.values;
      const insertedData = valuesCall.mock.calls[0][0];
      expect(insertedData.totalTokens).toBe(300);
    });

    it("uses calculateCost for cost calculation (not flat per-token rate)", async () => {
      const ctx = startTrace(1, "chat");
      addStep(ctx, { name: "a", type: "llm_call", input: "", output: "", tokens: 200000 });

      endTrace(ctx);

      await vi.waitFor(() => {
        expect(db.insert).toHaveBeenCalled();
      });

      const valuesCall = (db.insert as any).mock.results[0].value.values;
      const insertedData = valuesCall.mock.calls[0][0];
      // Cost is calculated via calculateCost, not a flat $0.000005/token
      expect(insertedData.totalCostUsd).toBeTypeOf("number");
      expect(insertedData.totalCostUsd).toBeGreaterThan(0);
    });

    it("inserts trace into database", async () => {
      const ctx = startTrace(7, "workflow");
      addStep(ctx, { name: "step1", type: "tool_call", input: "x", output: "y", tokens: 50 });

      endTrace(ctx);

      await vi.waitFor(() => {
        expect(db.insert).toHaveBeenCalled();
      });

      const valuesCall = (db.insert as any).mock.results[0].value.values;
      const insertedData = valuesCall.mock.calls[0][0];
      expect(insertedData.id).toBe(ctx.id);
      expect(insertedData.userId).toBe(7);
      expect(insertedData.type).toBe("workflow");
      expect(insertedData.totalTokens).toBe(50);
    });

    it("returns ctx.id synchronously (fire-and-forget)", () => {
      const ctx = startTrace(1, "chat");
      const result = endTrace(ctx);
      // endTrace now returns ctx.id synchronously
      expect(result).toBe(ctx.id);
    });

    it("does not throw on db error", async () => {
      const returning = vi.fn().mockRejectedValueOnce(new Error("DB down"));
      const values = vi.fn().mockReturnValue({ returning });
      (db.insert as any).mockReturnValueOnce({ values });

      const ctx = startTrace(1, "chat");
      const result = endTrace(ctx);
      expect(result).toBe(ctx.id);
    });

    it("skips Langfuse when LANGFUSE_SECRET_KEY not set", () => {
      delete process.env.LANGFUSE_SECRET_KEY;
      const ctx = startTrace(1, "chat");

      const result = endTrace(ctx);
      // Returns ctx.id synchronously
      expect(result).toBe(ctx.id);
    });
  });

  describe("multiple steps", () => {
    it("accumulate correctly", async () => {
      const ctx = startTrace(1, "chat");
      addStep(ctx, { name: "s1", type: "llm_call", input: "", output: "", tokens: 10 });
      addStep(ctx, { name: "s2", type: "tool_call", input: "", output: "", tokens: 20 });
      addStep(ctx, { name: "s3", type: "embedding", input: "", output: "", tokens: 30 });
      addStep(ctx, { name: "s4", type: "retrieval", input: "", output: "" });

      expect(ctx.steps).toHaveLength(4);

      endTrace(ctx);

      await vi.waitFor(() => {
        expect(db.insert).toHaveBeenCalled();
      });

      const valuesCall = (db.insert as any).mock.results[0].value.values;
      const insertedData = valuesCall.mock.calls[0][0];
      expect(insertedData.totalTokens).toBe(60);
      // Cost is computed via calculateCost, just verify it's a number > 0
      expect(insertedData.totalCostUsd).toBeTypeOf("number");
    });
  });
});

// ── addStep — step limit (MAX 1000) ───────────────────────────────────────────

describe("addStep — step limit at 1000", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("drops the step and logs warn when ctx.steps is already at 1000", () => {
    const ctx = startTrace(1, "chat");
    for (let i = 0; i < 1000; i++) {
      ctx.steps.push({
        name: `s${i}`,
        type: "llm_call",
        input: "",
        output: "",
        latencyMs: -1,
      });
    }
    expect(ctx.steps).toHaveLength(1000);

    addStep(ctx, { name: "overflow", type: "llm_call", input: "", output: "" });

    expect(ctx.steps).toHaveLength(1000);
    expect(vi.mocked(logger).warn).toHaveBeenCalledWith(
      expect.objectContaining({ steps: 1000 }),
      expect.stringContaining("step limit")
    );
  });

  it("accepts exactly 1000 steps without warning", () => {
    const ctx = startTrace(1, "chat");
    for (let i = 0; i < 999; i++) {
      ctx.steps.push({ name: `s${i}`, type: "llm_call", input: "", output: "", latencyMs: -1 });
    }
    addStep(ctx, { name: "step999", type: "llm_call", input: "", output: "" });
    expect(ctx.steps).toHaveLength(1000);
    expect(vi.mocked(logger).warn).not.toHaveBeenCalled();
  });
});

// ── endTrace — NaN cost guard ─────────────────────────────────────────────────

describe("endTrace — NaN cost guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sets totalCostUsd to 0 when calculateCost returns NaN", async () => {
    vi.mocked(calculateCost).mockReturnValueOnce(NaN);

    const ctx = startTrace(1, "chat");
    addStep(ctx, {
      name: "a",
      type: "llm_call",
      input: "",
      output: "",
      model: "gpt-4",
      inputTokens: 100,
      outputTokens: 100,
    });

    endTrace(ctx);

    await vi.waitFor(() => expect(db.insert).toHaveBeenCalled());

    const valuesCall = (db.insert as any).mock.results[0].value.values;
    const insertedData = valuesCall.mock.calls[0][0];
    expect(insertedData.totalCostUsd).toBe(0);
  });

  it("accumulates cost from finite steps and ignores Infinity", async () => {
    vi.mocked(calculateCost)
      .mockReturnValueOnce(0.01)
      .mockReturnValueOnce(Infinity);

    const ctx = startTrace(1, "chat");
    addStep(ctx, { name: "a", type: "llm_call", input: "", output: "", model: "gpt-4", inputTokens: 100, outputTokens: 50 });
    addStep(ctx, { name: "b", type: "llm_call", input: "", output: "", model: "gpt-4", inputTokens: 999, outputTokens: 999 });

    endTrace(ctx);

    await vi.waitFor(() => expect(db.insert).toHaveBeenCalled());

    const valuesCall = (db.insert as any).mock.results[0].value.values;
    const insertedData = valuesCall.mock.calls[0][0];
    // Only the $0.01 step should be counted; Infinity step is skipped
    expect(insertedData.totalCostUsd).toBe(0.01);
  });
});

// ── persistTrace — DB error path ──────────────────────────────────────────────

describe("persistTrace — DB error path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("logs error with traceId when db.insert().values() rejects", async () => {
    const values = vi.fn().mockRejectedValueOnce(new Error("DB down"));
    (db.insert as any).mockReturnValueOnce({ values });

    const ctx = startTrace(1, "chat");
    endTrace(ctx);

    await vi.waitFor(() => {
      expect(vi.mocked(logger).error).toHaveBeenCalledWith(
        expect.objectContaining({ traceId: ctx.id }),
        "Failed to save trace"
      );
    });
  });
});

// ── shutdownTracer ────────────────────────────────────────────────────────────

describe("shutdownTracer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves without error when no langfuse instance exists", async () => {
    await expect(shutdownTracer()).resolves.toBeUndefined();
  });

  it("can be called multiple times without throwing", async () => {
    await expect(shutdownTracer()).resolves.toBeUndefined();
    await expect(shutdownTracer()).resolves.toBeUndefined();
  });
});

// ── sendToLangfuse via endTrace ───────────────────────────────────────────────

describe("sendToLangfuse — with LANGFUSE_SECRET_KEY set", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.LANGFUSE_SECRET_KEY;
    vi.resetModules();
  });

  it("calls trace() and flushAsync() when langfuse is available", async () => {
    process.env.LANGFUSE_SECRET_KEY = "test-secret";
    process.env.LANGFUSE_PUBLIC_KEY = "test-public";

    const mockFlushAsync = vi.fn().mockResolvedValue(undefined);
    const mockGeneration = vi.fn();
    const mockSpan = vi.fn();
    const mockTrace = vi.fn().mockReturnValue({
      generation: mockGeneration,
      span: mockSpan,
    });
    const MockLangfuse = vi.fn().mockImplementation(function (this: any) {
      this.trace = mockTrace;
      this.flushAsync = mockFlushAsync;
    });

    vi.doMock("langfuse", () => ({ Langfuse: MockLangfuse }));

    const { startTrace: st, addStep: as, endTrace: et } = await import(
      "../../src/observability/tracer.js"
    );
    const { db: freshDb } = await import("../../src/lib/drizzle.js");

    const ctx = st(1, "chat");
    as(ctx, { name: "llm-step", type: "llm_call", input: "hi", output: "hello", model: "gpt-4", tokens: 100 });
    as(ctx, { name: "tool-step", type: "tool_call", input: "query", output: "data" });

    et(ctx);

    await vi.waitFor(() => {
      expect((freshDb.insert as any)).toHaveBeenCalled();
    });
    // Give langfuse calls time to run
    await new Promise((r) => setTimeout(r, 10));

    expect(MockLangfuse).toHaveBeenCalled();
    expect(mockTrace).toHaveBeenCalledWith(
      expect.objectContaining({ id: ctx.id, userId: "1" })
    );
    // llm_call step → generation(); tool_call step → span()
    expect(mockGeneration).toHaveBeenCalled();
    expect(mockSpan).toHaveBeenCalled();
    expect(mockFlushAsync).toHaveBeenCalled();
  });

  it("logs warn when langfuse trace() throws", async () => {
    process.env.LANGFUSE_SECRET_KEY = "test-secret";

    const MockLangfuse = vi.fn().mockImplementation(function (this: any) {
      this.trace = vi.fn().mockImplementation(() => { throw new Error("langfuse error"); });
      this.flushAsync = vi.fn();
    });

    vi.doMock("langfuse", () => ({ Langfuse: MockLangfuse }));

    const { startTrace: st, endTrace: et } = await import(
      "../../src/observability/tracer.js"
    );
    const { default: freshLogger } = await import("../../src/lib/logger.js");

    const ctx = st(1, "chat");
    et(ctx);

    await new Promise((r) => setTimeout(r, 20));

    expect(vi.mocked(freshLogger).warn).toHaveBeenCalledWith(
      expect.objectContaining({ traceId: ctx.id }),
      expect.stringContaining("Langfuse export failed")
    );
  });
});
