
// P2-28: Quota limits are now configurable via env vars with sensible defaults.
// Supports tiered overrides per user role in the future.
// P43-01: NaN-safe parseInt — fallback to defaults if env vars are non-numeric
const _parsedRequests = parseInt(process.env.QUOTA_DAILY_REQUESTS || "100", 10);
export const DAILY_REQUEST_LIMIT = Number.isFinite(_parsedRequests) && _parsedRequests > 0 ? _parsedRequests : 100;
const _parsedTokens = parseInt(process.env.QUOTA_DAILY_TOKENS || "1000000", 10);
export const DAILY_TOKEN_LIMIT = Number.isFinite(_parsedTokens) && _parsedTokens > 0 ? _parsedTokens : 1000000;

// Per-route overrides (used by streaming endpoints that may consume more tokens)
export const STREAMING_TOKEN_MULTIPLIER = 2;
