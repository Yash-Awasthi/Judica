
// P2-28: Quota limits are now configurable via env vars with sensible defaults.
// Supports tiered overrides per user role in the future.
const _parsedRequests = parseInt(process.env.QUOTA_DAILY_REQUESTS || "100", 10);
export const DAILY_REQUEST_LIMIT = Number.isNaN(_parsedRequests) ? 100 : _parsedRequests;

const _parsedTokens = parseInt(process.env.QUOTA_DAILY_TOKENS || "1000000", 10);
export const DAILY_TOKEN_LIMIT = Number.isNaN(_parsedTokens) ? 1000000 : _parsedTokens;

// Per-route overrides (used by streaming endpoints that may consume more tokens)
export const STREAMING_TOKEN_MULTIPLIER = 2;
