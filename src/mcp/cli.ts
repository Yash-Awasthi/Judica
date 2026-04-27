#!/usr/bin/env node
/**
 * MCP Server CLI — standalone entry point.
 *
 * Usage:
 *   npx tsx src/mcp/cli.ts                          # stdio (default)
 *   npx tsx src/mcp/cli.ts --transport sse           # SSE on port 3100
 *   npx tsx src/mcp/cli.ts --transport sse --port 8080
 *   npx tsx src/mcp/cli.ts --api-url http://myserver:3000 --api-key mytoken
 *
 * Claude Desktop config (~/.claude/claude_desktop_config.json):
 * {
 *   "mcpServers": {
 *     "judica": {
 *       "command": "npx",
 *       "args": ["tsx", "/path/to/judica/src/mcp/cli.ts"],
 *       "env": {
 *         "JUDICA_API_URL": "http://localhost:3000",
 *         "JUDICA_API_KEY": "your-jwt-token"
 *       }
 *     }
 *   }
 * }
 */

import { MCPServer } from "./server.js";
import type { MCPServerConfig } from "./models.js";

function parseArgs(): Partial<MCPServerConfig> {
  const args = process.argv.slice(2);
  const config: Partial<MCPServerConfig> = {};

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--transport":
      case "-t":
        config.transport = args[++i] as MCPServerConfig["transport"];
        break;
      case "--port":
      case "-p":
        config.port = parseInt(args[++i], 10);
        break;
      case "--api-url":
        config.apiBaseUrl = args[++i];
        break;
      case "--api-key":
        config.apiKey = args[++i];
        break;
      case "--name":
        config.name = args[++i];
        break;
      case "--help":
      case "-h":
        process.stderr.write(`
judica MCP Server — expose judica as tools for AI agents

Usage:
  npx tsx src/mcp/cli.ts [options]

Options:
  --transport, -t   Transport mode: stdio (default), sse, streamable-http
  --port, -p        Port for SSE/HTTP transport (default: 3100)
  --api-url         judica API base URL (default: http://localhost:3000)
  --api-key         API key / JWT token for authentication
  --name            Server name (default: judica-mcp)
  --help, -h        Show this help

Environment variables:
  JUDICA_API_URL    Same as --api-url
  JUDICA_API_KEY    Same as --api-key
  JUDICA_MCP_PORT   Same as --port
`);
        process.exit(0);
    }
  }

  // Environment variable fallbacks
  if (!config.apiBaseUrl) config.apiBaseUrl = process.env.JUDICA_API_URL;
  if (!config.apiKey) config.apiKey = process.env.JUDICA_API_KEY;
  if (!config.port && process.env.JUDICA_MCP_PORT) {
    config.port = parseInt(process.env.JUDICA_MCP_PORT, 10);
  }

  return config;
}

const config = parseArgs();
const server = new MCPServer(config);
server.start().catch((err) => {
  process.stderr.write(`Failed to start MCP server: ${err}\n`);
  process.exit(1);
});
