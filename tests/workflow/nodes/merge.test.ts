import { describe, it, expect } from "vitest";
import { mergeHandler } from "../../../src/workflow/nodes/merge.handler.js";
import type { NodeContext } from "../../../src/workflow/types.js";

function makeCtx(inputs: Record<string, unknown>, nodeData: Record<string, unknown>): NodeContext {
  return { inputs, nodeData, runId: "test-run", userId: 1 };
}

describe("mergeHandler", () => {
  it("spreads object values from inputs", async () => {
    const ctx = makeCtx({ a: { x: 1, y: 2 }, b: { z: 3 } }, {});
    const result = await mergeHandler(ctx);
    expect(result).toEqual({ x: 1, y: 2, z: 3 });
  });

  it("keeps non-object values under their key", async () => {
    const ctx = makeCtx({ count: 42, label: "test" }, {});
    const result = await mergeHandler(ctx);
    expect(result).toEqual({ count: 42, label: "test" });
  });

  it("mixes object and non-object values", async () => {
    const ctx = makeCtx({ a: { foo: "bar" }, name: "Alice" }, {});
    const result = await mergeHandler(ctx);
    expect(result).toEqual({ foo: "bar", name: "Alice" });
  });

  it("returns empty object for empty inputs", async () => {
    const ctx = makeCtx({}, {});
    const result = await mergeHandler(ctx);
    expect(result).toEqual({});
  });

  it("does not spread arrays", async () => {
    const ctx = makeCtx({ items: [1, 2, 3] }, {});
    const result = await mergeHandler(ctx);
    expect(result).toEqual({ items: [1, 2, 3] });
  });
});
