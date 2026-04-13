import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

vi.mock("../../src/lib/drizzle.js", () => ({
  db: {
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn().mockResolvedValue([{ id: "trace-uuid-1" }]),
      })),
    })),
  },
}));

vi.mock("../../src/db/schema/traces.js", () => ({
  traces: {
    id: "id",
    userId: "userId",
    type: "type",
  },
}));

vi.mock("../../src/lib/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("crypto", () => ({
  randomUUID: vi.fn(() => "trace-uuid-1"),
}));

import { startTrace, addStep, endTrace } from "../../src/observability/tracer.js";
import { db } from "../../src/lib/drizzle.js";

describe("Tracer", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.LANGFUSE_SECRET_KEY;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe("startTrace", () => {
    it("creates a trace context with required fields", () => {
      const ctx = startTrace(1, "council_session");

      expect(ctx.id).toBe("trace-uuid-1");
      expect(ctx.userId).toBe(1);
      expect(ctx.type).toBe("council_session");
      expect(ctx.steps).toEqual([]);
      expect(ctx.startTime).toBeGreaterThan(0);
    });

    it("creates trace with optional conversationId and workflowRunId", () => {
      const ctx = startTrace(2, "workflow", {
        conversationId: "conv-123",
        workflowRunId: "wf-456",
      });

      expect(ctx.conversationId).toBe("conv-123");
      expect(ctx.workflowRunId).toBe("wf-456");
    });
  });

  describe("addStep", () => {
    it("records a step event in the trace context", () => {
      const ctx = startTrace(1, "test");

      addStep(ctx, {
        name: "llm-call-1",
        type: "llm_call",
        input: "What is AI?",
        output: "AI is artificial intelligence.",
        model: "gpt-4",
        tokens: 50,
      });

      expect(ctx.steps).toHaveLength(1);
      expect(ctx.steps[0].name).toBe("llm-call-1");
      expect(ctx.steps[0].type).toBe("llm_call");
      expect(ctx.steps[0].tokens).toBe(50);
      expect(ctx.steps[0].latencyMs).toBe(0);
    });

    it("records multiple steps with latency", () => {
      const ctx = startTrace(1, "test");

      addStep(ctx, {
        name: "embedding",
        type: "embedding",
        input: "text",
        output: "[0.1, 0.2]",
        latencyMs: 100,
      });

      addStep(ctx, {
        name: "retrieval",
        type: "retrieval",
        input: "query",
        output: "results",
        latencyMs: 200,
      });

      expect(ctx.steps).toHaveLength(2);
      expect(ctx.steps[0].latencyMs).toBe(100);
      expect(ctx.steps[1].latencyMs).toBe(200);
    });
  });

  describe("endTrace", () => {
    it("persists trace to database and returns trace id", async () => {
      const ctx = startTrace(1, "council");
      addStep(ctx, {
        name: "step1",
        type: "llm_call",
        input: "in",
        output: "out",
        tokens: 100,
      });

      const id = await endTrace(ctx);

      expect(id).toBe("trace-uuid-1");
      expect(db.insert).toHaveBeenCalled();
    });

    it("handles missing langfuse config gracefully (no LANGFUSE_SECRET_KEY)", async () => {
      delete process.env.LANGFUSE_SECRET_KEY;

      const ctx = startTrace(1, "test");
      addStep(ctx, {
        name: "step",
        type: "tool_call",
        input: "x",
        output: "y",
      });

      const id = await endTrace(ctx);
      expect(id).toBe("trace-uuid-1");
    });

    it("returns ctx.id on database error", async () => {
      vi.mocked(db.insert).mockImplementationOnce(() => ({
        values: vi.fn(() => ({
          returning: vi.fn().mockRejectedValue(new Error("DB error")),
        })),
      }) as any);

      const ctx = startTrace(1, "test");
      const id = await endTrace(ctx);

      expect(id).toBe("trace-uuid-1");
    });
  });
});
