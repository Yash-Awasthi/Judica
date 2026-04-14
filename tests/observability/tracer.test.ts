import { describe, it, expect, vi, beforeEach } from "vitest";

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

import { startTrace, addStep, endTrace } from "../../src/observability/tracer.js";
import { db } from "../../src/lib/drizzle.js";

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
    it("pushes step with default latencyMs=0", () => {
      const ctx = startTrace(1, "chat");
      addStep(ctx, {
        name: "llm",
        type: "llm_call",
        input: "hello",
        output: "world",
        tokens: 10,
      });
      expect(ctx.steps).toHaveLength(1);
      expect(ctx.steps[0].latencyMs).toBe(0);
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

      await endTrace(ctx);

      const valuesCall = (db.insert as any).mock.results[0].value.values;
      const insertedData = valuesCall.mock.calls[0][0];
      expect(insertedData.totalTokens).toBe(300);
    });

    it("calculates totalCostUsd at $0.000005/token", async () => {
      const ctx = startTrace(1, "chat");
      addStep(ctx, { name: "a", type: "llm_call", input: "", output: "", tokens: 200000 });

      await endTrace(ctx);

      const valuesCall = (db.insert as any).mock.results[0].value.values;
      const insertedData = valuesCall.mock.calls[0][0];
      expect(insertedData.totalCostUsd).toBeCloseTo(1.0, 5);
    });

    it("inserts trace into database", async () => {
      const ctx = startTrace(7, "workflow");
      addStep(ctx, { name: "step1", type: "tool_call", input: "x", output: "y", tokens: 50 });

      await endTrace(ctx);

      expect(db.insert).toHaveBeenCalled();
      const valuesCall = (db.insert as any).mock.results[0].value.values;
      const insertedData = valuesCall.mock.calls[0][0];
      expect(insertedData.id).toBe(ctx.id);
      expect(insertedData.userId).toBe(7);
      expect(insertedData.type).toBe("workflow");
      expect(insertedData.totalTokens).toBe(50);
    });

    it("returns trace id on success", async () => {
      const ctx = startTrace(1, "chat");
      const result = await endTrace(ctx);
      expect(result).toBe("trace-id");
    });

    it("returns ctx.id on db error (does not throw)", async () => {
      const returning = vi.fn().mockRejectedValueOnce(new Error("DB down"));
      const values = vi.fn().mockReturnValue({ returning });
      (db.insert as any).mockReturnValueOnce({ values });

      const ctx = startTrace(1, "chat");
      const result = await endTrace(ctx);
      expect(result).toBe(ctx.id);
    });

    it("skips Langfuse when LANGFUSE_SECRET_KEY not set", async () => {
      delete process.env.LANGFUSE_SECRET_KEY;
      const ctx = startTrace(1, "chat");

      const result = await endTrace(ctx);
      expect(result).toBe("trace-id");
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

      await endTrace(ctx);

      const valuesCall = (db.insert as any).mock.results[0].value.values;
      const insertedData = valuesCall.mock.calls[0][0];
      expect(insertedData.totalTokens).toBe(60);
      expect(insertedData.totalCostUsd).toBeCloseTo(0.0003, 6);
    });
  });
});
