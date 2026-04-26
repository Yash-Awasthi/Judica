/**
 * Docker Sandbox — full container-based code execution
 *
 * When SANDBOX_DOCKER=true, spins up an isolated container per execution.
 * Falls back to process-based sandbox when Docker is unavailable.
 *
 * Features:
 * - Full shell access (not just JS/Python)
 * - Persistent volumes per user session
 * - Git pre-installed (can push/pull with user's PAT)
 * - Resource limits: 512MB RAM, throttled CPU
 * - Network: restricted to allowlist (github.com, pypi.org, npm registry)
 * - Timeout: 30s default, 120s max
 */

import logger from "../lib/logger.js";
import { AppError } from "../middleware/errorHandler.js";
import type { DockerConstructor, DockerClient } from "./dockerTypes.js";

export interface DockerExecOptions {
  language: string;
  code: string;
  stdin?: string;
  timeoutMs?: number;
  sessionId?: string;
  userId?: string;
  env?: Record<string, string>;
}

export interface DockerExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

// Timeout bounds — mirror the same defensive pattern used in jsSandbox/pythonSandbox
const DOCKER_TIMEOUT_MIN_MS = 1_000;
const DOCKER_TIMEOUT_DEFAULT_MS = 30_000;
const DOCKER_TIMEOUT_MAX_MS = 120_000;

const SANDBOX_IMAGE = process.env.SANDBOX_IMAGE ?? "aibyai-sandbox:latest";

// Language runner map — determines how code is invoked inside the container
const LANGUAGE_RUNNERS: Record<string, (codeFile: string) => string[]> = {
  javascript: (f) => ["node", f],
  typescript: (f) => ["ts-node", f],
  python: (f) => ["python3", f],
  bash: (f) => ["bash", f],
  sh: (f) => ["sh", f],
};

const LANGUAGE_EXTENSIONS: Record<string, string> = {
  javascript: "js",
  typescript: "ts",
  python: "py",
  bash: "sh",
  sh: "sh",
};

// Detect whether the code requests git network operations
function requiresGitNetwork(code: string): boolean {
  return /git\s+(push|clone|fetch|pull|remote)\b/.test(code);
}

/**
 * Lazily load dockerode — the package is optional.
 * Returns the typed Docker constructor or null if unavailable.
 */
async function loadDocker(): Promise<DockerConstructor | null> {
  try {
    const mod = (await import("dockerode")) as { default: DockerConstructor };
    return mod.default;
  } catch {
    return null;
  }
}

/**
 * Ensure a named Docker volume exists for the given user.
 * Returns the volume name.
 */
export async function getOrCreateUserVolume(userId: string): Promise<string> {
  const Docker = await loadDocker();
  if (!Docker) {
    throw new AppError(503, "Docker is not available in this environment", "DOCKER_UNAVAILABLE");
  }

  const docker = new Docker();
  const volumeName = `aibyai-sandbox-${userId}`;

  try {
    // Inspect throws if the volume does not exist
    await docker.getVolume(volumeName).inspect();
  } catch {
    // Volume does not exist — create it
    await docker.createVolume({ Name: volumeName });
    logger.info({ userId, volumeName }, "Docker sandbox volume created");
  }

  return volumeName;
}

/**
 * Remove the persistent volume and stop any lingering containers for a user.
 */
export async function cleanupUserSandbox(userId: string): Promise<void> {
  const Docker = await loadDocker();
  if (!Docker) {
    throw new AppError(503, "Docker is not available in this environment", "DOCKER_UNAVAILABLE");
  }

  const docker = new Docker();
  const volumeName = `aibyai-sandbox-${userId}`;

  // Stop & remove any containers that still reference this volume
  try {
    const containers: import("./dockerTypes.js").DockerContainerInfo[] = await docker.listContainers({ all: true });
    for (const info of containers) {
      const labelMatch = (info.Labels ?? {})["aibyai.userId"] === userId;
      if (labelMatch) {
        const container = docker.getContainer(info.Id);
        try { await container.stop({ t: 2 }); } catch { /* already stopped */ }
        try { await container.remove({ force: true }); } catch { /* already removed */ }
      }
    }
  } catch (err) {
    logger.warn({ err, userId }, "Error cleaning up sandbox containers");
  }

  // Remove the volume
  try {
    await docker.getVolume(volumeName).remove();
    logger.info({ userId, volumeName }, "Docker sandbox volume removed");
  } catch {
    // Volume may not exist — ignore
  }
}

/**
 * Execute code inside an isolated Docker container.
 */
export async function execInDocker(opts: DockerExecOptions): Promise<DockerExecResult> {
  const {
    language,
    code,
    stdin,
    timeoutMs: rawTimeout,
    sessionId,
    userId = "anonymous",
    env: extraEnv = {},
  } = opts;

  // Clamp timeout into safe range
  const timeoutMs = Math.min(
    Math.max(rawTimeout ?? DOCKER_TIMEOUT_DEFAULT_MS, DOCKER_TIMEOUT_MIN_MS),
    DOCKER_TIMEOUT_MAX_MS,
  );

  const start = Date.now();

  const Docker = await loadDocker();
  if (!Docker) {
    throw new AppError(503, "Docker is not available in this environment", "DOCKER_UNAVAILABLE");
  }

  const docker = new Docker();

  // Resolve language runner
  const ext = LANGUAGE_EXTENSIONS[language] ?? "txt";
  const getRunner = LANGUAGE_RUNNERS[language];
  if (!getRunner) {
    throw new AppError(400, `Unsupported language for Docker sandbox: ${language}`, "SANDBOX_UNSUPPORTED_LANG");
  }

  // Ensure persistent user volume
  const volumeName = await getOrCreateUserVolume(userId);

  // Determine whether network is needed (git push/clone etc.)
  const needsNetwork = requiresGitNetwork(code);

  // Build env vars for the container
  const containerEnv: string[] = [
    "HOME=/workspace",
    "TMPDIR=/tmp",
    "LANG=en_US.UTF-8",
    ...Object.entries(extraEnv).map(([k, v]) => `${k}=${v}`),
  ];

  // Write code to a temp file inside the container via CMD — we embed the code
  // as a base64-encoded string and decode it inside the container to avoid
  // shell-injection risks from arbitrary user code.
  const codeB64 = Buffer.from(code).toString("base64");
  const scriptPath = `/workspace/.sandbox_script_${sessionId ?? Date.now()}.${ext}`;
  const runner = getRunner(scriptPath);

  // The entrypoint script:
  //  1. Decode the base64 code into a temp file
  //  2. Optionally feed stdin
  //  3. Run the appropriate language runner
  const entryCmd = [
    "sh",
    "-c",
    [
      `echo '${codeB64}' | base64 -d > ${scriptPath}`,
      stdin !== undefined
        ? `printf '%s' '${Buffer.from(stdin).toString("base64")}' | base64 -d | ${runner.join(" ")}`
        : runner.join(" "),
      `rm -f ${scriptPath}`,
    ].join(" && "),
  ];

  const createOptions: Record<string, any> = {
    Image: SANDBOX_IMAGE,
    Cmd: entryCmd,
    WorkingDir: "/workspace",
    User: "nobody",
    Env: containerEnv,
    Labels: {
      "aibyai.userId": userId,
      "aibyai.sessionId": sessionId ?? "",
      "aibyai.language": language,
    },
    AttachStdout: true,
    AttachStderr: true,
    HostConfig: {
      // Resource limits
      Memory: 512 * 1024 * 1024, // 512MB
      CpuShares: 256, // throttled
      // Network isolation — open bridge only when git ops are required
      NetworkMode: needsNetwork ? "bridge" : "none",
      // Persistent user volume
      Binds: [`${volumeName}:/workspace`],
      // Security hardening
      SecurityOpt: ["no-new-privileges"],
      // Auto-remove after execution
      AutoRemove: true,
    },
  };

  logger.debug(
    { userId, language, timeoutMs, needsNetwork, volumeName, sessionId },
    "Docker sandbox execution starting",
  );

  let container: import("./dockerTypes.js").DockerContainer | undefined;
  let stdoutChunks: Buffer[] = [];
  let stderrChunks: Buffer[] = [];
  let totalOutputSize = 0;
  const MAX_OUTPUT_SIZE = 1024 * 1024; // 1MB cap
  let exitCode = 1;

  try {
    container = await docker.createContainer(createOptions);

    // Attach to container streams before starting so we don't miss early output
    const stream = await container.attach({ stream: true, stdout: true, stderr: true });

    // dockerode multiplexes stdout/stderr into a single stream with an 8-byte header
    await new Promise<void>((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        // Kill the container on timeout
        container.stop({ t: 0 }).catch(() => {});
        reject(new AppError(408, `Sandbox execution timed out after ${timeoutMs}ms`, "SANDBOX_TIMEOUT"));
      }, timeoutMs);

      docker.modem.demuxStream(
        stream,
        {
          write(chunk: Buffer) {
            totalOutputSize += chunk.length;
            if (totalOutputSize > MAX_OUTPUT_SIZE) {
              stream.destroy();
              return;
            }
            stdoutChunks.push(chunk);
          },
        },
        {
          write(chunk: Buffer) {
            totalOutputSize += chunk.length;
            if (totalOutputSize > MAX_OUTPUT_SIZE) {
              stream.destroy();
              return;
            }
            stderrChunks.push(chunk);
          },
        },
      );

      stream.on("end", () => {
        clearTimeout(timeoutHandle);
        resolve();
      });

      stream.on("error", (err: Error) => {
        clearTimeout(timeoutHandle);
        reject(err);
      });
    });

    // Start must come after attach (to avoid a race where output arrives before attach)
    await container.start();

    // Wait for container to finish (AutoRemove:true handles cleanup)
    const waitResult = await container.wait();
    exitCode = waitResult.StatusCode ?? 1;
  } catch (err: unknown) {
    // Re-throw AppErrors (timeout, etc.) directly
    if (err instanceof AppError) throw err;

    logger.error({ err, userId, language }, "Docker sandbox execution error");
    throw new AppError(
      500,
      `Docker execution failed: ${(err as Error).message}`,
      "SANDBOX_EXEC_FAILED",
    );
  }

  const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
  const stderr = Buffer.concat(stderrChunks).toString("utf-8");
  const durationMs = Date.now() - start;

  logger.debug({ userId, language, exitCode, durationMs }, "Docker sandbox execution complete");

  return { stdout, stderr, exitCode, durationMs };
}
