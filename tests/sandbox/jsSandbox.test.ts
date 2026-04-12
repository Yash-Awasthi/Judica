import { describe, it, expect, vi, beforeEach } from "vitest";

// Use vi.hoisted so mock fns are available inside the vi.mock factory
// (vi.mock is hoisted above all imports, so plain const would be TDZ errors).
const {
  mockDispose,
  mockRun,
  mockSet,
  mockCompileScript,
  mockCreateContext,
} = vi.hoisted(() => ({
  mockDispose: vi.fn(),
  mockRun: vi.fn().mockResolvedValue(undefined),
  mockSet: vi.fn().mockResolvedValue(undefined),
  mockCompileScript: vi.fn(),
  mockCreateContext: vi.fn(),
}));

vi.mock("isolated-vm", () => {
  // ivm.Isolate is used as `new ivm.Isolate(...)` — must be a real function
  // so that `new` works. vi.fn().mockImplementation() arrow fns are not
  // constructable; we need actual function declarations.
  function Isolate() {
    return {
      createContext: mockCreateContext,
      compileScript: mockCompileScript,
      dispose: mockDispose,
    };
  }
  function Reference(fn: any) {
    return { fn };
  }
  return { default: { Isolate, Reference } };
});

import { executeJS } from "../../src/sandbox/jsSandbox.js";

describe("jsSandbox – executeJS", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRun.mockResolvedValue(undefined);
    mockCompileScript.mockResolvedValue({ run: mockRun });
    mockCreateContext.mockResolvedValue({ global: { set: mockSet } });
    mockSet.mockResolvedValue(undefined);
  });

  it("runs code successfully and returns no error", async () => {
    const result = await executeJS("1 + 1");

    expect(result.error).toBeNull();
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(result.output)).toBe(true);
  });

  it("captures console output via the log callback", async () => {
    // When jail.set("_logCallback", ref) is called, grab the original fn
    // stored inside the Reference mock. Then when script.run executes,
    // invoke that fn to simulate what the wrapped sandbox code does.
    let capturedLogFn: ((arg: string) => void) | undefined;

    mockSet.mockImplementation(async (name: string, ref: any) => {
      if (name === "_logCallback" && ref?.fn) {
        capturedLogFn = ref.fn;
      }
    });

    mockCompileScript.mockImplementation(async () => ({
      run: vi.fn(async () => {
        capturedLogFn?.("hello world");
      }),
    }));

    const result = await executeJS('console.log("hello world")');

    expect(result.output).toContain("hello world");
    expect(result.error).toBeNull();
  });

  it("returns an error when the script throws", async () => {
    mockRun.mockRejectedValue(new Error("ReferenceError: x is not defined"));

    const result = await executeJS("x");

    expect(result.error).toBe("ReferenceError: x is not defined");
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it("returns an error on timeout", async () => {
    mockRun.mockRejectedValue(new Error("Script execution timed out"));

    const result = await executeJS("while(true){}", 100);

    expect(result.error).toContain("timed out");
  });

  it("disposes the isolate in the finally block", async () => {
    await executeJS("1+1");

    expect(mockDispose).toHaveBeenCalledTimes(1);
  });

  it("disposes the isolate even when an error occurs", async () => {
    mockRun.mockRejectedValue(new Error("boom"));

    await executeJS("throw 'boom'");

    expect(mockDispose).toHaveBeenCalledTimes(1);
  });
});
