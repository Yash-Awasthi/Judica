import { Response, NextFunction } from "express";
import { AuthRequest } from "../types/index.js";
import logger from "../lib/logger.js";

interface UserLimitState {
  rpmCount: number;
  lastReset: number;
  concurrency: number;
}

// In-memory store for rate limits (Decision: Start with Memory, not Redis)
const userLimits = new Map<number, UserLimitState>();

const MAX_RPM = 1000; // 1000 requests per minute per user
const MAX_CONCURRENCY = 100; // 100 simultaneous requests per user
const RPM_WINDOW = 60000; // 1 minute window

/**
 * Per-user rate and concurrency limiter.
 * Prevents system abuse and ensures resource availability.
 */
export function perUserLimiter(req: AuthRequest, res: Response, next: NextFunction) {
  const userId = req.userId;
  if (!userId) return next();

  let state = userLimits.get(userId);
  const now = Date.now();

  if (!state) {
    state = { rpmCount: 0, lastReset: now, concurrency: 0 };
    userLimits.set(userId, state);
  }

  // 1. Reset RPM window if needed
  if (now - state.lastReset > RPM_WINDOW) {
    state.rpmCount = 0;
    state.lastReset = now;
  }

  // 2. Check RPM
  if (state.rpmCount >= MAX_RPM) {
    logger.warn({ userId, rpm: state.rpmCount }, "User exceeded RPM limit");
    res.status(429).json({ 
      error: "Too many requests. Please wait a minute.",
      retryAfter: Math.ceil((RPM_WINDOW - (now - state.lastReset)) / 1000)
    });
    return;
  }

  // 3. Check Concurrency
  if (state.concurrency >= MAX_CONCURRENCY) {
    logger.warn({ userId, concurrency: state.concurrency }, "User exceeded concurrency limit");
    res.status(429).json({ error: "Too many simultaneous requests. Please wait for previous tasks to complete." });
    return;
  }

  // 4. Increment and continue
  state.rpmCount++;
  state.concurrency++;

  // 5. Decrement concurrency on response finish or close
  const decrement = () => {
    const s = userLimits.get(userId);
    if (s && s.concurrency > 0) {
      s.concurrency--;
    }
    // Cleanup if idle
    if (s && s.concurrency === 0 && (Date.now() - s.lastReset > RPM_WINDOW)) {
      // userLimits.delete(userId); // Optional: Keep for a while to avoid thrashing
    }
  };

  res.on("finish", decrement);
  res.on("close", decrement);

  next();
}
