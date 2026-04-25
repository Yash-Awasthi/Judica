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

// Mock SSRF validation so addConnection doesn't reject test URLs
vi.mock("../../src/lib/ssrf.js", () => ({
  validateSafeUrl: vi.fn().mockResolvedValue("http://mocked"),
}));

import {
  addConnection,
  removeConnection,
  listConnections,
  getConnection,
  clearConnections,
  discoverTools,
  discoverAllTools,
  callTool,
} from "../../src/services/mcpClient.service.js";

describe("mcpClient.service", () => {
  beforeEach(() => {
    clearConnections();
  });

  describe("connection registry", () => {
    it("should add and retrieve a connection", async () => {
      await addConnection({ name: "github", url: "http://localhost:3001", transport: "http" });

      const conn = getConnection("github");
      expect(conn).toBeDefined();
      expect(conn!.name).toBe("github");
      expect(conn!.transport).toBe("http");
    });

    it("should list all connections", async () => {
      await addConnection({ name: "a", url: "http://a", transport: "http" });
      await addConnection({ name: "b", url: "http://b", transport: "sse" });

      expect(listConnections()).toHaveLength(2);
    });

    it("should remove a connection", async () => {
      await addConnection({ name: "temp", url: "http://temp", transport: "http" });

      expect(removeConnection("temp")).toBe(true);
      expect(getConnection("temp")).toBeUndefined();
      expect(removeConnection("nonexistent")).toBe(false);
    });
  });

  describe("discoverTools", () => {
    it("should discover tools from a remote server", async () => {
      await addConnection({ name: "github", url: "http://localhost:3001", transport: "http" });

      const mockFetch = vi.fn().mockResolvedValue({
        json: async () => ({
          result: {
            tools: [
              { name: "create_issue", description: "Create a GitHub issue", inputSchema: { type: "object" } },
              { name: "list_prs", description: "List pull requests", inputSchema: { type: "object" } },
            ],
          },
        }),
      });

      const tools = await discoverTools("github", mockFetch);

      expect(tools).toHaveLength(2);
      expect(tools[0].name).toBe("create_issue");
      expect(tools[0].serverName).toBe("github");
      expect(mockFetch).toHaveBeenCalledOnce();
    });

    it("should cache discovered tools", async () => {
      await addConnection({ name: "cached", url: "http://localhost:3001", transport: "http" });

      const mockFetch = vi.fn().mockResolvedValue({
        json: async () => ({ result: { tools: [{ name: "t1", description: "", inputSchema: {} }] } }),
      });

      await discoverTools("cached", mockFetch);
      await discoverTools("cached", mockFetch);

      expect(mockFetch).toHaveBeenCalledOnce(); // Second call uses cache
    });

    it("should throw for unknown server", async () => {
      await expect(discoverTools("nonexistent")).rejects.toThrow("Unknown MCP server");
    });
  });

  describe("discoverAllTools", () => {
    it("should discover tools from all servers", async () => {
      await addConnection({ name: "a", url: "http://a", transport: "http" });
      await addConnection({ name: "b", url: "http://b", transport: "http" });

      const mockFetch = vi.fn()
        .mockResolvedValueOnce({
          json: async () => ({ result: { tools: [{ name: "tool_a", description: "A", inputSchema: {} }] } }),
        })
        .mockResolvedValueOnce({
          json: async () => ({ result: { tools: [{ name: "tool_b", description: "B", inputSchema: {} }] } }),
        });

      const tools = await discoverAllTools(mockFetch);

      expect(tools).toHaveLength(2);
      expect(tools.map((t) => t.name).sort()).toEqual(["tool_a", "tool_b"]);
    });

    it("should handle partial failures gracefully", async () => {
      await addConnection({ name: "ok", url: "http://ok", transport: "http" });
      await addConnection({ name: "fail", url: "http://fail", transport: "http" });

      const mockFetch = vi.fn()
        .mockResolvedValueOnce({
          json: async () => ({ result: { tools: [{ name: "tool_ok", description: "", inputSchema: {} }] } }),
        })
        .mockRejectedValueOnce(new Error("Connection refused"));

      const tools = await discoverAllTools(mockFetch);

      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe("tool_ok");
    });
  });

  describe("callTool", () => {
    it("should call a tool on a remote server", async () => {
      await addConnection({ name: "github", url: "http://localhost:3001", transport: "http" });

      const mockFetch = vi.fn().mockResolvedValue({
        json: async () => ({
          result: {
            content: [{ type: "text", text: "Issue #42 created" }],
          },
        }),
      });

      const result = await callTool("github", "create_issue", { title: "Bug" }, mockFetch);

      expect(result.success).toBe(true);
      expect(result.content[0].text).toBe("Issue #42 created");
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("should return error for unknown server", async () => {
      const result = await callTool("nonexistent", "tool", {});

      expect(result.success).toBe(false);
      expect(result.error).toContain("Unknown MCP server");
    });

    it("should handle remote errors", async () => {
      await addConnection({ name: "err", url: "http://err", transport: "http" });

      const mockFetch = vi.fn().mockResolvedValue({
        json: async () => ({
          error: { code: -32601, message: "Unknown tool: bad_tool" },
        }),
      });

      const result = await callTool("err", "bad_tool", {}, mockFetch);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Unknown tool");
    });

    it("should handle network failures", async () => {
      await addConnection({ name: "down", url: "http://down", transport: "http" });

      const mockFetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

      const result = await callTool("down", "tool", {}, mockFetch);

      expect(result.success).toBe(false);
      expect(result.error).toBe("ECONNREFUSED");
    });

    it("should include headers from connection config", async () => {
      await addConnection({
        name: "auth",
        url: "http://auth",
        transport: "http",
        headers: { Authorization: "Bearer token123" },
      });

      const mockFetch = vi.fn().mockResolvedValue({
        json: async () => ({ result: { content: [] } }),
      });

      await callTool("auth", "tool", {}, mockFetch);

      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[1].headers.Authorization).toBe("Bearer token123");
    });
  });
});
