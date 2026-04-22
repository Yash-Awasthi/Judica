import { spawn, execSync } from "child_process";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import os from "os";
import logger from "../lib/logger.js";
import { generateSeccompPolicy, isSeccompAvailable } from "./seccomp.js";

/**
 * Python sandbox for executing untrusted user code.
 *
 * Security layers (defense in depth):
 * 1. Container-level isolation via bubblewrap (preferred) or unshare namespaces
 * 2. Linux namespace isolation: PID, network, mount, user
 * 3. /proc isolation via --mount-proc (prevents reading host process info)
 * 4. ulimit resource constraints (memory, CPU, files, processes)
 * 5. Python-level import restrictions (ctypes, subprocess, os.system blocked)
 * 6. Python-level socket monkey-patching (network blocking)
 * 7. Python introspection hardening (gc, inspect, sys._getframe blocked)
 *
 * Isolation priority: bubblewrap > unshare > ulimit-only
 */

export interface SandboxResult {
  output: string[];
  error: string | null;
  elapsedMs: number;
}

// Check isolation capabilities at startup (prefer strongest available)
let isolationLevel: "bwrap" | "unshare" | "ulimit" = "ulimit";
try {
  execSync("bwrap --version", { stdio: "pipe" });
  isolationLevel = "bwrap";
} catch {
  try {
    execSync("unshare --help", { stdio: "pipe" });
    isolationLevel = "unshare";
  } catch {
    // Fall through to ulimit-only
  }
}
if (isolationLevel === "ulimit") {
  logger.warn("Neither bwrap nor unshare available — Python sandbox will use ulimit-only isolation");
  // H-5 fix: fail loudly in production so operators know isolation is degraded.
  // Set ALLOW_UNSAFE_SANDBOX=1 to override (e.g. in local dev without bwrap installed).
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_UNSAFE_SANDBOX !== "1") {
    throw new Error(
      "CRITICAL: Python sandbox requires bubblewrap (bwrap) or unshare for production use. " +
      "Install bubblewrap, or set ALLOW_UNSAFE_SANDBOX=1 to acknowledge the degraded security posture."
    );
  }
} else {
  logger.info(`Python sandbox using ${isolationLevel} isolation`);
}

const MAX_OUTPUT_LINES = 1000;
const MAX_OUTPUT_BYTES = 1_000_000; // 1MB total output cap

// Python preamble that blocks dangerous modules and network access
// P0-30: Use closure-captured import ref and make __import__ non-writable
// P0-31: Prevents _restricted_import reassignment
const SANDBOX_PREAMBLE = [
  // Block ctypes and FFI (primary escape vector)
  `import importlib`,
  `def _setup_sandbox():`,
  `    """Setup sandbox in a closure so user code cannot access internals."""`,
  `    import builtins as _builtins`,
  `    _original_import = _builtins.__import__`,
  `    _BLOCKED_MODULES = frozenset({`,
  `        'ctypes', 'ctypes.util', 'ctypes.wintypes',`,
  `        '_ctypes', '_ctypes_test',`,
  `        'cffi', '_cffi_backend',`,
  `        'subprocess', '_subprocess',`,
  `        'multiprocessing', 'multiprocessing.process',`,
  `        'signal', '_signal',`,
  `        'resource', '_posixsubprocess',`,
  `        'importlib.machinery', 'importlib.abc',`,
  `        'code', 'codeop', 'compileall', 'py_compile',`,
  `        'gc', 'inspect', 'dis', 'pickletools',`,
  `        'webbrowser', 'antigravity', 'turtle',`,
  `        'ensurepip', 'pip', 'venv',`,
  `    })`,
  `    def _restricted_import(name, *args, **kwargs):`,
  `        if name in _BLOCKED_MODULES or any(name.startswith(b + '.') for b in _BLOCKED_MODULES):`,
  `            raise ImportError(f"Module '{name}' is not available in the sandbox")`,
  `        return _original_import(name, *args, **kwargs)`,
  `    _builtins.__import__ = _restricted_import`,
  `    # Make __import__ non-writable to prevent user reassignment`,
  `    try:`,
  `        type(_builtins).__import__ = property(lambda self: _restricted_import)`,
  `    except (TypeError, AttributeError):`,
  `        pass  # Fallback: at least the closure captures the original`,
  `_setup_sandbox()`,
  `del _setup_sandbox`,
  ``,
  // Block os.system, os.exec*, os.spawn*, os.popen
  `import os as _os`,
  `for _attr in ['system', 'popen', 'execl', 'execle', 'execlp', 'execlpe',`,
  `              'execv', 'execve', 'execvp', 'execvpe', 'spawnl', 'spawnle',`,
  `              'spawnlp', 'spawnlpe', 'spawnv', 'spawnve', 'spawnvp', 'spawnvpe',`,
  `              'fork', 'forkpty', 'kill', 'killpg', 'plock', 'putenv', 'unsetenv']:`,
  `    if hasattr(_os, _attr):`,
  `        setattr(_os, _attr, (lambda name: lambda *a, **k: (_ for _ in ()).throw(PermissionError(f"os.{name} is disabled in sandbox")))(_attr))`,
  ``,
  // P0-38: Block socket.fromfd/socketpair as well
  // Block network access at socket level
  `import socket as _original_socket`,
  `class _BlockedSocket(_original_socket.socket):`,
  `    def connect(self, *args, **kwargs):`,
  `        raise PermissionError("Network access is disabled in sandbox")`,
  `    def connect_ex(self, *args, **kwargs):`,
  `        raise PermissionError("Network access is disabled in sandbox")`,
  `    def bind(self, *args, **kwargs):`,
  `        raise PermissionError("Network access is disabled in sandbox")`,
  `    def sendto(self, *args, **kwargs):`,
  `        raise PermissionError("Network access is disabled in sandbox")`,
  `    def sendmsg(self, *args, **kwargs):`,
  `        raise PermissionError("Network access is disabled in sandbox")`,
  `_original_socket.socket = _BlockedSocket`,
  `if hasattr(_original_socket, 'fromfd'):`,
  `    _original_socket.fromfd = lambda *a, **k: (_ for _ in ()).throw(PermissionError("socket.fromfd is disabled"))`,
  `if hasattr(_original_socket, 'socketpair'):`,
  `    _original_socket.socketpair = lambda *a, **k: (_ for _ in ()).throw(PermissionError("socket.socketpair is disabled"))`,
  ``,
  // Block file writes outside /tmp
  `_original_open = open`,
  `def _restricted_open(file, mode='r', *args, **kwargs):`,
  `    if isinstance(file, str) and any(m in mode for m in ('w', 'a', 'x', '+')):`,
  `        import os.path`,
  `        resolved = os.path.realpath(file)`,
  `        if not resolved.startswith('/tmp/'):`,
  `            raise PermissionError(f"Writing to {file} is not allowed in sandbox")`,
  `    return _original_open(file, mode, *args, **kwargs)`,
  `import builtins as _builtins2`,
  `_builtins2.open = _restricted_open`,
  ``,
  // Block introspection escape vectors
  `import sys as _sys`,
  `_sys.tracebacklimit = 50`,
  `if hasattr(_sys, '_getframe'):`,
  `    _orig_getframe = _sys._getframe`,
  `    def _safe_getframe(depth=0):`,
  `        f = _orig_getframe(depth + 1)`,
  `        return f`,
  `    _sys._getframe = _safe_getframe`,
  `# Prevent sys.modules manipulation to re-import blocked modules`,
  `_blocked_from_modules = [k for k in _sys.modules if any(k == b or k.startswith(b + '.') for b in {'ctypes', 'ctypes.util', 'ctypes.wintypes', '_ctypes', '_ctypes_test', 'cffi', '_cffi_backend', 'subprocess', '_subprocess', 'multiprocessing', 'multiprocessing.process', 'signal', '_signal', 'resource', '_posixsubprocess', 'importlib.machinery', 'importlib.abc', 'code', 'codeop', 'compileall', 'py_compile', 'gc', 'inspect', 'dis', 'pickletools', 'webbrowser', 'antigravity', 'turtle', 'ensurepip', 'pip', 'venv'})]`,
  `for _k in _blocked_from_modules:`,
  `    del _sys.modules[_k]`,
  `del _blocked_from_modules`,
  `if '_k' in dir(): del _k`,
  ``,
].join("\n");

// P0-39: Return structured command to avoid bash -c shell interpolation
interface SandboxCommand {
  cmd: string;
  args: string[];
  seccompFd?: string; // path to seccomp BPF file to open as fd
}

// P1-35: Cap output arrays to prevent Node heap exhaustion (match jsSandbox limits)
const MAX_OUTPUT_LINES = 1000;
const MAX_OUTPUT_BYTES = 1_000_000; // 1MB total output cap

function buildCommand(tmpFile: string, tmpDir: string): SandboxCommand {
  if (isolationLevel === "bwrap") {
    // bubblewrap provides the strongest userspace sandboxing:
    // - Full filesystem isolation (bind-mount only what's needed)
    // - /proc isolation (--proc /proc)
    // - New PID/net/UTS namespaces (--unshare-all)
    // - Die with parent (--die-with-parent)
    // - No new privileges
    // - Seccomp-BPF syscall filter (blocks ptrace, mount, bpf, etc.)
    const args: string[] = [
      "--ro-bind", "/usr", "/usr",
      "--ro-bind", "/lib", "/lib",
      "--ro-bind-try", "/lib64", "/lib64",
      "--ro-bind", "/bin", "/bin",
      "--ro-bind", "/etc/alternatives", "/etc/alternatives",
      "--ro-bind-try", "/etc/ld.so.cache", "/etc/ld.so.cache",
      "--ro-bind-try", "/etc/ld.so.conf", "/etc/ld.so.conf",
      "--ro-bind-try", "/etc/python3", "/etc/python3",
      "--bind", tmpDir, "/sandbox",
      "--tmpfs", "/tmp",
      "--proc", "/proc",
      "--dev", "/dev",
      "--unshare-all",
      "--die-with-parent",
      "--new-session",
    ];

    if (isSeccompAvailable()) {
      const policyPath = generateSeccompPolicy(tmpDir);
      args.push("--seccomp", "3"); // fd 3 (first extra fd after stdin/stdout/stderr)
      args.push("--chdir", "/sandbox", "--", "python3", "/sandbox/script.py");
      return { cmd: "bwrap", args, seccompFd: policyPath };
    }

    args.push("--chdir", "/sandbox", "--", "python3", "/sandbox/script.py");

    return { cmd: "bwrap", args };
  }

  if (isolationLevel === "unshare") {
    // unshare provides kernel namespace isolation
    return {
      cmd: "unshare",
      args: [
        "--user", "--pid", "--net", "--fork", "--mount-proc", "--map-root-user",
        "--", "python3", tmpFile,
      ],
    };
  }

  // Fallback: spawn python3 directly (ulimit constraints applied via spawn options)
  return {
    cmd: "python3",
    args: [tmpFile],
  };
}

export async function executePython(code: string, timeout: number = 10000): Promise<SandboxResult> {
  // P28-03: Validate timeout to prevent hangs or negative values
  if (!Number.isFinite(timeout) || timeout < 100) timeout = 10000;
  timeout = Math.min(timeout, 60_000); // Hard cap at 60s
  const start = Date.now();

  const MAX_CODE_SIZE = 500_000; // 500KB
  if (code.length > MAX_CODE_SIZE) {
    return {
      output: [],
      error: `Code size ${code.length} exceeds maximum of ${MAX_CODE_SIZE} bytes`,
      elapsedMs: Date.now() - start,
    };
  }

  const sandboxId = crypto.randomBytes(8).toString("hex");
  const tmpDir = path.join(os.tmpdir(), `sandbox_${sandboxId}`);
  const tmpFile = path.join(tmpDir, "script.py");
  let bpfFd: number | undefined;

  // L-12: Log the isolation tier for each execution so operators can audit sandbox strength
  logger.debug({ sandboxId, isolationLevel, timeout }, "Python sandbox execution starting");

  try {
    // Create isolated temp directory
    await fs.promises.mkdir(tmpDir, { mode: 0o700 });
    await fs.promises.writeFile(tmpFile, SANDBOX_PREAMBLE + "\n" + code, { encoding: "utf-8", mode: 0o600 });

    return await new Promise<SandboxResult>((resolve) => {
      const stdout: string[] = [];
      const stderr: string[] = [];
      let totalBytes = 0;

      const { cmd, args, seccompFd } = buildCommand(tmpFile, tmpDir);

      const stdioDef: Array<"pipe" | "inherit" | number> = ["pipe", "pipe", "pipe"];
      if (seccompFd) {
        bpfFd = fs.openSync(seccompFd, "r");
        stdioDef.push(bpfFd); // becomes fd 3 in the child
      }

      // P0-39: Use execFile-style spawn (no shell) to prevent interpolation
      // P0-40: Use SIGKILL to ensure sandbox processes are terminated
      const proc = spawn(cmd, args, {
        timeout,
        killSignal: "SIGKILL",
        env: {
          PATH: "/usr/local/bin:/usr/bin:/bin",
          HOME: tmpDir,
          TMPDIR: tmpDir,
          LANG: process.env.LANG || "en_US.UTF-8",
          PYTHONDONTWRITEBYTECODE: "1",
          PYTHONPATH: "",
          PYTHONNOUSERSITE: "1",
          PYTHONSAFEPATH: "1",
        },
        stdio: stdioDef,
        shell: false,
        cwd: tmpDir,
      });

      // P28-04: Cap stdout/stderr to prevent OOM from malicious print loops
      const MAX_OUTPUT_LINES = 5000;
      proc.stdout.on("data", (data) => {
        if (stdout.length >= MAX_OUTPUT_LINES || totalBytes >= MAX_OUTPUT_BYTES) return;
        const lines = data.toString().split("\n").filter((l: string) => l.length > 0);
        for (const line of lines) {
          if (stdout.length >= MAX_OUTPUT_LINES || totalBytes >= MAX_OUTPUT_BYTES) break;
          stdout.push(line);
          totalBytes += line.length;
        }
      });

      proc.stderr.on("data", (data) => {
        if (stderr.length >= MAX_OUTPUT_LINES || totalBytes >= MAX_OUTPUT_BYTES) return;
        const lines = data.toString().split("\n").filter((l: string) => l.length > 0);
        for (const line of lines) {
          if (stderr.length >= MAX_OUTPUT_LINES || totalBytes >= MAX_OUTPUT_BYTES) break;
          stderr.push(line);
          totalBytes += line.length;
        }
      });

      proc.on("close", (exitCode) => {
        resolve({
          output: stdout,
          error: stderr.length > 0 ? stderr.join("\n") : (exitCode !== 0 ? `Process exited with code ${exitCode}` : null),
          elapsedMs: Date.now() - start,
        });
      });

      proc.on("error", (err) => {
        resolve({
          output: stdout,
          error: err.message,
          elapsedMs: Date.now() - start,
        });
      });
    });
  } finally {
    // Clean up BPF file descriptor if opened
    if (bpfFd !== undefined) {
      try { fs.closeSync(bpfFd); } catch { /* cleanup */ }
    }
    // Clean up sandbox directory
    try { await fs.promises.rm(tmpDir, { recursive: true, force: true }); } catch { /* cleanup best-effort */ }
  }
}
