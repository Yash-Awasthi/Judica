import logger from "../lib/logger.js";

/**
 * MCP (Model Context Protocol) Server Mode:
 * Exposes deliberation capabilities as MCP tools for external clients
 * like Cursor, Claude Desktop, etc.
 */

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (params: Record<string, unknown>) => Promise<MCPToolResult>;
}

export interface MCPToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

export interface MCPServerConfig {
  name: string;
  version: string;
  tools: MCPTool[];
}

export interface MCPRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export interface MCPResponse {
  jsonrpc: "2.0";
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

// ─── Tool Registry ──────────────────────────────────────────────────────────

const toolRegistry = new Map<string, MCPTool>();

/**
 * Register an MCP tool.
 */
export function registerTool(tool: MCPTool): void {
  if (toolRegistry.has(tool.name)) {
    logger.warn({ toolName: tool.name }, "Overwriting existing MCP tool");
  }
  toolRegistry.set(tool.name, tool);
  logger.info({ toolName: tool.name }, "MCP tool registered");
}

/**
 * Unregister an MCP tool.
 */
export function unregisterTool(name: string): boolean {
  const deleted = toolRegistry.delete(name);
  if (deleted) {
    logger.info({ toolName: name }, "MCP tool unregistered");
  }
  return deleted;
}

/**
 * List all registered tools.
 */
export function listTools(): MCPTool[] {
  return [...toolRegistry.values()];
}

/**
 * Get a tool by name.
 */
export function getTool(name: string): MCPTool | undefined {
  return toolRegistry.get(name);
}

/**
 * Clear all registered tools (for testing).
 */
export function clearTools(): void {
  toolRegistry.clear();
}

// ─── JSON-RPC Handler ───────────────────────────────────────────────────────

/**
 * Handle an MCP JSON-RPC request.
 */
export async function handleMCPRequest(request: MCPRequest): Promise<MCPResponse> {
  const baseResponse = { jsonrpc: "2.0" as const, id: request.id };

  try {
    switch (request.method) {
      case "initialize":
        return {
          ...baseResponse,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "aibyai-mcp", version: "1.0.0" },
          },
        };

      case "tools/list":
        return {
          ...baseResponse,
          result: {
            tools: listTools().map((t) => ({
              name: t.name,
              description: t.description,
              inputSchema: t.inputSchema,
            })),
          },
        };

      case "tools/call": {
        const toolName = request.params?.name as string;
        // P36-01: Validate toolName is a non-empty string within bounds
        if (!toolName || typeof toolName !== "string" || toolName.length > 200) {
          return {
            ...baseResponse,
            error: { code: -32602, message: "Invalid tool name" },
          };
        }
        const args = (request.params?.arguments as Record<string, unknown>) || {};
        // P36-01: Cap args keys to prevent unbounded object processing
        if (Object.keys(args).length > 100) {
          return {
            ...baseResponse,
            error: { code: -32602, message: "Too many arguments (max 100)" },
          };
        }

        const tool = getTool(toolName);
        if (!tool) {
          return {
            ...baseResponse,
            error: { code: -32601, message: `Unknown tool: ${toolName}` },
          };
        }

        const result = await tool.handler(args);
        return { ...baseResponse, result };
      }

      default:
        return {
          ...baseResponse,
          error: { code: -32601, message: `Method not found: ${request.method}` },
        };
    }
  } catch (err) {
    logger.error({ err, method: request.method }, "MCP request handling failed");
    return {
      ...baseResponse,
      error: { code: -32603, message: (err as Error).message },
    };
  }
}

// ─── Built-in Deliberation Tools ────────────────────────────────────────────

/**
 * Register the default AIBYAI deliberation tools.
 */
export function registerDefaultTools(): void {
  registerTool({
    name: "deliberate",
    description: "Start a council deliberation on a topic with multiple AI agents",
    inputSchema: {
      type: "object",
      properties: {
        topic: { type: "string", description: "The topic to deliberate on" },
        agentCount: { type: "number", description: "Number of agents (2-8)", default: 4 },
        rounds: { type: "number", description: "Number of deliberation rounds", default: 2 },
      },
      required: ["topic"],
    },
    handler: async (params) => {
      // Placeholder — actual implementation calls the deliberation engine
      return {
        content: [{ type: "text", text: `Deliberation started on: ${params.topic}` }],
      };
    },
  });

  registerTool({
    name: "search_knowledge",
    description: "Search the AIBYAI knowledge base using federated search",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        limit: { type: "number", description: "Max results", default: 5 },
      },
      required: ["query"],
    },
    handler: async (params) => {
      return {
        content: [{ type: "text", text: `Search results for: ${params.query}` }],
      };
    },
  });

  registerTool({
    name: "generate_tests",
    description: "Generate comprehensive tests for a function using multi-perspective analysis",
    inputSchema: {
      type: "object",
      properties: {
        code: { type: "string", description: "The function code to test" },
        functionName: { type: "string", description: "Name of the function" },
        framework: { type: "string", description: "Test framework", default: "vitest" },
      },
      required: ["code", "functionName"],
    },
    handler: async (params) => {
      return {
        content: [{ type: "text", text: `Tests generated for: ${params.functionName}` }],
      };
    },
  });
}
