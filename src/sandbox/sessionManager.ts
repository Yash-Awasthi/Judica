/**
 * Sandbox Session Manager — persistent interactive container sessions
 *
 * Provides a "small computer" experience: each user gets a persistent
 * Docker container with shell access, file system, git, and package management.
 *
 * Sessions persist across requests until explicitly destroyed or timed out.
 * Each session has:
 * - A persistent Docker volume for /workspace
 * - A running container with bash shell
 * - Git credentials (if provided)
 * - Installed packages (persist in volume)
 */

import logger from "../lib/logger.js";
import { AppError } from "../middleware/errorHandler.js";
import { randomBytes } from "crypto";
import type { DockerConstructor, DockerClient, DockerContainer } from "./dockerTypes.js";

const SANDBOX_IMAGE = process.env.SANDBOX_IMAGE ?? "aibyai-sandbox:latest";
const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const SESSION_MAX_LIFETIME_MS = 4 * 60 * 60 * 1000; // 4 hours
const MAX_OUTPUT_SIZE = 1024 * 1024; // 1MB per command
const COMMAND_TIMEOUT_MS = 120_000; // 2 minutes per command
const MAX_SESSIONS_PER_USER = 3;

export interface SandboxSession {
  id: string;
  userId: string;
  containerId: string;
  volumeName: string;
  createdAt: number;
  lastActivityAt: number;
  status: "running" | "stopped" | "destroyed";
  gitConfigured: boolean;
  metadata: Record<string, string>;
}

export interface ShellExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  cwd: string;
}

export interface FileInfo {
  name: string;
  path: string;
  type: "file" | "directory" | "symlink";
  size: number;
  modified: string;
  permissions: string;
}

// In-memory session registry (production would use Redis)
const sessions = new Map<string, SandboxSession>();

// Cleanup timer for idle sessions
const cleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    const idle = now - session.lastActivityAt > SESSION_IDLE_TIMEOUT_MS;
    const expired = now - session.createdAt > SESSION_MAX_LIFETIME_MS;
    if ((idle || expired) && session.status === "running") {
      logger.info({ sessionId: id, userId: session.userId, idle, expired }, "Auto-stopping idle/expired sandbox session");
      stopSession(id).catch(err => logger.warn({ err, sessionId: id }, "Failed to auto-stop session"));
    }
  }
}, 60_000);
cleanupInterval.unref();

async function loadDocker(): Promise<DockerConstructor | null> {
  try {
    const mod = (await import("dockerode")) as { default: DockerConstructor };
    return mod.default;
  } catch {
    return null;
  }
}

function generateSessionId(): string {
  return `sbx-${Date.now().toString(36)}-${randomBytes(6).toString("hex")}`;
}

/**
 * Create a new persistent sandbox session for a user.
 */
export async function createSession(
  userId: string,
  opts: {
    gitName?: string;
    gitEmail?: string;
    gitPat?: string;
    env?: Record<string, string>;
    metadata?: Record<string, string>;
  } = {},
): Promise<SandboxSession> {
  const Docker = await loadDocker();
  if (!Docker) {
    throw new AppError(503, "Docker is not available", "DOCKER_UNAVAILABLE");
  }

  // Check session limit per user
  const userSessions = [...sessions.values()].filter(
    s => s.userId === userId && s.status === "running",
  );
  if (userSessions.length >= MAX_SESSIONS_PER_USER) {
    throw new AppError(429, `Max ${MAX_SESSIONS_PER_USER} concurrent sandbox sessions per user`, "SANDBOX_SESSION_LIMIT");
  }

  const docker = new Docker();
  const sessionId = generateSessionId();
  const volumeName = `aibyai-sandbox-${userId}-${sessionId}`;

  // Create persistent volume
  await docker.createVolume({ Name: volumeName });

  // Build environment variables
  const containerEnv: string[] = [
    "HOME=/home/sandbox",
    "TMPDIR=/tmp",
    "LANG=en_US.UTF-8",
    "TERM=xterm-256color",
    `SESSION_ID=${sessionId}`,
    `USER_ID=${userId}`,
  ];

  if (opts.gitName) containerEnv.push(`GIT_AUTHOR_NAME=${opts.gitName}`, `GIT_COMMITTER_NAME=${opts.gitName}`);
  if (opts.gitEmail) containerEnv.push(`GIT_AUTHOR_EMAIL=${opts.gitEmail}`, `GIT_COMMITTER_EMAIL=${opts.gitEmail}`);
  if (opts.gitPat) {
    containerEnv.push(`GIT_PAT=${opts.gitPat}`);
    containerEnv.push("GIT_TERMINAL_PROMPT=0");
  }
  if (opts.env) {
    for (const [k, v] of Object.entries(opts.env)) {
      containerEnv.push(`${k}=${v}`);
    }
  }

  // Create container with persistent volume and keep it running
  const container = await docker.createContainer({
    Image: SANDBOX_IMAGE,
    Cmd: ["sleep", "infinity"], // Keep container alive
    WorkingDir: "/workspace",
    User: "sandbox",
    Env: containerEnv,
    Labels: {
      "aibyai.sandbox": "true",
      "aibyai.sessionId": sessionId,
      "aibyai.userId": userId,
    },
    HostConfig: {
      Memory: 1024 * 1024 * 1024, // 1GB
      CpuShares: 512,
      NetworkMode: "bridge", // Network access for git, pip, npm
      Binds: [`${volumeName}:/workspace`],
      SecurityOpt: ["no-new-privileges"],
      // Don't auto-remove — we manage lifecycle
    },
  });

  await container.start();

  // Configure git credentials inside container if PAT provided
  if (opts.gitPat) {
    await execInContainer(container, [
      "bash", "-c",
      `git config --global credential.helper '!f() { echo "username=x-access-token"; echo "password=$GIT_PAT"; }; f'`,
    ], 5000);
  }

  if (opts.gitName) {
    await execInContainer(container, ["git", "config", "--global", "user.name", opts.gitName], 5000);
  }
  if (opts.gitEmail) {
    await execInContainer(container, ["git", "config", "--global", "user.email", opts.gitEmail], 5000);
  }

  const session: SandboxSession = {
    id: sessionId,
    userId,
    containerId: container.id,
    volumeName,
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
    status: "running",
    gitConfigured: Boolean(opts.gitPat),
    metadata: opts.metadata ?? {},
  };

  sessions.set(sessionId, session);

  logger.info({ sessionId, userId, volumeName, containerId: container.id }, "Sandbox session created");

  return session;
}

/**
 * Execute a shell command inside an existing session.
 */
export async function execCommand(
  sessionId: string,
  command: string,
  opts: { cwd?: string; timeoutMs?: number; env?: Record<string, string> } = {},
): Promise<ShellExecResult> {
  const session = sessions.get(sessionId);
  if (!session || session.status !== "running") {
    throw new AppError(404, "Sandbox session not found or not running", "SANDBOX_SESSION_NOT_FOUND");
  }

  const Docker = await loadDocker();
  if (!Docker) throw new AppError(503, "Docker unavailable", "DOCKER_UNAVAILABLE");

  const docker = new Docker();
  const container = docker.getContainer(session.containerId);
  const timeoutMs = Math.min(opts.timeoutMs ?? COMMAND_TIMEOUT_MS, COMMAND_TIMEOUT_MS);

  session.lastActivityAt = Date.now();

  const start = Date.now();

  // Build the command — use bash -c for shell features (pipes, redirects, etc.)
  const execCmd = opts.cwd
    ? `cd ${shellEscape(opts.cwd)} && ${command}`
    : command;

  const envArr: string[] = [];
  if (opts.env) {
    for (const [k, v] of Object.entries(opts.env)) {
      envArr.push(`${k}=${v}`);
    }
  }

  const exec = await container.exec({
    Cmd: ["bash", "-c", execCmd],
    AttachStdout: true,
    AttachStderr: true,
    Env: envArr.length > 0 ? envArr : undefined,
    WorkingDir: opts.cwd ?? "/workspace",
  });

  const stream = await exec.start({ Detach: false, Tty: false });

  const { stdout, stderr } = await collectStream(docker, stream, timeoutMs, MAX_OUTPUT_SIZE);

  const inspectResult = await exec.inspect();
  const exitCode = inspectResult.ExitCode ?? 1;

  // Get current working directory
  const cwdResult = await execInContainer(container, ["pwd"], 5000);
  const cwd = cwdResult.trim() || "/workspace";

  return {
    stdout,
    stderr,
    exitCode,
    durationMs: Date.now() - start,
    cwd,
  };
}

/**
 * List files in a directory inside the session.
 */
export async function listFiles(sessionId: string, dirPath: string = "/workspace"): Promise<FileInfo[]> {
  const result = await execCommand(sessionId, `find ${shellEscape(dirPath)} -maxdepth 1 -not -path ${shellEscape(dirPath)} -printf '%T@ %y %s %m %p\\n' 2>/dev/null | sort -rn`);

  if (result.exitCode !== 0) {
    throw new AppError(400, `Failed to list files: ${result.stderr}`, "SANDBOX_FILE_ERROR");
  }

  return result.stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map(line => {
      const parts = line.split(" ");
      const timestamp = parts[0];
      const type = parts[1] === "d" ? "directory" as const : parts[1] === "l" ? "symlink" as const : "file" as const;
      const size = parseInt(parts[2], 10);
      const permissions = parts[3];
      const path = parts.slice(4).join(" ");
      const name = path.split("/").pop() ?? path;
      return {
        name,
        path,
        type,
        size,
        modified: new Date(parseFloat(timestamp) * 1000).toISOString(),
        permissions,
      };
    });
}

/**
 * Read a file from the session.
 */
export async function readFile(sessionId: string, filePath: string): Promise<string> {
  const result = await execCommand(sessionId, `cat ${shellEscape(filePath)}`);
  if (result.exitCode !== 0) {
    throw new AppError(404, `File not found or unreadable: ${result.stderr}`, "SANDBOX_FILE_NOT_FOUND");
  }
  return result.stdout;
}

/**
 * Write content to a file in the session.
 */
export async function writeFile(sessionId: string, filePath: string, content: string): Promise<void> {
  // Use base64 encoding to safely transfer arbitrary content
  const b64 = Buffer.from(content).toString("base64");
  const result = await execCommand(sessionId, `echo '${b64}' | base64 -d > ${shellEscape(filePath)}`);
  if (result.exitCode !== 0) {
    throw new AppError(400, `Failed to write file: ${result.stderr}`, "SANDBOX_FILE_ERROR");
  }
}

/**
 * Get system info from the session container.
 */
export async function getSystemInfo(sessionId: string): Promise<Record<string, unknown>> {
  const [diskResult, memResult, unameResult, uptimeResult] = await Promise.all([
    execCommand(sessionId, "df -h /workspace | tail -1"),
    execCommand(sessionId, "free -h 2>/dev/null || echo 'N/A'"),
    execCommand(sessionId, "uname -a"),
    execCommand(sessionId, "uptime -p 2>/dev/null || echo 'N/A'"),
  ]);

  return {
    disk: diskResult.stdout.trim(),
    memory: memResult.stdout.trim(),
    uname: unameResult.stdout.trim(),
    uptime: uptimeResult.stdout.trim(),
  };
}

/**
 * Stop a session (container stays, can be resumed).
 */
export async function stopSession(sessionId: string): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) throw new AppError(404, "Session not found", "SANDBOX_SESSION_NOT_FOUND");

  const Docker = await loadDocker();
  if (!Docker) return;

  const docker = new Docker();
  try {
    const container = docker.getContainer(session.containerId);
    await container.stop({ t: 5 });
    session.status = "stopped";
    logger.info({ sessionId }, "Sandbox session stopped");
  } catch {
    // Container may already be stopped
    session.status = "stopped";
  }
}

/**
 * Resume a stopped session.
 */
export async function resumeSession(sessionId: string): Promise<SandboxSession> {
  const session = sessions.get(sessionId);
  if (!session) throw new AppError(404, "Session not found", "SANDBOX_SESSION_NOT_FOUND");
  if (session.status === "destroyed") throw new AppError(410, "Session has been destroyed", "SANDBOX_SESSION_DESTROYED");

  if (session.status === "running") return session;

  const Docker = await loadDocker();
  if (!Docker) throw new AppError(503, "Docker unavailable", "DOCKER_UNAVAILABLE");

  const docker = new Docker();
  const container = docker.getContainer(session.containerId);
  await container.start();
  session.status = "running";
  session.lastActivityAt = Date.now();

  logger.info({ sessionId }, "Sandbox session resumed");
  return session;
}

/**
 * Destroy a session — stops container and removes volume.
 */
export async function destroySession(sessionId: string): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) throw new AppError(404, "Session not found", "SANDBOX_SESSION_NOT_FOUND");

  const Docker = await loadDocker();
  if (!Docker) return;

  const docker = new Docker();

  // Stop and remove container
  try {
    const container = docker.getContainer(session.containerId);
    try { await container.stop({ t: 2 }); } catch { /* already stopped */ }
    await container.remove({ force: true });
  } catch (err) {
    logger.warn({ err, sessionId }, "Error removing sandbox container");
  }

  // Remove volume
  try {
    await docker.getVolume(session.volumeName).remove();
  } catch {
    // Volume may not exist
  }

  session.status = "destroyed";
  sessions.delete(sessionId);

  logger.info({ sessionId, userId: session.userId }, "Sandbox session destroyed");
}

/**
 * List all sessions for a user.
 */
export function listSessions(userId: string): SandboxSession[] {
  return [...sessions.values()].filter(s => s.userId === userId);
}

/**
 * Get a specific session.
 */
export function getSession(sessionId: string): SandboxSession | undefined {
  return sessions.get(sessionId);
}

// ── Helpers ──

function shellEscape(str: string): string {
  return "'" + str.replace(/'/g, "'\\''") + "'";
}

async function execInContainer(container: DockerContainer, cmd: string[], timeoutMs: number): Promise<string> {
  const exec = await container.exec({
    Cmd: cmd,
    AttachStdout: true,
    AttachStderr: true,
  });
  const stream = await exec.start({ Detach: false, Tty: false });

  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => {
      stream.destroy?.();
      reject(new Error("exec timeout"));
    }, timeoutMs);

    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("end", () => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks).toString("utf-8"));
    });
    stream.on("error", (err: Error) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function collectStream(
  docker: DockerClient,
  stream: NodeJS.ReadableStream,
  timeoutMs: number,
  maxSize: number,
): Promise<{ stdout: string; stderr: string }> {
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  let totalSize = 0;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      stream.destroy?.();
      reject(new AppError(408, "Command timed out", "SANDBOX_TIMEOUT"));
    }, timeoutMs);

    docker.modem.demuxStream(
      stream,
      {
        write(chunk: Buffer) {
          totalSize += chunk.length;
          if (totalSize <= maxSize) stdoutChunks.push(chunk);
        },
      },
      {
        write(chunk: Buffer) {
          totalSize += chunk.length;
          if (totalSize <= maxSize) stderrChunks.push(chunk);
        },
      },
    );

    stream.on("end", () => {
      clearTimeout(timer);
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
        stderr: Buffer.concat(stderrChunks).toString("utf-8"),
      });
    });

    stream.on("error", (err: Error) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}
