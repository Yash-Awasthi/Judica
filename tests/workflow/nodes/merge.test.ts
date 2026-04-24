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

// ── Merge strategies ──────────────────────────────────────────────────────────

describe("mergeHandler — overwrite strategy (default)", () => {
  it("later input overwrites earlier for conflicting keys", async () => {
    const ctx = makeCtx(
      { a: { x: 1 }, b: { x: 2 } },
      { merge_strategy: "overwrite" }
    );
    const result = await mergeHandler(ctx);
    expect(result).toEqual({ x: 2 });
  });
});

describe("mergeHandler — array_append strategy", () => {
  it("collects conflicting keys into an array", async () => {
    const ctx = makeCtx(
      { a: { score: 1 }, b: { score: 2 } },
      { merge_strategy: "array_append" }
    );
    const result = await mergeHandler(ctx);
    expect(Array.isArray(result.score)).toBe(true);
    expect(result.score).toContain(1);
    expect(result.score).toContain(2);
  });

  it("first non-conflicting key is not wrapped in an array", async () => {
    const ctx = makeCtx(
      { a: { x: 1 }, b: { y: 2 } },
      { merge_strategy: "array_append" }
    );
    const result = await mergeHandler(ctx);
    expect(result.x).toBe(1);
    expect(result.y).toBe(2);
  });

  it("accumulates three conflicting values into array", async () => {
    const ctx = makeCtx(
      { a: { k: 10 }, b: { k: 20 }, c: { k: 30 } },
      { merge_strategy: "array_append" }
    );
    const result = await mergeHandler(ctx);
    expect(result.k).toEqual([10, 20, 30]);
  });
});

describe("mergeHandler — deep_merge strategy", () => {
  it("recursively merges nested objects", async () => {
    const ctx = makeCtx(
      {
        a: { settings: { theme: "dark", lang: "en" } },
        b: { settings: { lang: "fr", beta: true } },
      },
      { merge_strategy: "deep_merge" }
    );
    const result = await mergeHandler(ctx);
    expect(result.settings).toEqual({ theme: "dark", lang: "fr", beta: true });
  });

  it("overwrites non-object with non-object in deep_merge", async () => {
    const ctx = makeCtx(
      { a: { count: 1 }, b: { count: 2 } },
      { merge_strategy: "deep_merge" }
    );
    const result = await mergeHandler(ctx);
    expect(result.count).toBe(2);
  });

  it("falls back to overwrite when source value is not an object", async () => {
    const ctx = makeCtx(
      { a: { cfg: { nested: true } }, b: { cfg: "plain" } },
      { merge_strategy: "deep_merge" }
    );
    const result = await mergeHandler(ctx);
    expect(result.cfg).toBe("plain");
  });
});

// ── input_priority ────────────────────────────────────────────────────────────

describe("mergeHandler — input_priority", () => {
  it("priority input processed first, non-priority overwrites last", async () => {
    // priority: ["a"] → a is first, then b comes later (b wins in overwrite)
    const ctx = makeCtx(
      { a: { score: 100 }, b: { score: 200 } },
      { input_priority: ["a"], merge_strategy: "overwrite" }
    );
    const result = await mergeHandler(ctx);
    expect(result.score).toBe(200);
  });

  it("all priority inputs processed before non-priority", async () => {
    const ctx = makeCtx(
      { c: { tag: "c" }, a: { tag: "a" }, b: { tag: "b" } },
      { input_priority: ["b", "a"], merge_strategy: "overwrite" }
    );
    // sort: b→idx0, a→idx1, c→-1 (appended last)
    // overwrite: b first, then a overwrites (tag="a"), then c overwrites (tag="c")
    const result = await mergeHandler(ctx);
    expect(result.tag).toBe("c");
  });

  it("two prioritised inputs: second priority wins over first", async () => {
    const ctx = makeCtx(
      { x: { val: "x" }, y: { val: "y" } },
      { input_priority: ["x", "y"], merge_strategy: "overwrite" }
    );
    // sort: x→idx0, y→idx1 → y processed last → y wins
    const result = await mergeHandler(ctx);
    expect(result.val).toBe("y");
  });
});

// ── Dangerous key filtering ───────────────────────────────────────────────────

describe("mergeHandler — dangerous key filtering", () => {
  it("drops constructor keys from nested objects", async () => {
    const ctx = makeCtx({ a: { constructor: "evil", safe: "value" } }, {});
    const result = await mergeHandler(ctx);
    // result.constructor is inherited from Object.prototype; check own property only
    expect(Object.prototype.hasOwnProperty.call(result, "constructor")).toBe(false);
    expect(result.safe).toBe("value");
  });

  it("drops prototype keys from nested objects", async () => {
    const ctx = makeCtx({ a: { prototype: "evil", legit: 42 } }, {});
    const result = await mergeHandler(ctx);
    expect(Object.prototype.hasOwnProperty.call(result, "prototype")).toBe(false);
    expect(result.legit).toBe(42);
  });
});

// ── MAX_MERGE_DEPTH recursion guard ───────────────────────────────────────────

describe("mergeHandler — deepMerge MAX_MERGE_DEPTH guard", () => {
  it("does not throw on deeply-nested objects (falls back to shallow merge at depth 20)", async () => {
    function buildDeep(depth: number, leafVal: string): Record<string, unknown> {
      if (depth === 0) return { leaf: leafVal };
      return { nested: buildDeep(depth - 1, leafVal) };
    }

    const ctx = makeCtx(
      { a: buildDeep(25, "a"), b: buildDeep(25, "b") },
      { merge_strategy: "deep_merge" }
    );
    // Should not throw or stack-overflow
    await expect(mergeHandler(ctx)).resolves.toBeDefined();
  });
});
