import {
  checkAndConsumeToolLimit,
  configureTool,
  clearToolConfig,
  getToolLimit,
  MCPRateLimitError,
} from "../../src/services/mcpRateLimit.service.js";
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../../src/lib/logger.js", () => ({
  default: {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
    child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
  },
}));

vi.mock("../../src/lib/redis.js", () => ({
  default: {
    get: vi.fn().mockResolvedValue(null),   // null = 0 count
    incr: vi.fn().mockResolvedValue(1),
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
      const { default: redis } = await import("../../src/lib/redis.js");
      // All counts are 0 (below limits)
      (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await expect(
        checkAndConsumeToolLimit("github", "search_code", 1)
      ).resolves.not.toThrow();
    });

    it("throws MCPRateLimitError when global limit exceeded", async () => {
      const { default: redis } = await import("../../src/lib/redis.js");
      // global count = 200 (at limit), server/tool = 0
      (redis.get as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce("200")  // global
        .mockResolvedValueOnce(null)   // server
        .mockResolvedValueOnce(null);  // tool

      await expect(
        checkAndConsumeToolLimit("github", "search_code", 1)
      ).rejects.toThrow(MCPRateLimitError);
    });

    it("throws MCPRateLimitError for tool-level limit", async () => {
      const { default: redis } = await import("../../src/lib/redis.js");
      // global and server ok, tool at default limit (20)
      (redis.get as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce("5")    // global
        .mockResolvedValueOnce("5")    // server
        .mockResolvedValueOnce("20");  // tool at default limit

      await expect(
        checkAndConsumeToolLimit("github", "search_code")
      ).rejects.toThrow(MCPRateLimitError);
    });

    it("MCPRateLimitError has correct properties", async () => {
      const { default: redis } = await import("../../src/lib/redis.js");
      (redis.get as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce("5")
        .mockResolvedValueOnce("5")
        .mockResolvedValueOnce("20");

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
      const { default: redis } = await import("../../src/lib/redis.js");
      // All counts below global/server limits, but tool limit is 0
      (redis.get as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(null)   // global
        .mockResolvedValueOnce(null)   // server
        .mockResolvedValueOnce(null);  // tool count=0, limit=0 → 0 >= 0 → blocked

      await expect(
        checkAndConsumeToolLimit("github", "delete_repo")
      ).rejects.toThrow(MCPRateLimitError);

      clearToolConfig("github", "delete_repo");
    });
  });
});
