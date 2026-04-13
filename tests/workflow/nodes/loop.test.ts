import { describe, it, expect } from "vitest";
import { loopHandler } from "../../../src/workflow/nodes/loop.handler.js";
import type { NodeContext } from "../../../src/workflow/types.js";

function makeCtx(inputs: Record<string, unknown>, nodeData: Record<string, unknown>): NodeContext {
  return { inputs, nodeData, runId: "test-run", userId: 1 };
}

describe("loopHandler", () => {
  it("returns items unchanged when no body or filter expression", async () => {
    const ctx = makeCtx({ items: [1, 2, 3] }, {});
    const result = await loopHandler(ctx);
    expect(result).toEqual({ results: [1, 2, 3], count: 3 });
  });

  it("applies a body expression to transform items", async () => {
    const ctx = makeCtx({ items: [1, 2, 3] }, { body: "item * 2" });
    const result = await loopHandler(ctx);
    expect(result).toEqual({ results: [2, 4, 6], count: 3 });
  });

  it("applies a filter expression", async () => {
    const ctx = makeCtx({ items: [1, 2, 3, 4, 5] }, { filter: "item > 2" });
    const result = await loopHandler(ctx);
    expect(result).toEqual({ results: [3, 4, 5], count: 3 });
  });

  it("applies both filter and body", async () => {
    const ctx = makeCtx(
      { items: [1, 2, 3, 4] },
      { filter: "item % 2 === 0", body: "item * 10" },
    );
    const result = await loopHandler(ctx);
    expect(result).toEqual({ results: [20, 40], count: 2 });
  });

  it("respects max_iterations", async () => {
    const ctx = makeCtx({ items: [1, 2, 3, 4, 5] }, { max_iterations: 3 });
    const result = await loopHandler(ctx);
    expect(result).toEqual({ results: [1, 2, 3], count: 3 });
  });

  it("uses sum accumulator", async () => {
    const ctx = makeCtx({ items: [10, 20, 30] }, { accumulator: "sum" });
    const result = await loopHandler(ctx);
    expect(result).toEqual({ result: 60, count: 3 });
  });

  it("uses concat accumulator", async () => {
    const ctx = makeCtx({ items: ["a", "b", "c"] }, { accumulator: "concat" });
    const result = await loopHandler(ctx);
    expect(result).toEqual({ result: "abc", count: 3 });
  });

  it("returns empty results for empty items", async () => {
    const ctx = makeCtx({ items: [] }, {});
    const result = await loopHandler(ctx);
    expect(result).toEqual({ results: [], count: 0 });
  });

  it("returns empty results when items not provided", async () => {
    const ctx = makeCtx({}, {});
    const result = await loopHandler(ctx);
    expect(result).toEqual({ results: [], count: 0 });
  });

  it("passes item through when body expression fails", async () => {
    const ctx = makeCtx({ items: [1, 2] }, { body: "undefinedVar.missingProp" });
    const result = await loopHandler(ctx);
    expect(result).toEqual({ results: [1, 2], count: 2 });
  });

  it("includes item when filter expression fails", async () => {
    const ctx = makeCtx({ items: [1, 2] }, { filter: "undefinedVar.missingProp" });
    const result = await loopHandler(ctx);
    expect(result).toEqual({ results: [1, 2], count: 2 });
  });

  it("provides index variable to expressions", async () => {
    const ctx = makeCtx({ items: ["a", "b", "c"] }, { body: "index" });
    const result = await loopHandler(ctx);
    expect(result).toEqual({ results: [0, 1, 2], count: 3 });
  });
});
