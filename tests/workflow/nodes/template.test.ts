import { describe, it, expect } from "vitest";
import { templateHandler } from "../../../src/workflow/nodes/template.handler.js";
import type { NodeContext } from "../../../src/workflow/types.js";

function makeCtx(inputs: Record<string, unknown>, nodeData: Record<string, unknown>): NodeContext {
  return { inputs, nodeData, runId: "test-run", userId: 1 };
}

describe("templateHandler", () => {
  it("substitutes variables from inputs", async () => {
    const ctx = makeCtx(
      { name: "Alice", age: 30 },
      { template: "Hello {{name}}, you are {{age}} years old." },
    );
    const result = await templateHandler(ctx);
    expect(result).toEqual({ text: "Hello Alice, you are 30 years old." });
  });

  it("leaves unmatched placeholders intact", async () => {
    const ctx = makeCtx({ name: "Carol" }, { template: "Hello {{name}}! Age: {{age}}" });
    const result = await templateHandler(ctx);
    expect(result).toEqual({ text: "Hello Carol! Age: {{age}}" });
  });

  it("returns empty string when template is not provided", async () => {
    const ctx = makeCtx({ name: "Bob" }, {});
    const result = await templateHandler(ctx);
    expect(result).toEqual({ text: "" });
  });

  it("returns empty string for empty template", async () => {
    const ctx = makeCtx({ a: 1 }, { template: "" });
    const result = await templateHandler(ctx);
    expect(result).toEqual({ text: "" });
  });

  it("handles template with no placeholders", async () => {
    const ctx = makeCtx({}, { template: "No variables here." });
    const result = await templateHandler(ctx);
    expect(result).toEqual({ text: "No variables here." });
  });

  it("handles multiple occurrences of the same variable", async () => {
    const ctx = makeCtx({ x: "7" }, { template: "{{x}} + {{x}} = 2*{{x}}" });
    const result = await templateHandler(ctx);
    expect(result).toEqual({ text: "7 + 7 = 2*7" });
  });

  it("converts non-string values via String()", async () => {
    const ctx = makeCtx({ val: true }, { template: "val={{val}}" });
    const result = await templateHandler(ctx);
    expect(result).toEqual({ text: "val=true" });
  });
});
