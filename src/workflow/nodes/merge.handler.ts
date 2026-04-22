import type { NodeHandler } from "../types.js";

// P10-111: Keys that would cause prototype pollution
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

// P22-06: Cap conflict array size to prevent unbounded memory growth
const MAX_CONFLICT_ARRAY_SIZE = 100;

// P10-113: Merge strategy types
type MergeStrategy = "overwrite" | "array_append" | "deep_merge";

function isSafeKey(key: string): boolean {
  return !DANGEROUS_KEYS.has(key);
}

// P10-113: Deep merge helper for nested objects
// P22-02: Add recursion depth limit to prevent stack overflow from deeply nested objects
const MAX_MERGE_DEPTH = 20;

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>, depth = 0): Record<string, unknown> {
  if (depth > MAX_MERGE_DEPTH) {
    return { ...target, ...source }; // Shallow merge at max depth
  }
  const result: Record<string, unknown> = Object.create(null);
  Object.assign(result, target);
  for (const key of Object.keys(source)) {
    if (!isSafeKey(key)) continue; // P10-111
    const value = source[key];
    if (
      typeof value === "object" && value !== null && !Array.isArray(value) &&
      typeof result[key] === "object" && result[key] !== null && !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(result[key] as Record<string, unknown>, value as Record<string, unknown>, depth + 1);
    } else {
      result[key] = value;
    }
  }
  return result;
}

export const mergeHandler: NodeHandler = async (ctx) => {
  // P10-113: Configurable merge strategy
  const strategy = (ctx.nodeData.merge_strategy as MergeStrategy) || "overwrite";
  // P10-112: Explicit precedence via ordered input_priority list
  const priority = (ctx.nodeData.input_priority as string[]) || [];

  const merged: Record<string, unknown> = {};
  const conflicts: Record<string, unknown[]> = {}; // P10-113: Track conflicts

  // P10-112: Sort entries by priority (listed keys first, in order)
  const entries = Object.entries(ctx.inputs);
  entries.sort((a, b) => {
    const aIdx = priority.indexOf(a[0]);
    const bIdx = priority.indexOf(b[0]);
    if (aIdx === -1 && bIdx === -1) return 0;
    if (aIdx === -1) return 1;
    if (bIdx === -1) return -1;
    return aIdx - bIdx;
  });

  for (const [key, value] of entries) {
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      const obj = value as Record<string, unknown>;
      for (const [k, v] of Object.entries(obj)) {
        // P10-111: Skip prototype-polluting keys
        if (!isSafeKey(k)) continue;

        if (k in merged) {
          // P10-113: Handle conflicts based on strategy
          if (strategy === "array_append") {
            if (!conflicts[k]) conflicts[k] = [merged[k]];
            // P22-06: Cap conflict array to prevent unbounded growth
            if (conflicts[k].length < MAX_CONFLICT_ARRAY_SIZE) {
              conflicts[k].push(v);
            }
            merged[k] = conflicts[k];
          } else if (strategy === "deep_merge" && typeof v === "object" && v !== null && !Array.isArray(v)) {
            merged[k] = deepMerge(
              (merged[k] as Record<string, unknown>) || {},
              v as Record<string, unknown>
            );
          } else {
            // "overwrite" — last-by-priority wins
            merged[k] = v;
          }
        } else {
          merged[k] = v;
        }
      }
    } else {
      // P10-111: Sanitize top-level keys
      if (!isSafeKey(key)) continue;
      merged[key] = value;
    }
  }

  return merged;
};
