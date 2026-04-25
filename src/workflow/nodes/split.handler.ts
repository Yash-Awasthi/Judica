import type { NodeHandler } from "../types.js";

// Keys that would cause prototype pollution
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export const splitHandler: NodeHandler = async (ctx) => {
  // Take the first input value and split it into multiple named outputs
  const keys = (ctx.nodeData.output_keys as string[]) ?? [];

  // Use named input_key instead of positional first-value lookup
  const inputKey = (ctx.nodeData.input_key as string) || "";
  let source: unknown;

  if (inputKey && inputKey in ctx.inputs) {
    source = ctx.inputs[inputKey];
  } else {
    // Fallback: use explicitly named "data" input, then first available
    source = ctx.inputs["data"] ?? Object.values(ctx.inputs)[0];
  }

  // Return result wrapped in {outputs} to match executor's output extraction
  const result: Record<string, unknown> = {};

  if (Array.isArray(source) && keys.length > 0) {
    // Distribute array elements across output keys
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      // Skip dangerous keys
      if (DANGEROUS_KEYS.has(key)) continue;
      result[key] = source[i] ?? null;
    }
  } else if (typeof source === "object" && source !== null && !Array.isArray(source)) {
    // If source is an object, pick requested keys
    const obj = source as Record<string, unknown>;
    if (keys.length > 0) {
      for (const key of keys) {
        // Skip dangerous keys
        if (DANGEROUS_KEYS.has(key)) continue;
        result[key] = obj[key] ?? null;
      }
    } else {
      // Pass all keys through (with sanitization)
      for (const [k, v] of Object.entries(obj)) {
        if (DANGEROUS_KEYS.has(k)) continue;
        result[k] = v;
      }
    }
  } else {
    // Single value — broadcast to all output keys
    for (const key of keys) {
      if (DANGEROUS_KEYS.has(key)) continue;
      result[key] = source;
    }
    if (keys.length === 0) {
      result["default"] = source;
    }
  }

  return { outputs: result };
};
