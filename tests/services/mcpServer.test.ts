import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock logger
vi.mock("../../src/lib/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Mock env
vi.mock("../../src/config/env.js", () => ({
  env: {
    DATABASE_URL: "postgresql://test:test@localhost:5432/test",
    JWT_SECRET: "test-jwt-secret-min-16-chars",
    MASTER_ENCRYPTION_KEY: "test-master-encryption-key-min-32-characters-long",
  },
}));

import {
  registerTool,
  unregisterTool,
  listTools,
  getTool,
  clearTools,
  handleMCPRequest,
  registerDefaultTools,
  type MCPTool,
  type MCPRequest,
} from "../../src/services/mcpServer.service.js";

describe("mcpServer.service", () => {
  beforeEach(() => {
    clearTools();
  });

  describe("tool registry", () => {
    it("should register and retrieve a tool", () => {
      const tool: MCPTool = {
        name: "test_tool",
        description: "A test tool",
        inputSchema: { type: "object", properties: {} },
        handler: async () => ({ content: [{ type: "text", text: "ok" }] }),
      };

      registerTool(tool);

      expect(getTool("test_tool")).toBeDefined();
      expect(getTool("test_tool")!.name).toBe("test_tool");
    });

    it("should list all registered tools", () => {
      registerTool({
        name: "tool_a",
        description: "A",
        inputSchema: {},
        handler: async () => ({ content: [{ type: "text", text: "" }] }),
      });
      registerTool({
        name: "tool_b",
        description: "B",
        inputSchema: {},
        handler: async () => ({ content: [{ type: "text", text: "" }] }),
      });

      const tools = listTools();
      expect(tools).toHaveLength(2);
      expect(tools.map((t) => t.name).sort()).toEqual(["tool_a", "tool_b"]);
    });

    it("should unregister a tool", () => {
      registerTool({
        name: "temp",
        description: "",
        inputSchema: {},
        handler: async () => ({ content: [{ type: "text", text: "" }] }),
      });

      expect(unregisterTool("temp")).toBe(true);
      expect(getTool("temp")).toBeUndefined();
      expect(unregisterTool("nonexistent")).toBe(false);
    });

    it("should clear all tools", () => {
      registerTool({ name: "a", description: "", inputSchema: {}, handler: async () => ({ content: [{ type: "text", text: "" }] }) });
      registerTool({ name: "b", description: "", inputSchema: {}, handler: async () => ({ content: [{ type: "text", text: "" }] }) });

      clearTools();
      expect(listTools()).toHaveLength(0);
    });
  });

  describe("handleMCPRequest", () => {
    it("should handle initialize", async () => {
      const req: MCPRequest = { jsonrpc: "2.0", id: 1, method: "initialize" };
      const res = await handleMCPRequest(req);

      expect(res.id).toBe(1);
      expect(res.result).toBeDefined();
      const result = res.result as Record<string, unknown>;
      expect(result.protocolVersion).toBe("2024-11-05");
      expect(result.serverInfo).toEqual({ name: "aibyai-mcp", version: "1.0.0" });
    });

    it("should handle tools/list", async () => {
      registerTool({
        name: "my_tool",
        description: "Does something",
        inputSchema: { type: "object" },
        handler: async () => ({ content: [{ type: "text", text: "" }] }),
      });

      const req: MCPRequest = { jsonrpc: "2.0", id: 2, method: "tools/list" };
      const res = await handleMCPRequest(req);

      const result = res.result as { tools: { name: string }[] };
      expect(result.tools).toHaveLength(1);
      expect(result.tools[0].name).toBe("my_tool");
    });

    it("should handle tools/call", async () => {
      registerTool({
        name: "echo",
        description: "Echoes input",
        inputSchema: {},
        handler: async (params) => ({
          content: [{ type: "text", text: `Echo: ${params.message}` }],
        }),
      });

      const req: MCPRequest = {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "echo", arguments: { message: "hello" } },
      };

      const res = await handleMCPRequest(req);

      const result = res.result as { content: { text: string }[] };
      expect(result.content[0].text).toBe("Echo: hello");
    });

    it("should return error for unknown tool", async () => {
      const req: MCPRequest = {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "nonexistent" },
      };

      const res = await handleMCPRequest(req);

      expect(res.error).toBeDefined();
      expect(res.error!.code).toBe(-32601);
      expect(res.error!.message).toContain("nonexistent");
    });

    it("should return error for unknown method", async () => {
      const req: MCPRequest = { jsonrpc: "2.0", id: 5, method: "unknown/method" };
      const res = await handleMCPRequest(req);

      expect(res.error).toBeDefined();
      expect(res.error!.code).toBe(-32601);
    });

    it("should handle handler errors gracefully", async () => {
      registerTool({
        name: "failing",
        description: "",
        inputSchema: {},
        handler: async () => { throw new Error("Handler crashed"); },
      });

      const req: MCPRequest = {
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: { name: "failing" },
      };

      const res = await handleMCPRequest(req);

      expect(res.error).toBeDefined();
      expect(res.error!.code).toBe(-32603);
      expect(res.error!.message).toBe("Handler crashed");
    });
  });

  describe("registerDefaultTools", () => {
    it("should register built-in deliberation tools", () => {
      registerDefaultTools();

      const tools = listTools();
      expect(tools.length).toBeGreaterThanOrEqual(3);

      const names = tools.map((t) => t.name);
      expect(names).toContain("deliberate");
      expect(names).toContain("search_knowledge");
      expect(names).toContain("generate_tests");
    });

    it("should have callable default tools", async () => {
      registerDefaultTools();

      const tool = getTool("deliberate");
      expect(tool).toBeDefined();

      const result = await tool!.handler({ topic: "Testing MCP" });
      expect(result.content[0].text).toContain("Testing MCP");
    });
  });
});
