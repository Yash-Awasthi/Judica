import { describe, it, expect, vi } from "vitest";
import type { NodeContext } from "../../../src/workflow/types.js";

vi.mock("../../../src/sandbox/jsSandbox.js", () => ({
  executeJS: vi.fn(),
}));

vi.mock("../../../src/sandbox/pythonSandbox.js", () => ({
  executePython: vi.fn(),
}));

import { codeHandler } from "../../../src/workflow/nodes/code.handler.js";
import { executeJS } from "../../../src/sandbox/jsSandbox.js";
import { executePython } from "../../../src/sandbox/pythonSandbox.js";

const mockExecuteJS = vi.mocked(executeJS);
const mockExecutePython = vi.mocked(executePython);

import { beforeEach } from "vitest";

beforeEach(() => {
  vi.clearAllMocks();
});

function makeCtx(inputs: Record<string, unknown>, nodeData: Record<string, unknown>): NodeContext {
  return { inputs, nodeData, runId: "test-run", userId: 1 };
}

describe("codeHandler", () => {
  it("defaults to javascript when language is not specified", async () => {
    mockExecuteJS.mockResolvedValue({ output: "42", error: "" });

    const ctx = makeCtx({}, { code: "1 + 1" });
    const result = await codeHandler(ctx);

    expect(mockExecuteJS).toHaveBeenCalledWith("const __inputs__ = {};\n1 + 1");
    expect(mockExecutePython).not.toHaveBeenCalled();
    expect(result).toEqual({ output: "42", error: "" });
  });

  it("routes to javascript when language is 'javascript'", async () => {
    mockExecuteJS.mockResolvedValue({ output: "hello", error: "" });

    const ctx = makeCtx({}, { code: "console.log('hello')", language: "javascript" });
    const result = await codeHandler(ctx);

    expect(mockExecuteJS).toHaveBeenCalledWith("const __inputs__ = {};\nconsole.log('hello')");
    expect(result).toEqual({ output: "hello", error: "" });
  });

  it("routes to python when language is 'python'", async () => {
    mockExecutePython.mockResolvedValue({ output: "3.14", error: "" });

    const ctx = makeCtx({}, { code: "print(3.14)", language: "python" });
    const result = await codeHandler(ctx);

    expect(mockExecutePython).toHaveBeenCalledWith("import json\n__inputs__ = json.loads('{}')\nprint(3.14)");
    expect(mockExecuteJS).not.toHaveBeenCalled();
    expect(result).toEqual({ output: "3.14", error: "" });
  });

  it("returns output from successful JS execution", async () => {
    mockExecuteJS.mockResolvedValue({ output: "result-value", error: "" });

    const ctx = makeCtx({}, { code: "code here" });
    const result = await codeHandler(ctx);

    expect(result.output).toBe("result-value");
    expect(result.error).toBe("");
  });

  it("returns error from failed JS execution", async () => {
    mockExecuteJS.mockResolvedValue({ output: "", error: "ReferenceError: x is not defined" });

    const ctx = makeCtx({}, { code: "x()" });
    const result = await codeHandler(ctx);

    expect(result.output).toBe("");
    expect(result.error).toBe("ReferenceError: x is not defined");
  });

  it("returns error from failed Python execution", async () => {
    mockExecutePython.mockResolvedValue({ output: "", error: "NameError: name 'x' is not defined" });

    const ctx = makeCtx({}, { code: "x()", language: "python" });
    const result = await codeHandler(ctx);

    expect(result.output).toBe("");
    expect(result.error).toBe("NameError: name 'x' is not defined");
  });

  it("returns both output and error when present", async () => {
    mockExecuteJS.mockResolvedValue({ output: "partial", error: "warning" });

    const ctx = makeCtx({}, { code: "something" });
    const result = await codeHandler(ctx);

    expect(result).toEqual({ output: "partial", error: "warning" });
  });
});
