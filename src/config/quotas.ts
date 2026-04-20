import { env } from "./env.js";

// P2-28: Quota limits are now configurable via env vars with sensible defaults.
// Supports tiered overrides per user role in the future.
export const DAILY_REQUEST_LIMIT = parseInt(process.env.QUOTA_DAILY_REQUESTS || "100", 10);
export const DAILY_TOKEN_LIMIT = parseInt(process.env.QUOTA_DAILY_TOKENS || "1000000", 10);

// Per-route overrides (used by streaming endpoints that may consume more tokens)
export const STREAMING_TOKEN_MULTIPLIER = 2;
