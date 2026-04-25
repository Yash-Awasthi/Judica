import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";

// Use vi.hoisted so these fns exist before the hoisted vi.mock factories run.
const { mockSpawn, mockExecSync, mockMkdtemp, mockWriteFile, mockRm } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
  // Make execSync throw for bwrap/unshare so isolationLevel defaults to "ulimit" (python3)
  mockExecSync: vi.fn().mockImplementation((cmd: string) => {
    if (cmd === "bwrap --version" || cmd === "unshare --help") throw new Error("not found");
    return "";
  }),
  mockMkdtemp: vi.fn().mockResolvedValue("/tmp/sandbox_abcdef0123456789"),
  mockWriteFile: vi.fn().mockResolvedValue(undefined),
  mockRm: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("child_process", () => ({
  spawn: mockSpawn,
  execSync: mockExecSync,
}));

vi.mock("fs", () => ({
  default: {
    promises: {
      mkdtemp: mockMkdtemp,
      writeFile: mockWriteFile,
      rm: mockRm,
    },
    openSync: vi.fn(() => 3),
    closeSync: vi.fn(),
  },
  promises: {
    mkdtemp: mockMkdtemp,
    writeFile: mockWriteFile,
    rm: mockRm,
  },
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

vi.mock("../../src/sandbox/seccomp.js", () => ({
  generateSeccompPolicy: vi.fn(),
  isSeccompAvailable: vi.fn(() => false),
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

/** Flush pending microtasks so async mkdtemp/writeFile resolve before we emit on proc. */
function flush() {
  return new Promise<void>((r) => setTimeout(r, 0));
}

describe("pythonSandbox – executePython", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMkdtemp.mockResolvedValue("/tmp/sandbox_abcdef0123456789");
    mockWriteFile.mockResolvedValue(undefined);
    mockRm.mockResolvedValue(undefined);
  });

  it("returns stdout output on successful execution", async () => {
    const proc = makeFakeProc();
    mockSpawn.mockReturnValue(proc);

    const promise = executePython('print("hello")');
    await flush();

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
    await flush();

    proc.stderr.emit("data", Buffer.from("ModuleNotFoundError: No module named 'nonexistent'\n"));
    proc.emit("close", 1);

    const result = await promise;

    expect(result.error).toContain("ModuleNotFoundError");
  });

  it("returns error when process exits with non-zero code and no stderr", async () => {
    const proc = makeFakeProc();
    mockSpawn.mockReturnValue(proc);

    const promise = executePython("import sys; sys.exit(1)");
    await flush();

    proc.emit("close", 1);

    const result = await promise;

    expect(result.error).toContain("Process exited with code 1");
  });

  it("handles spawn error (e.g. python3 not found)", async () => {
    const proc = makeFakeProc();
    mockSpawn.mockReturnValue(proc);

    const promise = executePython("print(1)");
    await flush();

    proc.emit("error", new Error("spawn python3 ENOENT"));

    const result = await promise;

    expect(result.error).toContain("ENOENT");
  });

  it("creates a sandbox directory, writes a temp file, and cleans up in finally", async () => {
    const proc = makeFakeProc();
    mockSpawn.mockReturnValue(proc);

    const promise = executePython("x = 1");
    await flush();

    proc.emit("close", 0);
    await promise;

    // Should create a sandbox directory via mkdtemp
    expect(mockMkdtemp).toHaveBeenCalledTimes(1);
    const mkdtempArg = mockMkdtemp.mock.calls[0][0] as string;
    expect(mkdtempArg).toMatch(/sandbox_/);

    // Should write the script file inside the sandbox directory
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    const writtenPath = mockWriteFile.mock.calls[0][0] as string;
    expect(writtenPath).toMatch(/sandbox_.*[/\\]script\.py$/);

    // Should clean up with rm (recursive directory removal)
    expect(mockRm).toHaveBeenCalledTimes(1);
    expect(mockRm.mock.calls[0][0]).toBe("/tmp/sandbox_abcdef0123456789");
  });

  it("cleans up sandbox directory even when execution errors", async () => {
    const proc = makeFakeProc();
    mockSpawn.mockReturnValue(proc);

    const promise = executePython("bad code");
    await flush();

    proc.emit("error", new Error("spawn failed"));
    await promise;

    expect(mockRm).toHaveBeenCalledTimes(1);
  });

  it("prepends sandbox preamble with import restrictions and network blocking", async () => {
    const proc = makeFakeProc();
    mockSpawn.mockReturnValue(proc);

    const promise = executePython("print(1)");
    await flush();

    proc.emit("close", 0);
    await promise;

    const writtenContent = mockWriteFile.mock.calls[0][1] as string;
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

  it("spawns python3 with timeout constraints", async () => {
    const proc = makeFakeProc();
    mockSpawn.mockReturnValue(proc);

    const promise = executePython("pass");
    await flush();

    proc.emit("close", 0);
    await promise;

    const [cmd, args, opts] = mockSpawn.mock.calls[0];
    expect(cmd).toBe("python3");
    expect(args[0]).toContain("sandbox_");
    expect(opts.timeout).toBe(10000);
    expect(opts.killSignal).toBe("SIGKILL");
  });

  it("sets restricted environment variables including PYTHONSAFEPATH", async () => {
    const proc = makeFakeProc();
    mockSpawn.mockReturnValue(proc);

    const promise = executePython("pass");
    await flush();

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
    await flush();

    proc.emit("close", 0);
    await promise;

    const spawnOptions = mockSpawn.mock.calls[0][2];
    expect(spawnOptions.cwd).toMatch(/sandbox_/);
  });
});
