import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";

// Use vi.hoisted so these fns exist before the hoisted vi.mock factories run.
const { mockSpawn, mockExecSync, mockWriteFileSync, mockMkdirSync, mockRmSync } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
  mockExecSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
  mockMkdirSync: vi.fn(),
  mockRmSync: vi.fn(),
}));

vi.mock("child_process", () => ({
  spawn: mockSpawn,
  execSync: mockExecSync,
}));

vi.mock("fs", () => ({
  default: {
    writeFileSync: mockWriteFileSync,
    mkdirSync: mockMkdirSync,
    rmSync: mockRmSync,
  },
  writeFileSync: mockWriteFileSync,
  mkdirSync: mockMkdirSync,
  rmSync: mockRmSync,
}));

vi.mock("crypto", () => ({
  default: {
    randomBytes: () => ({ toString: () => "abcdef0123456789" }),
  },
  randomBytes: () => ({ toString: () => "abcdef0123456789" }),
}));

vi.mock("os", () => ({
  default: {
    tmpdir: () => "/tmp",
  },
  tmpdir: () => "/tmp",
}));

vi.mock("../../src/lib/logger.js", () => ({
  default: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { executePython } from "../../src/sandbox/pythonSandbox.js";

/** Helper: create a fake ChildProcess with stdout/stderr as EventEmitters. */
function makeFakeProc() {
  const proc = new EventEmitter() as any;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = { write: vi.fn(), end: vi.fn() };
  proc.kill = vi.fn();
  return proc;
}

describe("pythonSandbox – executePython", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns stdout output on successful execution", async () => {
    const proc = makeFakeProc();
    mockSpawn.mockReturnValue(proc);

    const promise = executePython('print("hello")');

    proc.stdout.emit("data", Buffer.from("hello\n"));
    proc.emit("close", 0);

    const result = await promise;

    expect(result.output).toContain("hello");
    expect(result.error).toBeNull();
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it("returns error when stderr has content", async () => {
    const proc = makeFakeProc();
    mockSpawn.mockReturnValue(proc);

    const promise = executePython("import nonexistent");

    proc.stderr.emit("data", Buffer.from("ModuleNotFoundError: No module named 'nonexistent'\n"));
    proc.emit("close", 1);

    const result = await promise;

    expect(result.error).toContain("ModuleNotFoundError");
  });

  it("returns error when process exits with non-zero code and no stderr", async () => {
    const proc = makeFakeProc();
    mockSpawn.mockReturnValue(proc);

    const promise = executePython("import sys; sys.exit(1)");

    proc.emit("close", 1);

    const result = await promise;

    expect(result.error).toContain("Process exited with code 1");
  });

  it("handles spawn error (e.g. python3 not found)", async () => {
    const proc = makeFakeProc();
    mockSpawn.mockReturnValue(proc);

    const promise = executePython("print(1)");

    proc.emit("error", new Error("spawn python3 ENOENT"));

    const result = await promise;

    expect(result.error).toContain("ENOENT");
  });

  it("creates a sandbox directory, writes a temp file, and cleans up in finally", async () => {
    const proc = makeFakeProc();
    mockSpawn.mockReturnValue(proc);

    const promise = executePython("x = 1");

    proc.emit("close", 0);
    await promise;

    // Should create a sandbox directory
    expect(mockMkdirSync).toHaveBeenCalledTimes(1);
    const dirPath = mockMkdirSync.mock.calls[0][0] as string;
    expect(dirPath).toMatch(/sandbox_/);

    // Should write the script file inside the sandbox directory
    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
    const writtenPath = mockWriteFileSync.mock.calls[0][0] as string;
    expect(writtenPath).toMatch(/sandbox_.*[/\\]script\.py$/);

    // Should clean up with rmSync (recursive directory removal)
    expect(mockRmSync).toHaveBeenCalledTimes(1);
    expect(mockRmSync.mock.calls[0][0]).toBe(dirPath);
  });

  it("cleans up sandbox directory even when execution errors", async () => {
    const proc = makeFakeProc();
    mockSpawn.mockReturnValue(proc);

    const promise = executePython("bad code");

    proc.emit("error", new Error("spawn failed"));
    await promise;

    expect(mockRmSync).toHaveBeenCalledTimes(1);
  });

  it("prepends sandbox preamble with import restrictions and network blocking", async () => {
    const proc = makeFakeProc();
    mockSpawn.mockReturnValue(proc);

    const promise = executePython("print(1)");

    proc.emit("close", 0);
    await promise;

    const writtenContent = mockWriteFileSync.mock.calls[0][1] as string;
    // Should contain network blocking (carried over from original)
    expect(writtenContent).toContain("_BlockedSocket");
    expect(writtenContent).toContain("Network access is disabled in sandbox");
    // Should contain new ctypes/FFI blocking
    expect(writtenContent).toContain("_BLOCKED_MODULES");
    expect(writtenContent).toContain("_restricted_import");
    // Should contain os function blocking
    expect(writtenContent).toContain("'system', 'popen'");
    // Should contain file write restrictions
    expect(writtenContent).toContain("_restricted_open");
    // Should contain introspection hardening
    expect(writtenContent).toContain("_blocked_from_modules");
    // Should contain the user code
    expect(writtenContent).toContain("print(1)");
  });

  it("spawns bash with ulimit constraints", async () => {
    const proc = makeFakeProc();
    mockSpawn.mockReturnValue(proc);

    const promise = executePython("pass");

    proc.emit("close", 0);
    await promise;

    expect(mockSpawn).toHaveBeenCalledWith(
      "bash",
      expect.arrayContaining(["-c", expect.stringContaining("ulimit")]),
      expect.objectContaining({ timeout: 10000 }),
    );
  });

  it("sets restricted environment variables including PYTHONSAFEPATH", async () => {
    const proc = makeFakeProc();
    mockSpawn.mockReturnValue(proc);

    const promise = executePython("pass");

    proc.emit("close", 0);
    await promise;

    const spawnOptions = mockSpawn.mock.calls[0][2];
    expect(spawnOptions.env).toMatchObject({
      PYTHONDONTWRITEBYTECODE: "1",
      PYTHONPATH: "",
      PYTHONNOUSERSITE: "1",
      PYTHONSAFEPATH: "1",
    });
  });

  it("sets cwd to the sandbox directory", async () => {
    const proc = makeFakeProc();
    mockSpawn.mockReturnValue(proc);

    const promise = executePython("pass");

    proc.emit("close", 0);
    await promise;

    const spawnOptions = mockSpawn.mock.calls[0][2];
    expect(spawnOptions.cwd).toMatch(/sandbox_/);
  });
});
