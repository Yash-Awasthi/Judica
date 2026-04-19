import ivm from "isolated-vm";
import type { NodeHandler } from "../types.js";

/**
 * Safely evaluate a user-supplied expression inside an isolated-vm sandbox.
 * No access to process, require, fs, or any Node.js globals.
 */
async function safeEvalExpr(
  expr: string,
  item: unknown,
  index: number,
  items: unknown[],
): Promise<unknown> {
  const isolate = new ivm.Isolate({ memoryLimit: 32 });
  try {
    const context = await isolate.createContext();
    const jail = context.global;

    await jail.set("__item", new ivm.ExternalCopy(item).copyInto());
    await jail.set("__index", index);
    await jail.set("__items", new ivm.ExternalCopy(items).copyInto());

    const script = await isolate.compileScript(
      `"use strict"; const item = __item; const index = __index; const items = __items; (${expr});`,
    );
    const result = await script.run(context, { timeout: 1000 });
    return result;
  } finally {
    try { isolate.dispose(); } catch { /* dispose may throw if already disposed */ }
  }
}

export const loopHandler: NodeHandler = async (ctx) => {
  const items = (ctx.inputs.items as unknown[]) ?? [];
  const maxIterations = (ctx.nodeData.max_iterations as number) || 100;

  // Optional body expression evaluated per item (e.g. "item.name", "item * 2").
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

    // Evaluate the optional filter expression in sandbox
    if (filterExpr) {
      try {
        const keep = await safeEvalExpr(filterExpr, item, i, items);
        if (!keep) continue;
      } catch {
        // If filter expression fails, include the item
      }
    }

    // Evaluate the body expression in sandbox
    if (bodyExpr) {
      try {
        const transformed = await safeEvalExpr(bodyExpr, item, i, items);
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
