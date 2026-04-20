import type { NodeHandler } from "../types.js";

// P10-116: Keys that would cause prototype pollution
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export const splitHandler: NodeHandler = async (ctx) => {
  // Take the first input value and split it into multiple named outputs
  const keys = (ctx.nodeData.output_keys as string[]) ?? [];

  // P10-114: Use named input_key instead of positional first-value lookup
  const inputKey = (ctx.nodeData.input_key as string) || "";
  let source: unknown;

  if (inputKey && inputKey in ctx.inputs) {
    source = ctx.inputs[inputKey];
  } else {
    // Fallback: use explicitly named "data" input, then first available
    source = ctx.inputs["data"] ?? Object.values(ctx.inputs)[0];
  }

  // P10-115: Return flat output keys (not wrapped in {outputs}) to match executor expectations
  const result: Record<string, unknown> = {};

  if (Array.isArray(source) && keys.length > 0) {
    // Distribute array elements across output keys
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      // P10-116: Skip dangerous keys
      if (DANGEROUS_KEYS.has(key)) continue;
      result[key] = source[i] ?? null;
    }
  } else if (typeof source === "object" && source !== null && !Array.isArray(source)) {
    // If source is an object, pick requested keys
    const obj = source as Record<string, unknown>;
    if (keys.length > 0) {
      for (const key of keys) {
        // P10-116: Skip dangerous keys
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
