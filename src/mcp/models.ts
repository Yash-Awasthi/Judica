/**
 * MCP (Model Context Protocol) Server Models.
 *
 * Defines the types for judica's standalone MCP server, which exposes
 * search, knowledge base, document management, and council capabilities
 * as MCP tools and resources — allowing external AI agents (Claude Desktop,
 * Cursor, etc.) to interact with judica's knowledge layer.
 *
 * Modeled after Onyx's MCP integration.
 */

// ─── MCP Tool Definitions ────────────────────────────────────────────────────

export interface MCPToolParameter {
  name: string;
  description: string;
  type: "string" | "number" | "boolean" | "array" | "object";
  required: boolean;
  default?: unknown;
  enum?: string[];
}

export interface MCPToolDefinition {
  name: string;
  description: string;
  parameters: MCPToolParameter[];
}

// ─── MCP Resource Definitions ────────────────────────────────────────────────

export interface MCPResource {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

export interface MCPResourceTemplate {
  uriTemplate: string;
  name: string;
  description: string;
  mimeType: string;
}

// ─── MCP Server Config ───────────────────────────────────────────────────────

export interface MCPServerConfig {
  /** Server name shown to MCP clients. */
  name: string;
  /** Server version. */
  version: string;
  /** judica API base URL the MCP server proxies to. */
  apiBaseUrl: string;
  /** API key or JWT for authenticating with judica. */
  apiKey?: string;
  /** Default knowledge base ID for search operations. */
  defaultKbId?: string;
  /** Transport mode. */
  transport: "stdio" | "sse" | "streamable-http";
  /** Port for SSE/HTTP transport. */
  port?: number;
}

export const DEFAULT_MCP_CONFIG: MCPServerConfig = {
  name: "judica-mcp",
  version: "0.1.0",
  apiBaseUrl: "http://localhost:3000",
  transport: "stdio",
  port: 3100,
};

// ─── MCP Protocol Messages ───────────────────────────────────────────────────

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
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface MCPNotification {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
}

// ─── MCP Error Codes ─────────────────────────────────────────────────────────

export enum MCPErrorCode {
  PARSE_ERROR = -32700,
  INVALID_REQUEST = -32600,
  METHOD_NOT_FOUND = -32601,
  INVALID_PARAMS = -32602,
  INTERNAL_ERROR = -32603,
}
