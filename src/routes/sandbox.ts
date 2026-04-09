import { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import { AppError } from "../middleware/errorHandler.js";
import { executeJS } from "../sandbox/jsSandbox.js";
import { executePython } from "../sandbox/pythonSandbox.js";
import logger from "../lib/logger.js";

const ALLOWED_LANGUAGES = new Set(["javascript", "python", "typescript"]);

// In-memory rate limiter: 10 executions per user per minute
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function sandboxRateLimiter(request: FastifyRequest, reply: FastifyReply, done: () => void) {
  const key = `sandbox:${(request as any).userId || request.ip}`;
  const now = Date.now();
  let bucket = rateBuckets.get(key);

  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + 60_000 };
    rateBuckets.set(key, bucket);
  }

  bucket.count++;
  if (bucket.count > 10) {
    reply.code(429).send({ error: "Too many sandbox executions. Max 10 per minute.", code: "SANDBOX_RATE_LIMIT" });
    return;
  }

  done();
}

const sandboxPlugin: FastifyPluginAsync = async (fastify) => {
  /**
   * @openapi
   * /api/sandbox/execute:
   *   post:
   *     tags:
   *       - Sandbox
   *     summary: Execute code in a sandboxed environment
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - language
   *               - code
   *             properties:
   *               language:
   *                 type: string
   *                 enum:
   *                   - javascript
   *                   - typescript
   *                   - python
   *                 description: Programming language to execute
   *               code:
   *                 type: string
   *                 maxLength: 50000
   *                 description: Code to execute
   *     responses:
   *       200:
   *         description: Execution result
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 output:
   *                   type: string
   *                 error:
   *                   type: string
   *                   nullable: true
   *                 elapsed_ms:
   *                   type: number
   *       400:
   *         description: Missing fields, unsupported language, or code too long
   *       401:
   *         description: Unauthorized
   */
  // POST /api/sandbox/execute
  fastify.post("/execute", { preHandler: [fastifyRequireAuth, sandboxRateLimiter] }, async (request, reply) => {
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

    logger.info({ userId: (request as any).userId, language, codeLength: code.length }, "Sandbox execution requested");

    let result;

    try {
      if (language === "javascript" || language === "typescript") {
        // TypeScript is executed as JS (no type checking in sandbox)
        result = await executeJS(code, 5000);
      } else if (language === "python") {
        result = await executePython(code, 10000);
      } else {
        throw new AppError(400, "Unsupported language", "SANDBOX_UNSUPPORTED_LANG");
      }

      return {
        output: result.output,
        error: result.error,
        elapsed_ms: result.elapsedMs,
      };
    } catch (err: any) {
      if (err instanceof AppError) throw err;
      logger.error({ err }, "Sandbox execution error");
      throw new AppError(500, `Execution failed: ${err.message}`, "SANDBOX_EXEC_FAILED");
    }
  });
};

export default sandboxPlugin;
