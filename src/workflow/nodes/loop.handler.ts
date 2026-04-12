import type { NodeHandler } from "../types.js";

export const loopHandler: NodeHandler = async (ctx) => {
  const items = (ctx.inputs.items as unknown[]) ?? [];
  const maxIterations = (ctx.nodeData.max_iterations as number) || 100;

  // Optional body expression evaluated per item (e.g. "item.name", "item * 2").
  // When not provided, each item is passed through unchanged (map-identity).
  const bodyExpr = (ctx.nodeData.body as string) || "";

  // Optional filter expression evaluated per item — only truthy results are kept.
  const filterExpr = (ctx.nodeData.filter as string) || "";

  // Accumulator mode: "collect" (default) gathers results into an array,
  // "sum" / "concat" reduce into a single value.
  const accumulator = (ctx.nodeData.accumulator as string) || "collect";

  const results: unknown[] = [];
  const limit = Math.min(items.length, maxIterations);

  for (let i = 0; i < limit; i++) {
    const item = items[i];
    const index = i;

    // Evaluate the optional filter expression
    if (filterExpr) {
      try {
        const keep = new Function("item", "index", "items", `"use strict"; return (${filterExpr});`)(item, index, items);
        if (!keep) continue;
      } catch {
        // If filter expression fails, include the item
      }
    }

    // Evaluate the body expression to transform each item
    if (bodyExpr) {
      try {
        const transformed = new Function("item", "index", "items", `"use strict"; return (${bodyExpr});`)(item, index, items);
        results.push(transformed);
      } catch {
        // On expression error, pass the item through unchanged
        results.push(item);
      }
    } else {
      results.push(item);
    }
  }

  // Reduce step based on accumulator mode
  if (accumulator === "sum") {
    const total = results.reduce<number>((acc, val) => acc + (typeof val === "number" ? val : 0), 0);
    return { result: total, count: results.length };
  }

  if (accumulator === "concat") {
    const joined = results.map((v) => String(v ?? "")).join("");
    return { result: joined, count: results.length };
  }

  // Default: "collect" — return the full results array
  return { results, count: results.length };
};
