import { describe, it, expect, vi, beforeEach } from "vitest";

// ---- isolated-vm mock using vi.hoisted for proper constructor support ----
const { mockDispose, mockRun, mockSet, mockCompileScript } = vi.hoisted(() => {
  const mockDispose = vi.fn();
  const mockRun = vi.fn().mockResolvedValue("42");
  const mockSet = vi.fn().mockResolvedValue(undefined);
  const mockCompileScript = vi.fn().mockResolvedValue({ run: mockRun });
  return { mockDispose, mockRun, mockSet, mockCompileScript };
});

let mockIsDisposed = false;

vi.mock("isolated-vm", () => {
  // Must use `function` (not arrow) so it's callable with `new`
  function Isolate() {
    return {
      createContext: vi.fn().mockResolvedValue({
        global: { set: mockSet },
      }),
      compileScript: mockCompileScript,
      dispose: mockDispose,
      get isDisposed() {
        return mockIsDisposed;
      },
    };
  }
  return { default: { Isolate } };
});

// Mock the tools index
vi.mock("../../../src/lib/tools/index.js", () => ({
  registerTool: vi.fn(),
}));

import { executeCodeTool } from "../../../src/lib/tools/execute_code.js";

describe("executeCodeTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsDisposed = false;
    mockRun.mockReset();
    mockRun.mockResolvedValue(42);
    mockCompileScript.mockResolvedValue({ run: mockRun });
  });

  it("has correct tool definition", () => {
    expect(executeCodeTool.definition.name).toBe("execute_code");
    expect(executeCodeTool.definition.parameters.required).toContain("code");
  });

  it("executes simple code and returns the stringified result", async () => {
    mockRun.mockResolvedValue(42);
    const result = await executeCodeTool.execute({ code: "21 * 2" });
    expect(result).toBe("42");
  });

  it("returns 'undefined' when the result is undefined", async () => {
    mockRun.mockResolvedValue(undefined);
    const result = await executeCodeTool.execute({ code: "let x = 1;" });
    expect(result).toBe("undefined");
  });

  it("returns JSON-stringified result for objects", async () => {
    mockRun.mockResolvedValue({ a: 1, b: 2 });
    const result = await executeCodeTool.execute({ code: '({a:1, b:2})' });
    const parsed = JSON.parse(result);
    expect(parsed).toEqual({ a: 1, b: 2 });
  });

  it("returns string results directly", async () => {
    mockRun.mockResolvedValue("hello");
    const result = await executeCodeTool.execute({ code: '"hello"' });
    expect(result).toBe("hello");
  });

  it("returns execution error message on failure", async () => {
    mockRun.mockRejectedValue(new Error("ReferenceError: foo is not defined"));
    const result = await executeCodeTool.execute({ code: "foo" });
    expect(result).toContain("Execution Error");
    expect(result).toContain("foo is not defined");
  });

  it("enforces timeout via script.run options", async () => {
    mockRun.mockRejectedValue(new Error("Script execution timed out."));
    const result = await executeCodeTool.execute({ code: "while(true){}" });
    expect(result).toContain("Execution Error");
    expect(result).toContain("timed out");
  });

  it("disposes isolate after successful execution", async () => {
    mockRun.mockResolvedValue(1);
    await executeCodeTool.execute({ code: "1" });
    expect(mockDispose).toHaveBeenCalled();
  });

  it("disposes isolate after error if not already disposed", async () => {
    mockRun.mockRejectedValue(new Error("boom"));
    mockIsDisposed = false;
    await executeCodeTool.execute({ code: "throw 'boom'" });
    expect(mockDispose).toHaveBeenCalled();
  });

  it("does not double-dispose if already disposed", async () => {
    mockRun.mockRejectedValue(new Error("boom"));
    mockIsDisposed = true;
    await executeCodeTool.execute({ code: "throw 'boom'" });
    expect(mockDispose).not.toHaveBeenCalled();
  });
});
