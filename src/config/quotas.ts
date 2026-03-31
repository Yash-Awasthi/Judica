/**
 * Shared quota constants — imported by both HTTP middleware (quota.ts)
 * and WebSocket handlers (socket.ts) so limits are never duplicated.
 */
export const DAILY_REQUEST_LIMIT = 100;
export const DAILY_TOKEN_LIMIT = 1_000_000;
