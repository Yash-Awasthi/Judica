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
  generateMermaidDiagram,
  detectDiagramType,
  generateChartSpec,
  visualizeDeliberation,
  formatVisualOutputs,
  type VisualOutput,
} from "../../src/services/visualOutput.service.js";

describe("visualOutput.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("detectDiagramType", () => {
    it("should detect flowchart", () => {
      expect(detectDiagramType("Show the workflow for user signup")).toBe("flowchart");
    });

    it("should detect sequence diagram", () => {
      expect(detectDiagramType("Show the API request/response interaction")).toBe("sequence");
    });

    it("should detect class diagram", () => {
      expect(detectDiagramType("Show the class inheritance hierarchy")).toBe("classDiagram");
    });

    it("should detect ER diagram", () => {
      expect(detectDiagramType("Show the database entity relationships")).toBe("erDiagram");
    });

    it("should detect state diagram", () => {
      expect(detectDiagramType("Show the order status lifecycle transitions")).toBe("stateDiagram");
    });

    it("should detect gantt chart", () => {
      expect(detectDiagramType("Show the sprint timeline and milestones")).toBe("gantt");
    });

    it("should detect pie chart", () => {
      expect(detectDiagramType("Show the percentage distribution of votes")).toBe("pie");
    });

    it("should detect mindmap", () => {
      expect(detectDiagramType("Brainstorm ideas for the product")).toBe("mindmap");
    });

    it("should default to flowchart", () => {
      expect(detectDiagramType("Something generic")).toBe("flowchart");
    });
  });

  describe("generateMermaidDiagram", () => {
    it("should generate a mermaid diagram", async () => {
      mockRouteAndCollect.mockResolvedValue({
        text: JSON.stringify({
          title: "User Auth Flow",
          content: "flowchart TD\n  A[Login] --> B{Valid?}\n  B -->|Yes| C[Dashboard]\n  B -->|No| D[Error]",
          description: "Authentication flow diagram",
        }),
      });

      const result = await generateMermaidDiagram("User authentication flow");

      expect(result.type).toBe("mermaid");
      expect(result.title).toBe("User Auth Flow");
      expect(result.content).toContain("flowchart");
    });

    it("should return empty on failure", async () => {
      mockRouteAndCollect.mockRejectedValue(new Error("LLM error"));

      const result = await generateMermaidDiagram("anything");

      expect(result.type).toBe("mermaid");
      expect(result.content).toBe("");
    });
  });

  describe("generateChartSpec", () => {
    it("should generate a chart spec", async () => {
      mockRouteAndCollect.mockResolvedValue({
        text: JSON.stringify({
          chartType: "bar",
          title: "Sales by Region",
          data: { labels: ["North", "South", "East", "West"], datasets: [{ label: "Revenue", values: [100, 80, 120, 90] }] },
          description: "Regional sales comparison",
        }),
      });

      const spec = await generateChartSpec("Regional sales data", "Compare sales across regions");

      expect(spec).not.toBeNull();
      expect(spec!.chartType).toBe("bar");
      expect(spec!.data.labels).toHaveLength(4);
      expect(spec!.data.datasets[0].values).toHaveLength(4);
    });

    it("should return null on failure", async () => {
      mockRouteAndCollect.mockRejectedValue(new Error("LLM error"));

      const spec = await generateChartSpec("data", "chart");
      expect(spec).toBeNull();
    });
  });

  describe("visualizeDeliberation", () => {
    it("should generate mindmap and table outputs", async () => {
      const opinions = [
        { agent: "Analyst", position: "We should invest in cloud infrastructure", confidence: 0.85 },
        { agent: "Engineer", position: "On-premise gives better control", confidence: 0.72 },
        { agent: "Finance", position: "Cloud has lower TCO long-term", confidence: 0.68 },
      ];

      const outputs = await visualizeDeliberation("Infrastructure Strategy", opinions);

      expect(outputs).toHaveLength(2);
      expect(outputs[0].type).toBe("mermaid");
      expect(outputs[0].content).toContain("mindmap");
      expect(outputs[0].content).toContain("Analyst");
      expect(outputs[1].type).toBe("table");
      expect(outputs[1].content).toContain("85%");
      expect(outputs[1].content).toContain("72%");
    });
  });

  describe("formatVisualOutputs", () => {
    it("should format mermaid and table outputs as markdown", () => {
      const outputs: VisualOutput[] = [
        { type: "mermaid", content: "flowchart TD\n  A --> B", title: "Flow", description: "A simple flow" },
        { type: "table", content: "| A | B |\n|---|---|\n| 1 | 2 |", title: "Data", description: "Sample data" },
      ];

      const md = formatVisualOutputs(outputs);

      expect(md).toContain("### Flow");
      expect(md).toContain("```mermaid");
      expect(md).toContain("flowchart TD");
      expect(md).toContain("```");
      expect(md).toContain("### Data");
      expect(md).toContain("| A | B |");
    });
  });
});
