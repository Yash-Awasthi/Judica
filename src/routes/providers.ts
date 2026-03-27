import { Router, Response } from "express";
import { requireAuth } from "../middleware/auth.js";
import { AuthRequest } from "../types/index.js";
import { validate, providerSchema } from "../middleware/validate.js";
import { askProvider } from "../lib/providers.js";
import logger from "../lib/logger.js";

const router = Router();

// ── GET /providers/test ─────────────────────────────────
// Tests a standalone provider configuration by running a minimal API call.
router.post("/test", requireAuth, validate(providerSchema), async (req: AuthRequest, res: Response, next) => {
  try {
    const provider = { ...req.body, maxTokens: 10 }; // enforce minimal token consumption

    // Execute minimal ping request
    const answer = await askProvider(provider, "Ping. Reply exactly 'OK'.");

    // Evaluate if response matches expectations perfectly or simply resolved successfully
    res.json({ success: true, answer });
  } catch (e: any) {
    const errorMsg = e.message || "Unknown provider error";
    logger.warn({ error: errorMsg, provider: req.body.name }, "Provider health check failed");
    res.status(400).json({ success: false, error: errorMsg });
  }
});

export default router;
