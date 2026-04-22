import ivm from "isolated-vm";
import type { NodeHandler } from "../types.js";

/**
 * P3-27: User-supplied expressions run in isolated-vm, NOT eval().
 * The sandbox has no access to process, require, fs, or any Node.js globals.
 * Expression length is capped to prevent excessive compilation overhead.
 */
const MAX_EXPR_LENGTH = 2000;

// P10-110: Configurable global loop timeout (default 5 minutes)
// P19-07: Guard against NaN from invalid env var
const _parsedLoopTimeout = parseInt(process.env.LOOP_TOTAL_TIMEOUT_MS || "300000", 10);
const LOOP_TOTAL_TIMEOUT_MS = Number.isFinite(_parsedLoopTimeout) && _parsedLoopTimeout > 0 ? _parsedLoopTimeout : 300000;

// P10-107: Reuse a single isolate across iterations to avoid 100x startup overhead
async function safeEvalExpr(
  isolate: ivm.Isolate,
  expr: string,
  item: unknown,
  index: number,
  items: unknown[],
): Promise<unknown> {
  // P3-27: Reject excessively long expressions to prevent compilation DoS
  if (expr.length > MAX_EXPR_LENGTH) {
    throw new Error(`Expression exceeds maximum length of ${MAX_EXPR_LENGTH} characters`);
  }

  const context = await isolate.createContext();
  const jail = context.global;

  await jail.set("__item", new ivm.ExternalCopy(item).copyInto());
  await jail.set("__index", index);
  // P10-108: Pass only current item count instead of full items array to avoid O(n²) copying
  await jail.set("__length", items.length);

  const script = await isolate.compileScript(
    `"use strict"; const item = __item; const index = __index; const length = __length; (${expr});`,
  );
  const result = await script.run(context, { timeout: 1000 });
  return result;
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
  const errors: { index: number; error: string }[] = []; // P10-109: Track per-iteration errors
  const limit = Math.min(items.length, maxIterations);

  // P10-110: Global loop timeout
  const loopStart = Date.now();

  // P10-107: Create one isolate for all iterations
  const isolate = new ivm.Isolate({ memoryLimit: 64 });

  try {
    for (let i = 0; i < limit; i++) {
      // P10-110: Check global timeout
      if (Date.now() - loopStart > LOOP_TOTAL_TIMEOUT_MS) {
        errors.push({ index: i, error: `Loop terminated: exceeded total timeout of ${LOOP_TOTAL_TIMEOUT_MS}ms` });
        break;
      }

      const item = items[i];

      // Evaluate the optional filter expression in sandbox
      if (filterExpr) {
        try {
          const keep = await safeEvalExpr(isolate, filterExpr, item, i, items);
          if (!keep) continue;
        } catch (err) {
          // On filter failure, exclude the item and track the error
          errors.push({ index: i, error: `filter: ${(err as Error).message}` });
          continue;
        }
      }

      // Evaluate the body expression in sandbox
      if (bodyExpr) {
        try {
          const transformed = await safeEvalExpr(isolate, bodyExpr, item, i, items);
          results.push(transformed);
        } catch (err) {
          // On body failure, push null and track the error
          results.push(null);
          errors.push({ index: i, error: `body: ${(err as Error).message}` });
        }
      } else {
        results.push(item);
      }
    }
  } finally {
    // P10-107: Dispose shared isolate once after all iterations
    try { isolate.dispose(); } catch { /* dispose may throw if already disposed */ }
  }

  // Reduce step based on accumulator mode
  if (accumulator === "sum") {
    const total = results.reduce<number>((acc, val) => acc + (typeof val === "number" ? val : 0), 0);
    return { result: total, count: results.length, errors };
  }

  if (accumulator === "concat") {
    const joined = results.map((v) => String(v ?? "")).join("");
    return { result: joined, count: results.length, errors };
  }

  // Default: "collect" — return the full results array
  return { results, count: results.length, errors };
};
