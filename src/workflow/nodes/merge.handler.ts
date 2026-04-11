import type { NodeHandler } from "../types.js";

export const mergeHandler: NodeHandler = async (ctx) => {
  // Collect all inputs into a single merged object
  const merged: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(ctx.inputs)) {
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      Object.assign(merged, value);
    } else {
      merged[key] = value;
    }
  }

  return merged;
};
