import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";

// Use vi.hoisted so these fns exist before the hoisted vi.mock factories run.
// This is the correct pattern — plain `const` at module scope would cause a
// TDZ error because vi.mock factories execute before any module-level code.
const { mockSpawn, mockWriteFileSync, mockUnlinkSync } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
  mockWriteFileSync: vi.fn(),
  mockUnlinkSync: vi.fn(),
}));

vi.mock("child_process", () => ({
  spawn: mockSpawn,
}));

vi.mock("fs", () => ({
  default: {
    writeFileSync: mockWriteFileSync,
    unlinkSync: mockUnlinkSync,
  },
  writeFileSync: mockWriteFileSync,
  unlinkSync: mockUnlinkSync,
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

  it("writes a temp file and cleans it up in finally", async () => {
    const proc = makeFakeProc();
    mockSpawn.mockReturnValue(proc);

    const promise = executePython("x = 1");

    proc.emit("close", 0);
    await promise;

    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
    const writtenPath = mockWriteFileSync.mock.calls[0][0] as string;
    expect(writtenPath).toMatch(/sandbox_.*\.py$/);

    expect(mockUnlinkSync).toHaveBeenCalledTimes(1);
    expect(mockUnlinkSync.mock.calls[0][0]).toBe(writtenPath);
  });

  it("cleans up temp file even when execution errors", async () => {
    const proc = makeFakeProc();
    mockSpawn.mockReturnValue(proc);

    const promise = executePython("bad code");

    proc.emit("error", new Error("spawn failed"));
    await promise;

    expect(mockUnlinkSync).toHaveBeenCalledTimes(1);
  });

  it("prepends network-blocking preamble to the script", async () => {
    const proc = makeFakeProc();
    mockSpawn.mockReturnValue(proc);

    const promise = executePython("print(1)");

    proc.emit("close", 0);
    await promise;

    const writtenContent = mockWriteFileSync.mock.calls[0][1] as string;
    expect(writtenContent).toContain("_BlockedSocket");
    expect(writtenContent).toContain("Network access is disabled in sandbox");
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
});
