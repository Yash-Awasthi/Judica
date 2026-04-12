import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import os from "os";

/**
 * Python sandbox for executing untrusted user code.
 *
 * SECURITY NOTE (WF-4): This sandbox uses ulimit-based resource limits only.
 * It does NOT provide namespace isolation (e.g., Linux namespaces via unshare).
 * The process runs under the same UID as the server and shares the host
 * filesystem, PID namespace, and (partially blocked) network namespace.
 *
 * Network access is blocked at the Python level by monkey-patching socket.socket
 * rather than via kernel-level enforcement.  This is bypassable by ctypes or
 * compiled extensions.
 *
 * For production use with truly untrusted code, consider:
 *  - Running inside a gVisor / Firecracker micro-VM
 *  - Using Linux user namespaces (unshare --user --net --pid --mount) if
 *    CAP_SYS_ADMIN is available
 *  - Using a dedicated sandboxing service (e.g., Cloudflare Workers, AWS Lambda)
 */

export interface SandboxResult {
  output: string[];
  error: string | null;
  elapsedMs: number;
}

export async function executePython(code: string, timeout: number = 10000): Promise<SandboxResult> {
  const start = Date.now();
  const tmpFile = path.join(os.tmpdir(), `sandbox_${crypto.randomBytes(8).toString("hex")}.py`);

  try {
    // SEC-4: Disable network access at the Python level by overriding socket.socket
    // before user code runs. This prevents sandboxed code from making any network
    // connections. We use a Python-level approach rather than unshare --net because
    // the latter requires root/CAP_SYS_ADMIN privileges.
    // SEC-4: Comprehensive network isolation via socket monkey-patching.
    // Blocks connect, connect_ex, bind, sendto, and sendmsg on all socket instances.
    const networkBlockPreamble = [
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
    ].join("\n");
    fs.writeFileSync(tmpFile, networkBlockPreamble + code, "utf-8");

    return await new Promise<SandboxResult>((resolve) => {
      const stdout: string[] = [];
      const stderr: string[] = [];

      const proc = spawn("bash", [
        "-c",
        `ulimit -v 262144 -t 10 -f 1024 -u 32 -n 64; exec python3 "${tmpFile}"`,
      ], {
        timeout,
        env: {
          PATH: "/usr/local/bin:/usr/bin:/bin",
          HOME: "/tmp",
          LANG: process.env.LANG || "en_US.UTF-8",
          PYTHONDONTWRITEBYTECODE: "1",
          PYTHONPATH: "",
          PYTHONNOUSERSITE: "1",
        },
        stdio: ["pipe", "pipe", "pipe"],
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
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}
