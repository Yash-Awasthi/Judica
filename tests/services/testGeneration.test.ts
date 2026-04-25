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
  discoverEdgeCases,
  generateTests,
  generateTestSuite,
  formatTestFile,
  type TestGenerationResult,
} from "../../src/services/testGeneration.service.js";

const sampleCode = `
export function divide(a: number, b: number): number {
  if (b === 0) throw new Error("Division by zero");
  return a / b;
}
`;

describe("testGeneration.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("discoverEdgeCases", () => {
    it("should discover edge cases from multiple perspectives", async () => {
      mockRouteAndCollect.mockResolvedValue({
        text: JSON.stringify([
          { category: "boundary", description: "Test with zero divisor", severity: "critical" },
          { category: "boundary", description: "Test with very large numbers", severity: "medium" },
        ]),
      });

      const result = await discoverEdgeCases(sampleCode, "divide");

      // 4 perspectives × 2 edge cases each (but deduplication may reduce)
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].suggestedBy).toBeDefined();
    });

    it("should handle perspective failures gracefully", async () => {
      mockRouteAndCollect
        .mockResolvedValueOnce({ text: '[{"category": "boundary", "description": "zero test", "severity": "high"}]' })
        .mockRejectedValueOnce(new Error("LLM error"))
        .mockResolvedValueOnce({ text: "[]" })
        .mockResolvedValueOnce({ text: "invalid" });

      const result = await discoverEdgeCases(sampleCode, "divide");

      expect(result.length).toBeGreaterThanOrEqual(1);
    });

    it("should deduplicate similar edge cases", async () => {
      mockRouteAndCollect.mockResolvedValue({
        text: JSON.stringify([
          { category: "boundary", description: "Test division by zero", severity: "critical" },
        ]),
      });

      const result = await discoverEdgeCases(sampleCode, "divide");

      // All 4 perspectives return the same edge case — should be deduped
      const zeroTests = result.filter((ec) =>
        ec.description.toLowerCase().includes("division by zero")
      );
      expect(zeroTests.length).toBeLessThanOrEqual(1);
    });
  });

  describe("generateTests", () => {
    it("should generate test code from edge cases", async () => {
      mockRouteAndCollect.mockResolvedValue({
        text: JSON.stringify([
          {
            name: "should throw on division by zero",
            description: "Tests zero divisor",
            code: "it('should throw on division by zero', () => { expect(() => divide(1, 0)).toThrow(); })",
            category: "error_handling",
            edgeCases: ["zero divisor"],
          },
        ]),
      });

      const tests = await generateTests(
        sampleCode,
        "divide",
        [{ category: "boundary", description: "zero divisor", severity: "critical", suggestedBy: "boundary_analyst" }],
      );

      expect(tests).toHaveLength(1);
      expect(tests[0].code).toContain("divide");
      expect(tests[0].category).toBe("error_handling");
    });

    it("should return empty array on failure", async () => {
      mockRouteAndCollect.mockRejectedValue(new Error("LLM error"));

      const tests = await generateTests(sampleCode, "divide", []);
      expect(tests).toHaveLength(0);
    });
  });

  describe("generateTestSuite", () => {
    it("should run full pipeline: discover → generate → assess", async () => {
      // First 4 calls: edge case discovery (one per perspective)
      mockRouteAndCollect.mockResolvedValueOnce({
        text: '[{"category": "boundary", "description": "zero", "severity": "critical"}]',
      });
      mockRouteAndCollect.mockResolvedValueOnce({
        text: '[{"category": "error", "description": "NaN input", "severity": "high"}]',
      });
      mockRouteAndCollect.mockResolvedValueOnce({ text: "[]" });
      mockRouteAndCollect.mockResolvedValueOnce({ text: "[]" });

      // 5th call: test generation
      mockRouteAndCollect.mockResolvedValueOnce({
        text: JSON.stringify([
          { name: "happy path", description: "basic", code: "it('works', () => {})", category: "happy_path", edgeCases: [] },
          { name: "zero", description: "zero", code: "it('zero', () => {})", category: "edge_case", edgeCases: ["zero"] },
        ]),
      });

      const result = await generateTestSuite(sampleCode, "divide");

      expect(result.functionName).toBe("divide");
      expect(result.edgeCases.length).toBeGreaterThan(0);
      expect(result.tests.length).toBeGreaterThan(0);
      expect(result.coverage.happyPath).toBe(true);
      expect(result.coverage.edgeCases).toBe(true);
    });
  });

  describe("formatTestFile", () => {
    it("should format a complete TypeScript test file", () => {
      const result: TestGenerationResult = {
        functionName: "divide",
        language: "typescript",
        edgeCases: [],
        tests: [
          {
            name: "basic division",
            description: "Tests 10/2 = 5",
            code: "it('should divide 10 by 2', () => { expect(divide(10, 2)).toBe(5); })",
            category: "happy_path",
            edgeCases: [],
          },
        ],
        coverage: { happyPath: true, errorHandling: false, edgeCases: false, boundaryValues: false },
      };

      const file = formatTestFile(result, "./divide");

      expect(file).toContain('import { describe, it, expect } from "vitest"');
      expect(file).toContain('import { divide }');
      expect(file).toContain('describe("divide"');
      expect(file).toContain("divide(10, 2)");
    });
  });
});
