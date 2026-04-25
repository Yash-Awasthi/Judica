import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import { AppError } from "../middleware/errorHandler.js";
import { executeJS } from "../sandbox/jsSandbox.js";
import { executePython } from "../sandbox/pythonSandbox.js";
import { execInDocker } from "../sandbox/dockerSandbox.js";
import logger from "../lib/logger.js";
import redis from "../lib/redis.js";

// Per-route rate limit is enforced below (1 exec/min for sandbox via custom limiter).
// The sandbox has a much tighter rate limit (10/min) compared to the global 120/min.
const ALLOWED_LANGUAGES = new Set(["javascript", "python", "typescript"]);

// Docker-supported languages — superset of the in-process sandbox
const DOCKER_SUPPORTED_LANGUAGES = ["javascript", "typescript", "python", "bash", "sh"];

// Whether Docker routing is enabled globally
const SANDBOX_DOCKER_ENABLED = process.env.SANDBOX_DOCKER === "true";
const MAX_EXECUTIONS_PER_MINUTE = 10;
const MAX_CONCURRENT_PER_USER = 3; // cap concurrent sandbox executions

// Track in-flight executions per user
const inflightMap = new Map<string, number>();

// Redis-backed rate limiter with in-memory fallback
// Cap memoryBuckets to prevent unbounded growth
const MAX_MEMORY_BUCKETS = 10_000;
const memoryBuckets = new Map<string, { count: number; resetAt: number }>();
const MAX_BUCKETS = 10_000;

// Periodic cleanup of expired rate-limit buckets (every 60s)
const bucketCleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of memoryBuckets) {
    if (now >= bucket.resetAt) {
      memoryBuckets.delete(key);
    }
  }
}, 60_000);
bucketCleanupInterval.unref();

const MAX_INFLIGHT_ENTRIES = 5000;

async function sandboxRateLimiter(request: FastifyRequest, reply: FastifyReply) {
  const userId = (request as unknown as { userId?: number }).userId || request.ip;
  const key = `sandbox:rl:${userId}`;

  // Try Redis first for multi-replica consistency
  try {
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, 60);
    }
    if (count > MAX_EXECUTIONS_PER_MINUTE) {
      reply.code(429).send({ error: "Too many sandbox executions. Max 10 per minute.", code: "SANDBOX_RATE_LIMIT" });
      return;
    }
    return;
  } catch {
    // Fall back to in-memory
  }

  // In-memory fallback
  const now = Date.now();
  // Evict expired buckets when map grows too large
  if (memoryBuckets.size >= MAX_MEMORY_BUCKETS) {
    for (const [k, v] of memoryBuckets) {
      if (now >= v.resetAt) memoryBuckets.delete(k);
    }
  }
  let bucket = memoryBuckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    // Safety net: evict expired entries if map exceeds cap
    if (memoryBuckets.size >= MAX_BUCKETS) {
      for (const [k, b] of memoryBuckets) {
        if (now >= b.resetAt) memoryBuckets.delete(k);
      }
    }
    bucket = { count: 0, resetAt: now + 60_000 };
    memoryBuckets.set(key, bucket);
  }
  bucket.count++;
  if (bucket.count > MAX_EXECUTIONS_PER_MINUTE) {
    reply.code(429).send({ error: "Too many sandbox executions. Max 10 per minute.", code: "SANDBOX_RATE_LIMIT" });
    return;
  }
}

// Concurrency guard
function acquireConcurrency(userId: string): boolean {
  // Cap inflight entries
  if (inflightMap.size >= MAX_INFLIGHT_ENTRIES && !inflightMap.has(userId)) {
    for (const [k, v] of inflightMap) {
      if (v <= 0) { inflightMap.delete(k); break; }
    }
  }
  const current = inflightMap.get(userId) || 0;
  if (current >= MAX_CONCURRENT_PER_USER) return false;
  inflightMap.set(userId, current + 1);
  return true;
}

function releaseConcurrency(userId: string): void {
  const current = inflightMap.get(userId) || 1;
  if (current <= 1) inflightMap.delete(userId);
  else inflightMap.set(userId, current - 1);
}

const sandboxPlugin: FastifyPluginAsync = async (fastify) => {
    // POST /api/sandbox/execute
  fastify.post("/execute", { preHandler: [fastifyRequireAuth, sandboxRateLimiter] }, async (request, _reply) => {
    const { language, code } = request.body as { language?: string; code?: string };

    if (!language || !code) {
      throw new AppError(400, "language and code are required", "SANDBOX_MISSING_FIELDS");
    }

    if (!ALLOWED_LANGUAGES.has(language)) {
      throw new AppError(400, `Unsupported language: ${language}. Supported: ${[...ALLOWED_LANGUAGES].join(", ")}`, "SANDBOX_UNSUPPORTED_LANG");
    }

    if (typeof code !== "string" || code.length > 50_000) {
      throw new AppError(400, "Code must be a string under 50,000 characters", "SANDBOX_CODE_TOO_LONG");
    }

    const userKey = String((request as unknown as { userId?: number }).userId || request.ip);

    // Enforce concurrency cap
    if (!acquireConcurrency(userKey)) {
      throw new AppError(429, `Max ${MAX_CONCURRENT_PER_USER} concurrent sandbox executions allowed`, "SANDBOX_CONCURRENCY_LIMIT");
    }

    logger.info({ userId: userKey, language, codeLength: code.length }, "Sandbox execution requested");

    try {
      let result;

      if (language === "javascript" || language === "typescript") {
        // If Docker is globally enabled, route JS/TS through Docker too
        if (SANDBOX_DOCKER_ENABLED) {
          const userId = String((request as unknown as { userId?: number }).userId || request.ip);
          const dockerResult = await execInDocker({ language, code, userId });
          return {
            output: dockerResult.stdout,
            error: dockerResult.exitCode !== 0 ? dockerResult.stderr : null,
            elapsed_ms: dockerResult.durationMs,
          };
        }
        result = await executeJS(code, 5000);
      } else if (language === "python") {
        // If Docker is globally enabled, route Python through Docker too
        if (SANDBOX_DOCKER_ENABLED) {
          const userId = String((request as unknown as { userId?: number }).userId || request.ip);
          const dockerResult = await execInDocker({ language, code, userId });
          return {
            output: dockerResult.stdout,
            error: dockerResult.exitCode !== 0 ? dockerResult.stderr : null,
            elapsed_ms: dockerResult.durationMs,
          };
        }
        result = await executePython(code, 10000);
      } else {
        throw new AppError(400, "Unsupported language", "SANDBOX_UNSUPPORTED_LANG");
      }

      return {
        output: result.output,
        error: result.error,
        elapsed_ms: result.elapsedMs,
      };
    } catch (err: unknown) {
      if (err instanceof AppError) throw err;
      logger.error({ err }, "Sandbox execution error");
      throw new AppError(500, `Execution failed: ${(err as Error).message}`, "SANDBOX_EXEC_FAILED");
    } finally {
      releaseConcurrency(userKey);
    }
  });
  // POST /api/sandbox/exec-docker — dedicated Docker sandbox execution endpoint
  fastify.post("/exec-docker", { preHandler: [fastifyRequireAuth, sandboxRateLimiter] }, async (request, _reply) => {
    const { language, code, sessionId, timeoutMs: rawTimeout, gitPat } =
      request.body as {
        language?: string;
        code?: string;
        sessionId?: string;
        timeoutMs?: number;
        gitPat?: string;
      };

    if (!language || !code) {
      throw new AppError(400, "language and code are required", "SANDBOX_MISSING_FIELDS");
    }

    if (!DOCKER_SUPPORTED_LANGUAGES.includes(language)) {
      throw new AppError(
        400,
        `Unsupported language for Docker sandbox: ${language}. Supported: ${DOCKER_SUPPORTED_LANGUAGES.join(", ")}`,
        "SANDBOX_UNSUPPORTED_LANG",
      );
    }

    if (typeof code !== "string" || code.length > 50_000) {
      throw new AppError(400, "Code must be a string under 50,000 characters", "SANDBOX_CODE_TOO_LONG");
    }

    const userKey = String((request as unknown as { userId?: number }).userId || request.ip);

    // Enforce concurrency cap (shared with the main execute route)
    if (!acquireConcurrency(userKey)) {
      throw new AppError(429, `Max ${MAX_CONCURRENT_PER_USER} concurrent sandbox executions allowed`, "SANDBOX_CONCURRENCY_LIMIT");
    }

    logger.info(
      { userId: userKey, language, codeLength: code.length, sessionId, hasGitPat: Boolean(gitPat) },
      "Docker sandbox execution requested",
    );

    try {
      // Inject git PAT as an env var if provided
      const extraEnv: Record<string, string> = {};
      if (gitPat) {
        extraEnv.GIT_PAT = gitPat;
        // Also configure git to use the PAT for HTTPS authentication
        extraEnv.GIT_ASKPASS = "echo";
        extraEnv.GIT_TERMINAL_PROMPT = "0";
      }

      const result = await execInDocker({
        language,
        code,
        sessionId,
        userId: userKey,
        timeoutMs: rawTimeout,
        env: extraEnv,
      });

      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exit_code: result.exitCode,
        elapsed_ms: result.durationMs,
      };
    } catch (err: unknown) {
      if (err instanceof AppError) throw err;
      logger.error({ err }, "Docker sandbox execution error");
      throw new AppError(500, `Docker execution failed: ${(err as Error).message}`, "SANDBOX_EXEC_FAILED");
    } finally {
      releaseConcurrency(userKey);
    }
  });

  // GET /api/sandbox/status — reports sandbox runtime capabilities
  fastify.get("/status", { preHandler: [fastifyRequireAuth] }, async (_request, _reply) => {
    let dockerAvailable = false;
    try {
      const Docker = (await import("dockerode")).default;
      const docker = new Docker();
      await docker.ping();
      dockerAvailable = true;
    } catch {
      dockerAvailable = false;
    }

    return {
      dockerAvailable,
      dockerSandboxEnabled: SANDBOX_DOCKER_ENABLED,
      supportedLanguages: dockerAvailable
        ? DOCKER_SUPPORTED_LANGUAGES
        : [...ALLOWED_LANGUAGES],
    };
  });
};

export default sandboxPlugin;
