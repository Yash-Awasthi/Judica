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

// Mock router
const mockRouteAndCollect = vi.fn();
vi.mock("../../src/router/index.js", () => ({
  routeAndCollect: (...args: unknown[]) => mockRouteAndCollect(...args),
}));

import {
  executeChain,
  buildChainFromDescription,
  CHAIN_TEMPLATES,
  type ToolChain,
} from "../../src/services/toolChain.service.js";

describe("toolChain.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRouteAndCollect.mockResolvedValue({ text: "Mock output" });
  });

  describe("executeChain", () => {
    it("should execute a simple chain sequentially", async () => {
      const chain: ToolChain = {
        id: "test-chain",
        name: "Test",
        steps: [
          { id: "s1", tool: "summarize", input: "Some text" },
          { id: "s2", tool: "transform", input: "Format output" },
        ],
        createdAt: "",
      };

      const result = await executeChain(chain);

      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(2);
      expect(result.results[0].success).toBe(true);
      expect(result.results[1].success).toBe(true);
      expect(result.finalOutput).toBe("Mock output");
    });

    it("should pass previous output to next step", async () => {
      mockRouteAndCollect
        .mockResolvedValueOnce({ text: "Step 1 output" })
        .mockResolvedValueOnce({ text: "Step 2 output" });

      const chain: ToolChain = {
        id: "test",
        name: "Test",
        steps: [
          { id: "s1", tool: "web_search", input: "query" },
          { id: "s2", tool: "analyze", input: "analyze this" },
        ],
        createdAt: "",
      };

      const result = await executeChain(chain);

      expect(result.results[0].output).toBe("Step 1 output");
      // Second call should include previous output
      const secondCall = mockRouteAndCollect.mock.calls[1][0];
      expect(secondCall.messages[0].content).toContain("Step 1 output");
    });

    it("should stop on failure by default", async () => {
      mockRouteAndCollect
        .mockResolvedValueOnce({ text: "OK" })
        .mockRejectedValueOnce(new Error("API failed"))
        .mockResolvedValueOnce({ text: "Should not reach" });

      const chain: ToolChain = {
        id: "test",
        name: "Test",
        steps: [
          { id: "s1", tool: "summarize", input: "a" },
          { id: "s2", tool: "analyze", input: "b" },
          { id: "s3", tool: "generate", input: "c" },
        ],
        createdAt: "",
      };

      const result = await executeChain(chain);

      expect(result.success).toBe(false);
      expect(result.results).toHaveLength(2); // stopped after s2
      expect(result.results[1].success).toBe(false);
    });

    it("should continue on error when configured", async () => {
      // Reset and set up fresh mock chain
      mockRouteAndCollect.mockReset();
      mockRouteAndCollect
        .mockResolvedValueOnce({ text: "OK" })
        .mockRejectedValueOnce(new Error("Fail"))
        .mockResolvedValueOnce({ text: "Recovered" });

      const chain: ToolChain = {
        id: "test",
        name: "Test",
        steps: [
          { id: "s1", tool: "summarize", input: "a" },
          { id: "s2", tool: "analyze", input: "b" },
          { id: "s3", tool: "generate", input: "c" },
        ],
        createdAt: "",
      };

      const result = await executeChain(chain, { continueOnError: true });

      expect(result.results).toHaveLength(3);
      expect(result.results[0].success).toBe(true);
      expect(result.results[1].success).toBe(false);
      expect(result.results[1].error).toBe("Fail");
      expect(result.results[2].success).toBe(true);
      expect(result.success).toBe(false);
    });

    it("should call onStep callback for each step", async () => {
      const onStep = vi.fn();

      const chain: ToolChain = {
        id: "test",
        name: "Test",
        steps: [
          { id: "s1", tool: "summarize", input: "a" },
          { id: "s2", tool: "analyze", input: "b" },
        ],
        createdAt: "",
      };

      await executeChain(chain, { onStep });
      expect(onStep).toHaveBeenCalledTimes(2);
    });

    it("should track duration for each step", async () => {
      const chain: ToolChain = {
        id: "test",
        name: "Test",
        steps: [{ id: "s1", tool: "summarize", input: "a" }],
        createdAt: "",
      };

      const result = await executeChain(chain);
      expect(result.results[0].durationMs).toBeGreaterThanOrEqual(0);
      expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe("buildChainFromDescription", () => {
    it("should build a chain from natural language", async () => {
      mockRouteAndCollect.mockResolvedValue({
        text: JSON.stringify({
          name: "Market Research",
          steps: [
            { id: "s1", tool: "web_search", input: "latest market trends in AI" },
            { id: "s2", tool: "analyze", input: "analyze the trends" },
          ],
        }),
      });

      const chain = await buildChainFromDescription("Research AI market trends and analyze them");

      expect(chain.id).toMatch(/^chain_/);
      expect(chain.name).toBe("Market Research");
      expect(chain.steps).toHaveLength(2);
      expect(chain.steps[0].tool).toBe("web_search");
    });

    it("should throw on invalid LLM response", async () => {
      mockRouteAndCollect.mockResolvedValue({ text: "Not JSON" });

      await expect(
        buildChainFromDescription("do something")
      ).rejects.toThrow("Failed to parse");
    });
  });

  describe("CHAIN_TEMPLATES", () => {
    it("should have research_report template", () => {
      expect(CHAIN_TEMPLATES.research_report).toBeDefined();
      expect(CHAIN_TEMPLATES.research_report.steps.length).toBeGreaterThan(0);
    });

    it("should have competitive_analysis template", () => {
      expect(CHAIN_TEMPLATES.competitive_analysis).toBeDefined();
    });

    it("should have data_pipeline template", () => {
      expect(CHAIN_TEMPLATES.data_pipeline).toBeDefined();
    });

    it("all templates should have valid tool types", () => {
      const validTools = ["web_search", "extract", "analyze", "summarize", "transform", "generate"];
      for (const [name, chain] of Object.entries(CHAIN_TEMPLATES)) {
        for (const step of chain.steps) {
          expect(validTools, `Template ${name}, step ${step.id}`).toContain(step.tool);
        }
      }
    });
  });
});
