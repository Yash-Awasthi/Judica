import type { NodeHandler } from "../types.js";

export const splitHandler: NodeHandler = async (ctx) => {
  // Take the first input value and split it into multiple named outputs
  const keys = (ctx.nodeData.output_keys as string[]) ?? [];
  const inputValues = Object.values(ctx.inputs);
  const source = inputValues[0];

  const outputs: Record<string, unknown> = {};

  if (Array.isArray(source) && keys.length > 0) {
    // Distribute array elements across output keys
    for (let i = 0; i < keys.length; i++) {
      outputs[keys[i]] = source[i] ?? null;
    }
  } else if (typeof source === "object" && source !== null && !Array.isArray(source)) {
    // If source is an object, pick requested keys
    const obj = source as Record<string, unknown>;
    if (keys.length > 0) {
      for (const key of keys) {
        outputs[key] = obj[key] ?? null;
      }
    } else {
      // Pass all keys through
      Object.assign(outputs, obj);
    }
  } else {
    // Single value — broadcast to all output keys
    for (const key of keys) {
      outputs[key] = source;
    }
    if (keys.length === 0) {
      outputs["default"] = source;
    }
  }

  return { outputs };
};
