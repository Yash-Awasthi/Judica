import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/lib/logger.js", () => ({
  default: {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn().mockReturnThis(),
  },
}));

import {
  registerNodeType,
  listNodeTypes,
  getNodeType,
  executeNode,
  unregisterNodeType,
  validateInputs,
  _reset,
} from "../../src/services/customWorkflowNodes.service.js";

describe("customWorkflowNodes.service", () => {
  beforeEach(() => {
    _reset();
  });

  describe("built-in types", () => {
    it("seeds 3 built-in node types", () => {
      const all = listNodeTypes();
      expect(all.length).toBeGreaterThanOrEqual(3);
      expect(getNodeType("custom_llm")).toBeDefined();
      expect(getNodeType("custom_transform")).toBeDefined();
      expect(getNodeType("custom_filter")).toBeDefined();
    });

    it("built-in custom_llm is in category 'ai'", () => {
      const node = getNodeType("custom_llm")!;
      expect(node.category).toBe("ai");
    });
  });

  describe("registerNodeType", () => {
    it("registers a new node type and returns it", () => {
      const node = registerNodeType({
        id: "my_node",
        name: "My Node",
        description: "Test node",
        category: "test",
        inputSchema: { x: { required: true, type: "number" } },
        outputSchema: { y: { type: "number" } },
        handler: (inputs) => ({ y: (inputs.x as number) * 2 }),
      });
      expect(node.id).toBe("my_node");
      expect(getNodeType("my_node")).toBeDefined();
    });

    it("generates an id when none provided", () => {
      const node = registerNodeType({
        name: "Auto ID",
        description: "No ID given",
        category: "test",
        inputSchema: {},
        outputSchema: {},
        handler: () => ({}),
      });
      expect(node.id).toBeTruthy();
      expect(node.id.length).toBeGreaterThan(0);
    });

    it("throws if id already exists", () => {
      expect(() =>
        registerNodeType({
          id: "custom_llm",
          name: "Dup",
          description: "Duplicate",
          category: "ai",
          inputSchema: {},
          outputSchema: {},
          handler: () => ({}),
        }),
      ).toThrow("already registered");
    });
  });

  describe("listNodeTypes", () => {
    it("filters by category", () => {
      const aiNodes = listNodeTypes("ai");
      expect(aiNodes.every((n) => n.category === "ai")).toBe(true);
    });

    it("returns all when no category given", () => {
      const all = listNodeTypes();
      expect(all.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe("executeNode", () => {
    it("executes a built-in node", async () => {
      const result = await executeNode("custom_llm", { prompt: "Hello" });
      expect(result.response).toContain("Hello");
    });

    it("executes a custom registered node", async () => {
      registerNodeType({
        id: "doubler",
        name: "Doubler",
        description: "Doubles x",
        category: "math",
        inputSchema: { x: { required: true, type: "number" } },
        outputSchema: { y: { type: "number" } },
        handler: (inputs) => ({ y: (inputs.x as number) * 2 }),
      });
      const result = await executeNode("doubler", { x: 5 });
      expect(result.y).toBe(10);
    });

    it("throws if node not found", async () => {
      await expect(executeNode("nonexistent", {})).rejects.toThrow("not found");
    });
  });

  describe("unregisterNodeType", () => {
    it("removes a registered node type", () => {
      registerNodeType({
        id: "temp",
        name: "Temp",
        description: "Temporary",
        category: "test",
        inputSchema: {},
        outputSchema: {},
        handler: () => ({}),
      });
      expect(unregisterNodeType("temp")).toBe(true);
      expect(getNodeType("temp")).toBeUndefined();
    });

    it("returns false for non-existent node", () => {
      expect(unregisterNodeType("nope")).toBe(false);
    });
  });

  describe("validateInputs", () => {
    it("returns valid when all required inputs present", () => {
      const result = validateInputs("custom_llm", { prompt: "hi" });
      expect(result.valid).toBe(true);
      expect(result.missing).toHaveLength(0);
    });

    it("returns missing keys when required inputs absent", () => {
      const result = validateInputs("custom_llm", {});
      expect(result.valid).toBe(false);
      expect(result.missing).toContain("prompt");
    });

    it("throws if node not found", () => {
      expect(() => validateInputs("nope", {})).toThrow("not found");
    });
  });
});
