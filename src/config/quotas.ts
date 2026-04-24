
// Quota limits are now configurable via env vars with sensible defaults.
// Supports tiered overrides per user role in the future.
// NaN guards — fall back to defaults if env vars are non-numeric
const _parsedDailyReq = parseInt(process.env.QUOTA_DAILY_REQUESTS || "100", 10);
export const DAILY_REQUEST_LIMIT = Number.isFinite(_parsedDailyReq) && _parsedDailyReq > 0 ? _parsedDailyReq : 100;
const _parsedDailyTokens = parseInt(process.env.QUOTA_DAILY_TOKENS || "1000000", 10);
export const DAILY_TOKEN_LIMIT = Number.isFinite(_parsedDailyTokens) && _parsedDailyTokens > 0 ? _parsedDailyTokens : 1000000;

// Per-route overrides (used by streaming endpoints that may consume more tokens)
export const STREAMING_TOKEN_MULTIPLIER = 2;
