import { describe, it, expect } from "vitest";
import { splitHandler } from "../../../src/workflow/nodes/split.handler.js";
import type { NodeContext } from "../../../src/workflow/types.js";

function makeCtx(inputs: Record<string, unknown>, nodeData: Record<string, unknown>): NodeContext {
  return { inputs, nodeData, runId: "test-run", userId: 1 };
}

describe("splitHandler", () => {
  it("distributes array elements across output keys", async () => {
    const ctx = makeCtx(
      { data: ["a", "b", "c"] },
      { output_keys: ["first", "second", "third"] },
    );
    const result = await splitHandler(ctx);
    expect(result).toEqual({ outputs: { first: "a", second: "b", third: "c" } });
  });

  it("fills missing array elements with null", async () => {
    const ctx = makeCtx(
      { data: ["a"] },
      { output_keys: ["first", "second"] },
    );
    const result = await splitHandler(ctx);
    expect(result).toEqual({ outputs: { first: "a", second: null } });
  });

  it("picks requested keys from an object source", async () => {
    const ctx = makeCtx(
      { data: { x: 1, y: 2, z: 3 } },
      { output_keys: ["x", "z"] },
    );
    const result = await splitHandler(ctx);
    expect(result).toEqual({ outputs: { x: 1, z: 3 } });
  });

  it("passes all keys when output_keys is empty and source is object", async () => {
    const ctx = makeCtx({ data: { a: 1, b: 2 } }, {});
    const result = await splitHandler(ctx);
    expect(result).toEqual({ outputs: { a: 1, b: 2 } });
  });

  it("broadcasts a single scalar to all output keys", async () => {
    const ctx = makeCtx({ value: 42 }, { output_keys: ["a", "b"] });
    const result = await splitHandler(ctx);
    expect(result).toEqual({ outputs: { a: 42, b: 42 } });
  });

  it("uses 'default' key when no output_keys and scalar input", async () => {
    const ctx = makeCtx({ value: "hello" }, {});
    const result = await splitHandler(ctx);
    expect(result).toEqual({ outputs: { default: "hello" } });
  });

  it("fills null for missing object keys", async () => {
    const ctx = makeCtx(
      { data: { x: 1 } },
      { output_keys: ["x", "missing"] },
    );
    const result = await splitHandler(ctx);
    expect(result).toEqual({ outputs: { x: 1, missing: null } });
  });
});
