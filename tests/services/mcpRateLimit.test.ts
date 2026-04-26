import {
  checkAndConsumeToolLimit,
  configureTool,
  clearToolConfig,
  getToolLimit,
  MCPRateLimitError,
} from "../../services/mcpRateLimit.service.js";
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../../lib/redis.js", () => ({
  default: {
    zadd: vi.fn().mockResolvedValue(1),
    zremrangebyscore: vi.fn().mockResolvedValue(0),
    zcard: vi.fn().mockResolvedValue(1),
    zcount: vi.fn().mockResolvedValue(0),
    expire: vi.fn().mockResolvedValue(1),
  },
}));

describe("mcpRateLimit.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearToolConfig("github", "search_code");
    clearToolConfig("github", "create_issue");
  });

  describe("checkAndConsumeToolLimit", () => {
    it("allows calls below the limit", async () => {
      const { default: redis } = await import("../../lib/redis.js");
      (redis.zcount as ReturnType<typeof vi.fn>).mockResolvedValue(0);

      await expect(
        checkAndConsumeToolLimit("github", "search_code", 1)
      ).resolves.not.toThrow();
    });

    it("throws MCPRateLimitError when global limit exceeded", async () => {
      const { default: redis } = await import("../../lib/redis.js");
      // First zcount (global) returns 200 (at limit)
      (redis.zcount as ReturnType<typeof vi.fn>).mockResolvedValueOnce(200);

      await expect(
        checkAndConsumeToolLimit("github", "search_code", 1)
      ).rejects.toThrow(MCPRateLimitError);
    });

    it("throws MCPRateLimitError for tool-level limit", async () => {
      const { default: redis } = await import("../../lib/redis.js");
      // global ok, server ok, tool at limit
      (redis.zcount as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(5)   // global
        .mockResolvedValueOnce(5)   // server
        .mockResolvedValueOnce(20); // tool at default limit

      await expect(
        checkAndConsumeToolLimit("github", "search_code")
      ).rejects.toThrow(MCPRateLimitError);
    });

    it("MCPRateLimitError has correct properties", async () => {
      const { default: redis } = await import("../../lib/redis.js");
      (redis.zcount as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(5)
        .mockResolvedValueOnce(5)
        .mockResolvedValueOnce(20);

      try {
        await checkAndConsumeToolLimit("github", "search_code");
        expect(true).toBe(false); // should not reach here
      } catch (err) {
        expect(err).toBeInstanceOf(MCPRateLimitError);
        const e = err as MCPRateLimitError;
        expect(e.toolName).toBe("search_code");
        expect(e.serverName).toBe("github");
        expect(e.limitType).toBe("tool");
        expect(e.retryAfterMs).toBeGreaterThan(0);
      }
    });
  });

  describe("configureTool", () => {
    it("sets a custom limit for a tool", () => {
      configureTool("github", "create_issue", { callsPerMinute: 5 });
      expect(getToolLimit("github", "create_issue")).toBe(5);
    });

    it("reverts to default after clearToolConfig", () => {
      configureTool("github", "create_issue", { callsPerMinute: 5 });
      clearToolConfig("github", "create_issue");
      expect(getToolLimit("github", "create_issue")).toBe(
        parseInt(process.env.MCP_TOOL_RPM ?? "20", 10)
      );
    });

    it("setting limit to 0 blocks the tool", async () => {
      configureTool("github", "delete_repo", { callsPerMinute: 0 });
      const { default: redis } = await import("../../lib/redis.js");
      // All counts below global/server limits
      (redis.zcount as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(0)  // global
        .mockResolvedValueOnce(0)  // server
        .mockResolvedValueOnce(0); // tool (0 >= 0 → blocked)

      await expect(
        checkAndConsumeToolLimit("github", "delete_repo")
      ).rejects.toThrow(MCPRateLimitError);

      clearToolConfig("github", "delete_repo");
    });
  });
});
