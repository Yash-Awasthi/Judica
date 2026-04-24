/**
 * MCP Server — standalone Model Context Protocol server for aibyai.
 *
 * Exposes aibyai's knowledge base, search, and council capabilities
 * as MCP tools and resources for external AI agents (Claude Desktop,
 * Cursor, Continue.dev, etc.).
 *
 * Transports:
 * - stdio (default) — for process-level integration
 * - SSE — for HTTP-based clients
 * - streamable-http — for modern MCP clients
 *
 * The server acts as a thin proxy to the aibyai HTTP API, translating
 * MCP tool calls into API requests. It does NOT import aibyai internals
 * directly — it communicates via the public API, so it can run as a
 * separate process or even on a different machine.
 *
 * Modeled after Onyx's MCP server integration.
 */

import { ALL_MCP_TOOLS } from "./tools.js";
import type {
  MCPRequest,
  MCPResponse,
  MCPServerConfig,
  MCPErrorCode,
} from "./models.js";
import { DEFAULT_MCP_CONFIG } from "./models.js";

// ─── MCP Server Class ───────────────────────────────────────────────────────

export class MCPServer {
  private config: MCPServerConfig;

  constructor(config: Partial<MCPServerConfig> = {}) {
    this.config = { ...DEFAULT_MCP_CONFIG, ...config };
  }

  // ─── JSON-RPC Message Handler ────────────────────────────────────────────

  async handleMessage(request: MCPRequest): Promise<MCPResponse> {
    try {
      switch (request.method) {
        case "initialize":
          return this.handleInitialize(request);
        case "tools/list":
          return this.handleToolsList(request);
        case "tools/call":
          return this.handleToolCall(request);
        case "resources/list":
          return this.handleResourcesList(request);
        case "resources/read":
          return this.handleResourceRead(request);
        case "ping":
          return { jsonrpc: "2.0", id: request.id, result: {} };
        default:
          return {
            jsonrpc: "2.0",
            id: request.id,
            error: {
              code: -32601 as MCPErrorCode,
              message: `Method not found: ${request.method}`,
            },
          };
      }
    } catch (err) {
      return {
        jsonrpc: "2.0",
        id: request.id,
        error: {
          code: -32603 as MCPErrorCode,
          message: err instanceof Error ? err.message : "Internal error",
        },
      };
    }
  }

  // ─── Protocol Handlers ───────────────────────────────────────────────────

  private handleInitialize(request: MCPRequest): MCPResponse {
    return {
      jsonrpc: "2.0",
      id: request.id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: {
          tools: {},
          resources: {},
        },
        serverInfo: {
          name: this.config.name,
          version: this.config.version,
        },
      },
    };
  }

  private handleToolsList(request: MCPRequest): MCPResponse {
    const tools = ALL_MCP_TOOLS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: {
        type: "object" as const,
        properties: Object.fromEntries(
          tool.parameters.map((p) => [
            p.name,
            {
              type: p.type,
              description: p.description,
              ...(p.default !== undefined ? { default: p.default } : {}),
              ...(p.enum ? { enum: p.enum } : {}),
            },
          ]),
        ),
        required: tool.parameters.filter((p) => p.required).map((p) => p.name),
      },
    }));

    return {
      jsonrpc: "2.0",
      id: request.id,
      result: { tools },
    };
  }

  private async handleToolCall(request: MCPRequest): Promise<MCPResponse> {
    const params = request.params as { name: string; arguments?: Record<string, unknown> };
    if (!params?.name) {
      return {
        jsonrpc: "2.0",
        id: request.id,
        error: { code: -32602, message: "Tool name required" },
      };
    }

    const toolArgs = params.arguments ?? {};
    const result = await this.executeToolViaAPI(params.name, toolArgs);

    return {
      jsonrpc: "2.0",
      id: request.id,
      result: {
        content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result, null, 2) }],
      },
    };
  }

  private handleResourcesList(request: MCPRequest): MCPResponse {
    return {
      jsonrpc: "2.0",
      id: request.id,
      result: {
        resources: [
          {
            uri: "aibyai://knowledge-bases",
            name: "Knowledge Bases",
            description: "List of all knowledge bases",
            mimeType: "application/json",
          },
        ],
        resourceTemplates: [
          {
            uriTemplate: "aibyai://knowledge-bases/{kbId}/documents",
            name: "KB Documents",
            description: "Documents in a specific knowledge base",
            mimeType: "application/json",
          },
          {
            uriTemplate: "aibyai://conversations/{conversationId}",
            name: "Conversation",
            description: "Full conversation history",
            mimeType: "application/json",
          },
        ],
      },
    };
  }

  private async handleResourceRead(request: MCPRequest): Promise<MCPResponse> {
    const params = request.params as { uri: string };
    if (!params?.uri) {
      return {
        jsonrpc: "2.0",
        id: request.id,
        error: { code: -32602, message: "Resource URI required" },
      };
    }

    const content = await this.fetchResource(params.uri);
    return {
      jsonrpc: "2.0",
      id: request.id,
      result: {
        contents: [
          {
            uri: params.uri,
            mimeType: "application/json",
            text: JSON.stringify(content, null, 2),
          },
        ],
      },
    };
  }

  // ─── API Proxy Layer ─────────────────────────────────────────────────────

  private async apiRequest(path: string, options: RequestInit = {}): Promise<unknown> {
    const url = `${this.config.apiBaseUrl}${path}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}),
    };

    const response = await fetch(url, {
      ...options,
      headers: { ...headers, ...(options.headers as Record<string, string>) },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      throw new Error(`API request failed (${response.status}): ${errorText}`);
    }

    return response.json();
  }

  private async executeToolViaAPI(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    switch (toolName) {
      case "aibyai_search": {
        const searchType = (args.search_type as string) || "hybrid";
        const params = new URLSearchParams({
          q: args.query as string,
          ...(args.kb_id ? { kbId: args.kb_id as string } : {}),
          limit: String(args.limit ?? 5),
          type: searchType,
        });
        return this.apiRequest(`/api/memory/search?${params.toString()}`);
      }

      case "aibyai_list_knowledge_bases":
        return this.apiRequest("/api/kb");

      case "aibyai_get_document":
        return this.apiRequest(`/api/kb/${args.kb_id}/documents/${encodeURIComponent(args.document_name as string)}`);

      case "aibyai_ingest_document":
        return this.apiRequest(`/api/kb/${args.kb_id}/documents`, {
          method: "POST",
          body: JSON.stringify({
            title: args.title,
            content: args.content,
            sourceUrl: args.source_url,
          }),
        });

      case "aibyai_ask":
        return this.apiRequest("/api/ask", {
          method: "POST",
          body: JSON.stringify({
            message: args.question,
            kbId: args.kb_id,
            includeSources: args.include_sources ?? true,
          }),
        });

      case "aibyai_list_conversations": {
        const limit = args.limit ?? 10;
        return this.apiRequest(`/api/history?limit=${limit}`);
      }

      case "aibyai_get_conversation":
        return this.apiRequest(`/api/history/${args.conversation_id}`);

      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }

  private async fetchResource(uri: string): Promise<unknown> {
    if (uri === "aibyai://knowledge-bases") {
      return this.apiRequest("/api/kb");
    }

    const kbDocsMatch = uri.match(/^aibyai:\/\/knowledge-bases\/([^/]+)\/documents$/);
    if (kbDocsMatch) {
      return this.apiRequest(`/api/kb/${kbDocsMatch[1]}/documents`);
    }

    const convMatch = uri.match(/^aibyai:\/\/conversations\/([^/]+)$/);
    if (convMatch) {
      return this.apiRequest(`/api/history/${convMatch[1]}`);
    }

    throw new Error(`Unknown resource URI: ${uri}`);
  }

  // ─── Transport: stdio ────────────────────────────────────────────────────

  async startStdio(): Promise<void> {
    process.stderr.write(`${this.config.name} v${this.config.version} starting on stdio...\n`);

    let buffer = "";

    process.stdin.setEncoding("utf8");
    process.stdin.on("data", async (chunk: string) => {
      buffer += chunk;

      // Process complete JSON-RPC messages (newline-delimited)
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const request = JSON.parse(trimmed) as MCPRequest;
          const response = await this.handleMessage(request);

          // Only send response for requests (not notifications)
          if (request.id !== undefined) {
            process.stdout.write(JSON.stringify(response) + "\n");
          }
        } catch {
          const errorResponse: MCPResponse = {
            jsonrpc: "2.0",
            id: 0,
            error: { code: -32700, message: "Parse error" },
          };
          process.stdout.write(JSON.stringify(errorResponse) + "\n");
        }
      }
    });

    process.stdin.on("end", () => {
      process.stderr.write("stdin closed, shutting down\n");
      process.exit(0);
    });
  }

  // ─── Transport: SSE (HTTP Server-Sent Events) ────────────────────────────

  async startSSE(): Promise<void> {
    const port = this.config.port ?? 3100;
    process.stderr.write(
      `${this.config.name} v${this.config.version} starting SSE server on port ${port}...\n`,
    );

    // Dynamic import to avoid requiring http module in stdio mode
    const http = await import("node:http");

    const server = http.createServer(async (req, res) => {
      // CORS headers
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.url === "/sse" && req.method === "GET") {
        // SSE endpoint for server → client messages
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        res.write(`data: ${JSON.stringify({ type: "ready", server: this.config.name })}\n\n`);
        return;
      }

      if (req.url === "/message" && req.method === "POST") {
        // Message endpoint for client → server requests
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", async () => {
          try {
            const request = JSON.parse(body) as MCPRequest;
            const response = await this.handleMessage(request);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(response));
          } catch {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Invalid request" }));
          }
        });
        return;
      }

      if (req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", server: this.config.name }));
        return;
      }

      res.writeHead(404);
      res.end("Not Found");
    });

    server.listen(port, () => {
      process.stderr.write(`MCP SSE server listening on http://localhost:${port}\n`);
    });
  }

  // ─── Entry Point ─────────────────────────────────────────────────────────

  async start(): Promise<void> {
    switch (this.config.transport) {
      case "stdio":
        return this.startStdio();
      case "sse":
      case "streamable-http":
        return this.startSSE();
      default:
        throw new Error(`Unsupported transport: ${this.config.transport}`);
    }
  }
}
