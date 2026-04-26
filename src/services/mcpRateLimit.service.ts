/**
 * Phase 8.5 — Per-Tool Rate Limiting in MCP Client
 *
 * Ref: MCP Specification rate limiting guidance
 *      (https://modelcontextprotocol.io/specification)
 *
 * The MCP spec notes that servers may enforce rate limits, but the *client*
 * should also enforce limits to prevent runaway tool calls from consuming
 * all quota or hammering an external service.
 *
 * Architecture: token-bucket per (serverName, toolName) pair, backed by Redis.
 *
 * Limits are configured at three granularities:
 *   1. Per-tool   — e.g., "web_search" can be called 10 times/minute
 *   2. Per-server — e.g., "github_mcp" server can be called 60 times/minute total
 *   3. Global     — all MCP tool calls combined: 200/minute
 *
 * Default limits (conservative, overridable via env or DB config):
 *   - Global:     200 calls/minute
 *   - Per-server: 60 calls/minute
 *   - Per-tool:   20 calls/minute
 *
 * When a limit is hit:
 *   - Returns a RateLimitError with retryAfterMs field
 *   - Logged with the tool name, server name, and user ID
 *   - The orchestrator can decide to skip the tool or wait and retry
 */

import redis from "../lib/redis.js";
import logger from "../lib/logger.js";

const log = logger.child({ service: "mcpRateLimit" });

// ─── Configuration ────────────────────────────────────────────────────────────

const WINDOW_MS = 60_000; // 1-minute sliding window

const DEFAULTS = {
  globalPerMinute: parseInt(process.env.MCP_GLOBAL_RPM ?? "200", 10),
  serverPerMinute: parseInt(process.env.MCP_SERVER_RPM ?? "60", 10),
  toolPerMinute:   parseInt(process.env.MCP_TOOL_RPM   ?? "20", 10),
};

// In-memory overrides — per tool overrides set via configureTool()
const toolOverrides = new Map<string, number>(); // key = `${server}:${tool}` → calls/min

// ─── Types ────────────────────────────────────────────────────────────────────

export class MCPRateLimitError extends Error {
  constructor(
    public readonly toolName: string,
    public readonly serverName: string,
    public readonly retryAfterMs: number,
    public readonly limitType: "global" | "server" | "tool"
  ) {
    super(
      `MCP rate limit exceeded for tool "${toolName}" on server "${serverName}" ` +
      `(${limitType} limit). Retry after ${Math.ceil(retryAfterMs / 1000)}s.`
    );
    this.name = "MCPRateLimitError";
  }
}

export interface ToolRateConfig {
  /** Max calls per minute for this specific tool (overrides server default) */
  callsPerMinute: number;
}

// ─── Redis Sliding Window ─────────────────────────────────────────────────────

/**
 * Increment a sliding window counter in Redis.
 * Uses a sorted set keyed by timestamp to implement a true sliding window.
 * Returns the current count within the window.
 */
async function slidingWindowIncrement(key: string): Promise<number> {
  const now = Date.now();
  const windowStart = now - WINDOW_MS;
  const member = `${now}-${Math.random().toString(36).slice(2, 7)}`;

  try {
    const pipeline = (redis as { pipeline?: () => { zadd: Function; zremrangebyscore: Function; zcard: Function; expire: Function; exec: Function } }).pipeline?.();
    if (pipeline) {
      pipeline.zadd(key, now, member);
      pipeline.zremrangebyscore(key, 0, windowStart);
      pipeline.zcard(key);
      pipeline.expire(key, Math.ceil(WINDOW_MS / 1000) + 5);
      const results = await pipeline.exec();
      // zcard result is at index 2
      return (results?.[2]?.[1] as number) ?? 0;
    }

    // Fallback: sequential commands (no pipeline support)
    await redis.zadd(key, { score: now, value: member });
    await redis.zremrangebyscore(key, 0, windowStart);
    const count = await redis.zcard(key);
    await redis.expire(key, Math.ceil(WINDOW_MS / 1000) + 5);
    return count;
  } catch (err) {
    log.warn({ err, key }, "MCP rate limit Redis error — failing open");
    return 0; // Fail open: don't block calls if Redis is unavailable
  }
}

async function slidingWindowCount(key: string): Promise<number> {
  const windowStart = Date.now() - WINDOW_MS;
  try {
    return await redis.zcount(key, windowStart, "+inf");
  } catch {
    return 0;
  }
}

// ─── Rate Limit Check ─────────────────────────────────────────────────────────

/**
 * Check and increment rate limit counters for an MCP tool call.
 *
 * Checks in order: global → server → tool
 * Throws MCPRateLimitError if any limit is exceeded.
 */
export async function checkAndConsumeToolLimit(
  serverName: string,
  toolName: string,
  userId?: number
): Promise<void> {
  const suffix = userId ? `:u${userId}` : "";
  const globalKey  = `mcp:rl:global${suffix}`;
  const serverKey  = `mcp:rl:server:${serverName}${suffix}`;
  const toolKey    = `mcp:rl:tool:${serverName}:${toolName}${suffix}`;

  const toolLimit = toolOverrides.get(`${serverName}:${toolName}`) ?? DEFAULTS.toolPerMinute;

  // Check current counts before incrementing (avoid wasting a token)
  const [globalCount, serverCount, toolCount] = await Promise.all([
    slidingWindowCount(globalKey),
    slidingWindowCount(serverKey),
    slidingWindowCount(toolKey),
  ]);

  if (globalCount >= DEFAULTS.globalPerMinute) {
    log.warn({ serverName, toolName, globalCount }, "MCP global rate limit exceeded");
    throw new MCPRateLimitError(toolName, serverName, WINDOW_MS, "global");
  }
  if (serverCount >= DEFAULTS.serverPerMinute) {
    log.warn({ serverName, toolName, serverCount }, "MCP server rate limit exceeded");
    throw new MCPRateLimitError(toolName, serverName, WINDOW_MS, "server");
  }
  if (toolCount >= toolLimit) {
    log.warn({ serverName, toolName, toolCount, toolLimit }, "MCP tool rate limit exceeded");
    throw new MCPRateLimitError(toolName, serverName, WINDOW_MS, "tool");
  }

  // Consume tokens across all three counters
  await Promise.all([
    slidingWindowIncrement(globalKey),
    slidingWindowIncrement(serverKey),
    slidingWindowIncrement(toolKey),
  ]);
}

// ─── Configuration API ────────────────────────────────────────────────────────

/**
 * Override the per-minute call limit for a specific tool.
 * Set to 0 to block the tool entirely.
 */
export function configureTool(
  serverName: string,
  toolName: string,
  config: ToolRateConfig
): void {
  toolOverrides.set(`${serverName}:${toolName}`, config.callsPerMinute);
  log.info({ serverName, toolName, callsPerMinute: config.callsPerMinute }, "MCP tool rate limit configured");
}

/**
 * Remove a per-tool override (revert to server default).
 */
export function clearToolConfig(serverName: string, toolName: string): void {
  toolOverrides.delete(`${serverName}:${toolName}`);
}

/**
 * Get the effective rate limit for a tool (custom override or default).
 */
export function getToolLimit(serverName: string, toolName: string): number {
  return toolOverrides.get(`${serverName}:${toolName}`) ?? DEFAULTS.toolPerMinute;
}

/**
 * Get current usage stats for a tool within the sliding window.
 */
export async function getToolUsage(
  serverName: string,
  toolName: string,
  userId?: number
): Promise<{ used: number; limit: number; remaining: number }> {
  const suffix = userId ? `:u${userId}` : "";
  const toolKey = `mcp:rl:tool:${serverName}:${toolName}${suffix}`;
  const used = await slidingWindowCount(toolKey);
  const limit = getToolLimit(serverName, toolName);
  return { used, limit, remaining: Math.max(0, limit - used) };
}
