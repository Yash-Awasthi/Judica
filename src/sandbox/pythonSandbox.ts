import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import os from "os";

export interface SandboxResult {
  output: string[];
  error: string | null;
  elapsedMs: number;
}

export async function executePython(code: string, timeout: number = 10000): Promise<SandboxResult> {
  const start = Date.now();
  const tmpFile = path.join(os.tmpdir(), `sandbox_${crypto.randomBytes(8).toString("hex")}.py`);

  try {
    fs.writeFileSync(tmpFile, code, "utf-8");

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
