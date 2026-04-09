import type { NodeHandler } from "../types.js";

export const loopHandler: NodeHandler = async (ctx) => {
  const items = (ctx.inputs.items as unknown[]) ?? [];
  const maxIterations = (ctx.nodeData.max_iterations as number) || 100;

  const results: unknown[] = [];
  const limit = Math.min(items.length, maxIterations);

  for (let i = 0; i < limit; i++) {
    // Simple pass-through: each item becomes an output entry
    results.push(items[i]);
  }

  return { results };
};
