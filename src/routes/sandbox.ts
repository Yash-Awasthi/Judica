import { Router, Response } from "express";
import { requireAuth } from "../middleware/auth.js";
import { AuthRequest } from "../types/index.js";
import { AppError } from "../middleware/errorHandler.js";
import { executeJS } from "../sandbox/jsSandbox.js";
import { executePython } from "../sandbox/pythonSandbox.js";
import rateLimit from "express-rate-limit";
import logger from "../lib/logger.js";

const router = Router();

// Rate limit: 10 executions per user per minute
const sandboxLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  keyGenerator: (req: any) => `sandbox:${req.userId || req.ip}`,
  message: { error: "Too many sandbox executions. Max 10 per minute.", code: "SANDBOX_RATE_LIMIT" },
});

const ALLOWED_LANGUAGES = new Set(["javascript", "python", "typescript"]);

// POST /api/sandbox/execute
router.post("/execute", requireAuth, sandboxLimiter, async (req: AuthRequest, res: Response) => {
  const { language, code } = req.body;

  if (!language || !code) {
    throw new AppError(400, "language and code are required", "SANDBOX_MISSING_FIELDS");
  }

  if (!ALLOWED_LANGUAGES.has(language)) {
    throw new AppError(400, `Unsupported language: ${language}. Supported: ${[...ALLOWED_LANGUAGES].join(", ")}`, "SANDBOX_UNSUPPORTED_LANG");
  }

  if (typeof code !== "string" || code.length > 50_000) {
    throw new AppError(400, "Code must be a string under 50,000 characters", "SANDBOX_CODE_TOO_LONG");
  }

  logger.info({ userId: req.userId, language, codeLength: code.length }, "Sandbox execution requested");

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

    res.json({
      output: result.output,
      error: result.error,
      elapsed_ms: result.elapsedMs,
    });
  } catch (err: any) {
    if (err instanceof AppError) throw err;
    logger.error({ err }, "Sandbox execution error");
    throw new AppError(500, `Execution failed: ${err.message}`, "SANDBOX_EXEC_FAILED");
  }
});

export default router;
