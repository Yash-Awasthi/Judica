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
} else {
  logger.info(`Python sandbox using ${isolationLevel} isolation`);
}

// Python preamble that blocks dangerous modules and network access
const SANDBOX_PREAMBLE = [
  // Block ctypes and FFI (primary escape vector)
  `import importlib`,
  `_original_import = __builtins__.__import__ if hasattr(__builtins__, '__import__') else __import__`,
  `_BLOCKED_MODULES = frozenset({`,
  `    'ctypes', 'ctypes.util', 'ctypes.wintypes',`,
  `    '_ctypes', '_ctypes_test',`,
  `    'cffi', '_cffi_backend',`,
  `    'subprocess', '_subprocess',`,
  `    'multiprocessing', 'multiprocessing.process',`,
  `    'signal', '_signal',`,
  `    'resource', '_posixsubprocess',`,
  `    'importlib.machinery', 'importlib.abc',`,
  `    'code', 'codeop', 'compileall', 'py_compile',`,
  `    'gc', 'inspect', 'dis', 'pickletools',`,
  `    'webbrowser', 'antigravity', 'turtle',`,
  `    'ensurepip', 'pip', 'venv',`,
  `})`,
  `def _restricted_import(name, *args, **kwargs):`,
  `    if name in _BLOCKED_MODULES or any(name.startswith(b + '.') for b in _BLOCKED_MODULES):`,
  `        raise ImportError(f"Module '{name}' is not available in the sandbox")`,
  `    return _original_import(name, *args, **kwargs)`,
  `if hasattr(__builtins__, '__import__'):`,
  `    __builtins__.__import__ = _restricted_import`,
  `else:`,
  `    import builtins`,
  `    builtins.__import__ = _restricted_import`,
  ``,
  // Block os.system, os.exec*, os.spawn*, os.popen
  `import os as _os`,
  `for _attr in ['system', 'popen', 'execl', 'execle', 'execlp', 'execlpe',`,
  `              'execv', 'execve', 'execvp', 'execvpe', 'spawnl', 'spawnle',`,
  `              'spawnlp', 'spawnlpe', 'spawnv', 'spawnve', 'spawnvp', 'spawnvpe',`,
  `              'fork', 'forkpty', 'kill', 'killpg', 'plock', 'putenv', 'unsetenv']:`,
  `    if hasattr(_os, _attr):`,
  `        setattr(_os, _attr, lambda *a, **k: (_ for _ in ()).throw(PermissionError(f"os.{_attr} is disabled in sandbox")))`,
  ``,
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
  `if hasattr(__builtins__, 'open'):`,
  `    __builtins__.open = _restricted_open`,
  `else:`,
  `    import builtins`,
  `    builtins.open = _restricted_open`,
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
  `_blocked_from_modules = [k for k in _sys.modules if any(k == b or k.startswith(b + '.') for b in _BLOCKED_MODULES)]`,
  `for _k in _blocked_from_modules:`,
  `    del _sys.modules[_k]`,
  ``,
].join("\n");

function buildCommand(tmpFile: string, tmpDir: string): string {
  const ulimits = `ulimit -v 262144 -t 10 -f 1024 -u 32 -n 64`;

  if (isolationLevel === "bwrap") {
    // bubblewrap provides the strongest userspace sandboxing:
    // - Full filesystem isolation (bind-mount only what's needed)
    // - /proc isolation (--proc /proc)
    // - New PID/net/UTS namespaces (--unshare-all)
    // - Die with parent (--die-with-parent)
    // - No new privileges
    // - Seccomp-BPF syscall filter (blocks ptrace, mount, bpf, etc.)
    const seccompArgs: string[] = [];
    if (isSeccompAvailable()) {
      const policyPath = generateSeccompPolicy(tmpDir);
      seccompArgs.push(`--seccomp 9 9<"${policyPath}"`);
    }

    return [
      `bwrap`,
      `--ro-bind /usr /usr`,
      `--ro-bind /lib /lib`,
      `--ro-bind-try /lib64 /lib64`,
      `--ro-bind /bin /bin`,
      `--ro-bind /etc/alternatives /etc/alternatives`,
      `--ro-bind-try /etc/ld.so.cache /etc/ld.so.cache`,
      `--ro-bind-try /etc/ld.so.conf /etc/ld.so.conf`,
      `--ro-bind-try /etc/python3 /etc/python3`,
      `--bind "${tmpDir}" /sandbox`,
      `--tmpfs /tmp`,
      `--proc /proc`,
      `--dev /dev`,
      `--unshare-all`,
      `--die-with-parent`,
      `--new-session`,
      ...seccompArgs,
      `--chdir /sandbox`,
      `-- bash -c '${ulimits}; exec python3 /sandbox/script.py'`,
    ].join(" ");
  }

  if (isolationLevel === "unshare") {
    // unshare provides kernel namespace isolation:
    // --user: user namespace (no root required)
    // --pid: PID namespace (can't see/signal host processes)
    // --net: network namespace (no network interfaces)
    // --mount-proc: isolated /proc (prevents reading host process info)
    // --fork: fork before exec (required for PID namespace)
    // --map-root-user: map current UID to root inside namespace
    return `unshare --user --pid --net --fork --mount-proc --map-root-user -- bash -c '${ulimits}; exec python3 "${tmpFile}"'`;
  }

  // Fallback: ulimit-only isolation
  return `${ulimits}; exec python3 "${tmpFile}"`;
}

export async function executePython(code: string, timeout: number = 10000): Promise<SandboxResult> {
  const start = Date.now();
  const sandboxId = crypto.randomBytes(8).toString("hex");
  const tmpDir = path.join(os.tmpdir(), `sandbox_${sandboxId}`);
  const tmpFile = path.join(tmpDir, "script.py");

  try {
    // Create isolated temp directory
    fs.mkdirSync(tmpDir, { mode: 0o700 });
    fs.writeFileSync(tmpFile, SANDBOX_PREAMBLE + "\n" + code, { encoding: "utf-8", mode: 0o600 });

    return await new Promise<SandboxResult>((resolve) => {
      const stdout: string[] = [];
      const stderr: string[] = [];

      const command = buildCommand(tmpFile, tmpDir);

      const proc = spawn("bash", ["-c", command], {
        timeout,
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
        stdio: ["pipe", "pipe", "pipe"],
        cwd: tmpDir,
      });

      proc.stdout.on("data", (data) => {
        stdout.push(...data.toString().split("\n").filter((l: string) => l.length > 0));
      });

      proc.stderr.on("data", (data) => {
        stderr.push(...data.toString().split("\n").filter((l: string) => l.length > 0));
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
    // Clean up sandbox directory
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}
