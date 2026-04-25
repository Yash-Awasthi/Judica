import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/lib/logger.js", () => ({
  default: {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn().mockReturnThis(),
  },
}));

import {
  searchTools,
  getTool,
  publishTool,
  installTool,
  uninstallTool,
  listInstalledTools,
  toggleTool,
  updateToolConfig,
  getEnabledTools,
} from "../../src/services/toolFederation.service.js";

describe("toolFederation.service", () => {
  describe("searchTools", () => {
    it("returns built-in tools", () => {
      const { tools, total } = searchTools();
      expect(total).toBeGreaterThanOrEqual(3);
      expect(tools.some((t) => t.name === "Web Search")).toBe(true);
      expect(tools.some((t) => t.name === "Code Executor")).toBe(true);
    });

    it("filters by query", () => {
      const { tools } = searchTools({ query: "search" });
      expect(tools.every((t) =>
        t.name.toLowerCase().includes("search") ||
        t.description.toLowerCase().includes("search") ||
        t.tags.some((tag) => tag.includes("search")),
      )).toBe(true);
    });

    it("filters by category", () => {
      const { tools } = searchTools({ category: "code" });
      expect(tools.every((t) => t.category === "code")).toBe(true);
    });

    it("filters by verified status", () => {
      const { tools } = searchTools({ verified: true });
      expect(tools.every((t) => t.verified)).toBe(true);
    });

    it("supports pagination", () => {
      const { tools: page1 } = searchTools({ limit: 1, offset: 0 });
      const { tools: page2 } = searchTools({ limit: 1, offset: 1 });
      expect(page1).toHaveLength(1);
      expect(page2).toHaveLength(1);
      if (page1.length && page2.length) {
        expect(page1[0].id).not.toBe(page2[0].id);
      }
    });
  });

  describe("publishTool", () => {
    it("publishes a new tool to the registry", () => {
      const tool = publishTool({
        name: "Custom Analyzer",
        version: "1.0.0",
        description: "Analyze sentiment of text",
        author: "testuser",
        category: "analytics",
        schema: { inputSchema: { type: "object", properties: { text: { type: "string" } } } },
        tags: ["sentiment", "nlp"],
        verified: false,
      });

      expect(tool.id).toMatch(/^tool_/);
      expect(tool.downloads).toBe(0);
      expect(getTool(tool.id)).toBeDefined();
    });
  });

  describe("installTool / uninstallTool", () => {
    it("installs a tool for a user", () => {
      const { tools } = searchTools();
      const toolId = tools[0].id;

      const result = installTool(200, toolId);
      expect(result.success).toBe(true);

      const installedList = listInstalledTools(200);
      expect(installedList.some((t) => t.toolId === toolId)).toBe(true);
    });

    it("prevents duplicate installation", () => {
      const { tools } = searchTools();
      const toolId = tools[0].id;

      installTool(201, toolId);
      const result = installTool(201, toolId);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/already installed/);
    });

    it("returns error for nonexistent tool", () => {
      const result = installTool(200, "fake_tool");
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not found/);
    });

    it("uninstalls a tool", () => {
      const { tools } = searchTools();
      const toolId = tools[0].id;

      installTool(202, toolId);
      const removed = uninstallTool(202, toolId);
      expect(removed).toBe(true);
      expect(listInstalledTools(202).some((t) => t.toolId === toolId)).toBe(false);
    });
  });

  describe("toggleTool", () => {
    it("disables and re-enables a tool", () => {
      const { tools } = searchTools();
      const toolId = tools[0].id;
      installTool(203, toolId);

      toggleTool(203, toolId, false);
      expect(getEnabledTools(203).some((t) => t.toolId === toolId)).toBe(false);

      toggleTool(203, toolId, true);
      expect(getEnabledTools(203).some((t) => t.toolId === toolId)).toBe(true);
    });

    it("returns false for non-installed tool", () => {
      expect(toggleTool(999, "fake", true)).toBe(false);
    });
  });

  describe("updateToolConfig", () => {
    it("updates configuration for an installed tool", () => {
      const { tools } = searchTools();
      const toolId = tools[0].id;
      installTool(204, toolId);

      const updated = updateToolConfig(204, toolId, { apiKey: "sk-test", timeout: 5000 });
      expect(updated).toBe(true);

      const installedList = listInstalledTools(204);
      const tool = installedList.find((t) => t.toolId === toolId);
      expect(tool?.config).toEqual({ apiKey: "sk-test", timeout: 5000 });
    });
  });
});
