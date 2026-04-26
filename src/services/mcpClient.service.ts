import logger from "../lib/logger.js";
import { validateSafeUrl } from "../lib/ssrf.js";
import { checkAndConsumeToolLimit, MCPRateLimitError } from "./mcpRateLimit.service.js";

/**
 * MCP Client Mode: allows agents to call external MCP servers
 * during deliberation (e.g., GitHub, Jira, filesystem tools).
 */

export interface MCPServerConnection {
  name: string;
  url: string;
  transport: "stdio" | "sse" | "http";
  headers?: Record<string, string>;
}

export interface MCPClientTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  serverName: string;
}

export interface MCPCallResult {
  success: boolean;
  content: { type: string; text: string }[];
  error?: string;
  durationMs: number;
}

// ─── Connection Registry ────────────────────────────────────────────────────

// Cap connections to prevent unbounded memory growth
const MAX_MCP_CONNECTIONS = 50;
const connections = new Map<string, MCPServerConnection>();
// Cap tool cache size
const MAX_TOOL_CACHE_ENTRIES = 100;
const toolCache = new Map<string, MCPClientTool[]>();

/**
 * Register an external MCP server connection.
 * R3-06: Validate URL against SSRF before storing — MCP servers with HTTP/SSE
 * transport could otherwise be pointed at internal services.
 */
export async function addConnection(conn: MCPServerConnection): Promise<void> {
  if (conn.transport === "http" || conn.transport === "sse") {
    await validateSafeUrl(conn.url);
  }
  connections.set(conn.name, conn);
  toolCache.delete(conn.name); // Invalidate cache
  logger.info({ serverName: conn.name, transport: conn.transport }, "MCP server connection added");
}

/**
 * Remove a connection.
 */
export function removeConnection(name: string): boolean {
  toolCache.delete(name);
  const removed = connections.delete(name);
  if (removed) logger.info({ serverName: name }, "MCP server connection removed");
  return removed;
}

/**
 * List all connections.
 */
export function listConnections(): MCPServerConnection[] {
  return [...connections.values()];
}

/**
 * Get a connection by name.
 */
export function getConnection(name: string): MCPServerConnection | undefined {
  return connections.get(name);
}

/**
 * Clear all connections (for testing).
 */
export function clearConnections(): void {
  connections.clear();
  toolCache.clear();
}

// ─── Tool Discovery ─────────────────────────────────────────────────────────

/**
 * Discover tools from a remote MCP server.
 * Sends a tools/list request and caches the result.
 */
export async function discoverTools(
  serverName: string,
  fetchFn: (url: string, init: RequestInit) => Promise<{ json: () => Promise<unknown> }> = fetch as unknown as (url: string, init: RequestInit) => Promise<{ json: () => Promise<unknown> }>,
): Promise<MCPClientTool[]> {
  const conn = connections.get(serverName);
  if (!conn) {
    throw new Error(`Unknown MCP server: ${serverName}`);
  }

  // Check cache
  const cached = toolCache.get(serverName);
  if (cached) return cached;

  try {
    const response = await fetchFn(conn.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...conn.headers },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: `discover_${Date.now()}`,
        method: "tools/list",
      }),
    });

    const data = await response.json() as { result?: { tools: { name: string; description: string; inputSchema: Record<string, unknown> }[] } };

    if (data.result?.tools) {
      // Cap discovered tools to prevent unbounded cache growth
      const tools: MCPClientTool[] = data.result.tools.slice(0, 500).map((t) => ({
        ...t,
        serverName,
      }));
      toolCache.set(serverName, tools);
      // Evict oldest cache entry if exceeding cap
      if (toolCache.size > MAX_TOOL_CACHE_ENTRIES) {
        const oldest = toolCache.keys().next().value;
        if (oldest !== undefined) toolCache.delete(oldest);
      }
      logger.info({ serverName, toolCount: tools.length }, "Discovered MCP tools");
      return tools;
    }

    return [];
  } catch (err) {
    logger.error({ err, serverName }, "Failed to discover MCP tools");
    throw err;
  }
}

/**
 * Discover tools from all connected servers.
 */
export async function discoverAllTools(
  fetchFn?: (url: string, init: RequestInit) => Promise<{ json: () => Promise<unknown> }>,
): Promise<MCPClientTool[]> {
  const allTools: MCPClientTool[] = [];

  const results = await Promise.allSettled(
    [...connections.keys()].map((name) => discoverTools(name, fetchFn)),
  );

  for (const result of results) {
    if (result.status === "fulfilled") {
      allTools.push(...result.value);
    }
  }

  return allTools;
}

// ─── Tool Invocation ────────────────────────────────────────────────────────

/**
 * Call a tool on a remote MCP server.
 * Phase 8.5: Per-tool rate limiting is enforced before every tool call.
 */
export async function callTool(
  serverName: string,
  toolName: string,
  args: Record<string, unknown>,
  fetchFn: (url: string, init: RequestInit) => Promise<{ json: () => Promise<unknown> }> = fetch as unknown as (url: string, init: RequestInit) => Promise<{ json: () => Promise<unknown> }>,
  userId?: number,
): Promise<MCPCallResult> {
  const startTime = Date.now();
  const conn = connections.get(serverName);

  if (!conn) {
    return {
      success: false,
      content: [],
      error: `Unknown MCP server: ${serverName}`,
      durationMs: Date.now() - startTime,
    };
  }

  // Phase 8.5: Enforce per-tool rate limit before making the call
  try {
    await checkAndConsumeToolLimit(serverName, toolName, userId);
  } catch (err) {
    if (err instanceof MCPRateLimitError) {
      logger.warn({ serverName, toolName, userId, retryAfterMs: err.retryAfterMs }, "MCP tool call blocked by rate limiter");
      return {
        success: false,
        content: [],
        error: err.message,
        durationMs: Date.now() - startTime,
      };
    }
    throw err;
  }

  try {
    const response = await fetchFn(conn.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...conn.headers },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: `call_${Date.now()}`,
        method: "tools/call",
        params: { name: toolName, arguments: args },
      }),
    });

    const data = await response.json() as {
      result?: { content: { type: string; text: string }[] };
      error?: { message: string };
    };

    if (data.error) {
      return {
        success: false,
        content: [],
        error: data.error.message,
        durationMs: Date.now() - startTime,
      };
    }

    return {
      success: true,
      content: data.result?.content || [],
      durationMs: Date.now() - startTime,
    };
  } catch (err) {
    logger.error({ err, serverName, toolName }, "MCP tool call failed");
    return {
      success: false,
      content: [],
      error: (err as Error).message,
      durationMs: Date.now() - startTime,
    };
  }
}
