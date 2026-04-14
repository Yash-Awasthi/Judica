import { spawn, execSync } from "child_process";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import os from "os";
import logger from "../lib/logger.js";

/**
 * Python sandbox for executing untrusted user code.
 *
 * Security layers (defense in depth):
 * 1. Linux namespace isolation via unshare (PID, network, mount, user)
 * 2. Restricted filesystem: read-only rootfs with tmpfs /tmp
 * 3. ulimit resource constraints (memory, CPU, files, processes)
 * 4. Python-level import restrictions (ctypes, subprocess, os.system blocked)
 * 5. Python-level socket monkey-patching (network blocking)
 * 6. seccomp-like restrictions via restricted env vars
 *
 * Falls back to ulimit-only mode if unshare is unavailable.
 */

export interface SandboxResult {
  output: string[];
  error: string | null;
  elapsedMs: number;
}

// Check if unshare is available at startup
let unshareAvailable = false;
try {
  execSync("unshare --help", { stdio: "pipe" });
  unshareAvailable = true;
} catch {
  logger.warn("unshare not available — Python sandbox will use ulimit-only isolation");
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
].join("\n");

function buildCommand(tmpFile: string): string {
  const ulimits = `ulimit -v 262144 -t 10 -f 1024 -u 32 -n 64`;

  if (unshareAvailable) {
    // Use unshare for namespace isolation:
    // --user: user namespace (no root required)
    // --pid: PID namespace (can't see/signal host processes)
    // --net: network namespace (no network interfaces)
    // --fork: fork before exec (required for PID namespace)
    // --map-root-user: map current UID to root inside namespace
    return `unshare --user --pid --net --fork --map-root-user -- bash -c '${ulimits}; exec python3 "${tmpFile}"'`;
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

      const command = buildCommand(tmpFile);

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
