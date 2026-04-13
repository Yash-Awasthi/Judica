import { describe, it, expect } from "vitest";
import { conditionHandler } from "../../../src/workflow/nodes/condition.handler.js";
import type { NodeContext } from "../../../src/workflow/types.js";

function makeCtx(inputs: Record<string, unknown>, nodeData: Record<string, unknown>): NodeContext {
  return { inputs, nodeData, runId: "test-run", userId: 1 };
}

describe("conditionHandler", () => {
  it("returns 'true' when value equals compare_to", async () => {
    const ctx = makeCtx({ value: "hello" }, { operator: "equals", compare_to: "hello" });
    const result = await conditionHandler(ctx);
    expect(result).toEqual({ branch: "true" });
  });

  it("returns 'false' when value does not equal compare_to", async () => {
    const ctx = makeCtx({ value: "hello" }, { operator: "equals", compare_to: "world" });
    const result = await conditionHandler(ctx);
    expect(result).toEqual({ branch: "false" });
  });

  it("compares as strings for equals", async () => {
    const ctx = makeCtx({ value: 42 }, { operator: "equals", compare_to: "42" });
    expect(await conditionHandler(ctx)).toEqual({ branch: "true" });
  });

  it("handles not_equals operator", async () => {
    const ctx = makeCtx({ value: "a" }, { operator: "not_equals", compare_to: "b" });
    expect(await conditionHandler(ctx)).toEqual({ branch: "true" });

    const ctx2 = makeCtx({ value: "a" }, { operator: "not_equals", compare_to: "a" });
    expect(await conditionHandler(ctx2)).toEqual({ branch: "false" });
  });

  it("handles contains operator", async () => {
    const ctx = makeCtx({ value: "hello world" }, { operator: "contains", compare_to: "world" });
    expect(await conditionHandler(ctx)).toEqual({ branch: "true" });

    const ctx2 = makeCtx({ value: "hello" }, { operator: "contains", compare_to: "xyz" });
    expect(await conditionHandler(ctx2)).toEqual({ branch: "false" });
  });

  it("handles gt operator", async () => {
    const ctx = makeCtx({ value: 20 }, { operator: "gt", compare_to: 10 });
    expect(await conditionHandler(ctx)).toEqual({ branch: "true" });

    const ctx2 = makeCtx({ value: 5 }, { operator: "gt", compare_to: 10 });
    expect(await conditionHandler(ctx2)).toEqual({ branch: "false" });

    const ctx3 = makeCtx({ value: 10 }, { operator: "gt", compare_to: 10 });
    expect(await conditionHandler(ctx3)).toEqual({ branch: "false" });
  });

  it("handles lt operator", async () => {
    const ctx = makeCtx({ value: 3 }, { operator: "lt", compare_to: 10 });
    expect(await conditionHandler(ctx)).toEqual({ branch: "true" });

    const ctx2 = makeCtx({ value: 15 }, { operator: "lt", compare_to: 10 });
    expect(await conditionHandler(ctx2)).toEqual({ branch: "false" });
  });

  it("handles is_empty for empty string", async () => {
    const ctx = makeCtx({ value: "" }, { operator: "is_empty", compare_to: "" });
    expect(await conditionHandler(ctx)).toEqual({ branch: "true" });
  });

  it("handles is_empty for null/undefined", async () => {
    const ctx = makeCtx({ value: null }, { operator: "is_empty", compare_to: "" });
    expect(await conditionHandler(ctx)).toEqual({ branch: "true" });

    const ctx2 = makeCtx({}, { operator: "is_empty", compare_to: "" });
    expect(await conditionHandler(ctx2)).toEqual({ branch: "true" });
  });

  it("handles is_empty for empty array", async () => {
    const ctx = makeCtx({ value: [] }, { operator: "is_empty", compare_to: "" });
    expect(await conditionHandler(ctx)).toEqual({ branch: "true" });
  });

  it("returns false for non-empty value with is_empty", async () => {
    const ctx = makeCtx({ value: "something" }, { operator: "is_empty", compare_to: "" });
    expect(await conditionHandler(ctx)).toEqual({ branch: "false" });
  });

  it("defaults to equals when no operator specified", async () => {
    const ctx = makeCtx({ value: "x" }, { compare_to: "x" });
    expect(await conditionHandler(ctx)).toEqual({ branch: "true" });
  });

  it("returns false for unknown operator", async () => {
    const ctx = makeCtx({ value: "x" }, { operator: "weird_op", compare_to: "x" });
    expect(await conditionHandler(ctx)).toEqual({ branch: "false" });
  });

  it("falls back to nodeData.value when inputs.value is missing", async () => {
    const ctx = makeCtx({}, { value: "test", operator: "equals", compare_to: "test" });
    expect(await conditionHandler(ctx)).toEqual({ branch: "true" });
  });
});
