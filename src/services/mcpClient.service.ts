import logger from "../lib/logger.js";

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

const connections = new Map<string, MCPServerConnection>();
const toolCache = new Map<string, MCPClientTool[]>();

// P35-03: Cap MCP connection and tool cache maps
const MAX_MCP_CONNECTIONS = 100;
const MAX_TOOL_CACHE_ENTRIES = 100;

/**
 * Register an external MCP server connection.
 */
export function addConnection(conn: MCPServerConnection): void {
  // P35-04: SSRF validation on MCP server URL
  const url = new URL(conn.url);
  const hostname = url.hostname.toLowerCase();
  if (
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" ||
    hostname === "0.0.0.0" || hostname.endsWith(".local") || hostname.endsWith(".internal") ||
    hostname.startsWith("10.") || hostname.startsWith("192.168.") || hostname.startsWith("169.254.")
  ) {
    throw new Error(`MCP server URL targets a restricted hostname: ${hostname}`);
  }
  if (connections.size >= MAX_MCP_CONNECTIONS && !connections.has(conn.name)) {
    throw new Error(`Maximum MCP connections (${MAX_MCP_CONNECTIONS}) reached`);
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
      // P35-05: Cap discovered tools to prevent unbounded cache growth
      const tools: MCPClientTool[] = data.result.tools.slice(0, 500).map((t) => ({
        ...t,
        serverName,
      }));
      toolCache.set(serverName, tools);
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
 */
export async function callTool(
  serverName: string,
  toolName: string,
  args: Record<string, unknown>,
  fetchFn: (url: string, init: RequestInit) => Promise<{ json: () => Promise<unknown> }> = fetch as unknown as (url: string, init: RequestInit) => Promise<{ json: () => Promise<unknown> }>,
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
