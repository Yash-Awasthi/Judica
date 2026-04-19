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
  detectOpportunities,
  generateDiff,
  analyzeSafety,
  refactorCode,
  formatSummary,
  type RefactoringOpportunity,
  type SafetyAnalysis,
} from "../../src/services/refactoring.service.js";

const sampleCode = `
export function processItems(items: any[]) {
  let result = [];
  for (let i = 0; i < items.length; i++) {
    if (items[i] !== null && items[i] !== undefined && items[i] !== "") {
      const val = items[i].toString().trim().toLowerCase();
      if (val.length > 0) {
        result.push(val);
      }
    }
  }
  return result;
}
`;

describe("refactoring.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("detectOpportunities", () => {
    it("should detect refactoring opportunities", async () => {
      mockRouteAndCollect.mockResolvedValue({
        text: JSON.stringify([
          {
            type: "simplify_conditional",
            description: "Nested null checks can use optional chaining",
            severity: "suggestion",
            location: { startLine: 4, endLine: 6 },
            effort: "trivial",
          },
          {
            type: "improve_typing",
            description: "Replace any[] with a proper type",
            severity: "warning",
            location: { startLine: 1, endLine: 1 },
            effort: "small",
          },
        ]),
      });

      const ops = await detectOpportunities(sampleCode);

      expect(ops).toHaveLength(2);
      expect(ops[0].type).toBe("simplify_conditional");
      expect(ops[1].severity).toBe("warning");
    });

    it("should return empty array on failure", async () => {
      mockRouteAndCollect.mockRejectedValue(new Error("LLM error"));

      const ops = await detectOpportunities(sampleCode);
      expect(ops).toHaveLength(0);
    });

    it("should return empty array on non-JSON response", async () => {
      mockRouteAndCollect.mockResolvedValue({ text: "I cannot analyze that code." });

      const ops = await detectOpportunities(sampleCode);
      expect(ops).toHaveLength(0);
    });
  });

  describe("generateDiff", () => {
    it("should generate a diff for an opportunity", async () => {
      const opportunity: RefactoringOpportunity = {
        type: "simplify_conditional",
        description: "Simplify nested null checks",
        severity: "suggestion",
        location: { startLine: 4, endLine: 6 },
        effort: "trivial",
      };

      mockRouteAndCollect.mockResolvedValue({
        text: JSON.stringify({
          original: "if (items[i] !== null && items[i] !== undefined)",
          refactored: "if (items[i] != null)",
          explanation: "Use loose equality to check for both null and undefined",
        }),
      });

      const diff = await generateDiff(sampleCode, opportunity);

      expect(diff).not.toBeNull();
      expect(diff!.original).toContain("null");
      expect(diff!.refactored).toContain("null");
      expect(diff!.opportunity).toBe(opportunity);
    });

    it("should return null on failure", async () => {
      const opportunity: RefactoringOpportunity = {
        type: "rename",
        description: "Rename",
        severity: "suggestion",
        location: { startLine: 1, endLine: 1 },
        effort: "trivial",
      };

      mockRouteAndCollect.mockRejectedValue(new Error("LLM error"));

      const diff = await generateDiff(sampleCode, opportunity);
      expect(diff).toBeNull();
    });
  });

  describe("analyzeSafety", () => {
    it("should analyze safety of a refactoring", async () => {
      mockRouteAndCollect.mockResolvedValue({
        text: JSON.stringify({
          safe: true,
          risks: [],
          behaviorPreserved: true,
          typeCompatible: true,
          publicAPIChanged: false,
        }),
      });

      const analysis = await analyzeSafety(sampleCode, "const refactored = true;");

      expect(analysis.safe).toBe(true);
      expect(analysis.behaviorPreserved).toBe(true);
      expect(analysis.risks).toHaveLength(0);
    });

    it("should detect unsafe refactoring", async () => {
      mockRouteAndCollect.mockResolvedValue({
        text: JSON.stringify({
          safe: false,
          risks: [{ level: "error", description: "Return type changed", mitigation: "Update callers" }],
          behaviorPreserved: false,
          typeCompatible: false,
          publicAPIChanged: true,
        }),
      });

      const analysis = await analyzeSafety(sampleCode, "completely different code");

      expect(analysis.safe).toBe(false);
      expect(analysis.publicAPIChanged).toBe(true);
      expect(analysis.risks).toHaveLength(1);
      expect(analysis.risks[0].level).toBe("error");
    });

    it("should return default unsafe analysis on failure", async () => {
      mockRouteAndCollect.mockRejectedValue(new Error("LLM error"));

      const analysis = await analyzeSafety(sampleCode, "code");

      expect(analysis.safe).toBe(false);
      expect(analysis.risks.length).toBeGreaterThan(0);
    });
  });

  describe("refactorCode", () => {
    it("should run full pipeline: detect → diff → safety", async () => {
      // Call 1: detect opportunities
      mockRouteAndCollect.mockResolvedValueOnce({
        text: JSON.stringify([
          {
            type: "improve_typing",
            description: "Replace any[]",
            severity: "warning",
            location: { startLine: 1, endLine: 1 },
            effort: "small",
          },
        ]),
      });

      // Call 2: generate diff
      mockRouteAndCollect.mockResolvedValueOnce({
        text: JSON.stringify({
          original: "items: any[]",
          refactored: "items: string[]",
          explanation: "Use string[] for type safety",
        }),
      });

      // Call 3: safety analysis
      mockRouteAndCollect.mockResolvedValueOnce({
        text: JSON.stringify({
          safe: true,
          risks: [],
          behaviorPreserved: true,
          typeCompatible: true,
          publicAPIChanged: false,
        }),
      });

      const result = await refactorCode(sampleCode);

      expect(result.opportunities).toHaveLength(1);
      expect(result.diffs).toHaveLength(1);
      expect(result.safety.safe).toBe(true);
      expect(result.summary).toContain("Refactoring Analysis");
    });

    it("should filter by types when specified", async () => {
      mockRouteAndCollect.mockResolvedValueOnce({
        text: JSON.stringify([
          { type: "rename", description: "rename x", severity: "suggestion", location: { startLine: 1, endLine: 1 }, effort: "trivial" },
          { type: "dead_code", description: "remove unused", severity: "warning", location: { startLine: 5, endLine: 5 }, effort: "trivial" },
          { type: "performance", description: "optimize loop", severity: "suggestion", location: { startLine: 3, endLine: 8 }, effort: "medium" },
        ]),
      });

      // Diff for the one matching opportunity
      mockRouteAndCollect.mockResolvedValueOnce({
        text: JSON.stringify({
          original: "unused code",
          refactored: "",
          explanation: "Removed dead code",
        }),
      });

      // Safety
      mockRouteAndCollect.mockResolvedValueOnce({
        text: JSON.stringify({ safe: true, risks: [], behaviorPreserved: true, typeCompatible: true, publicAPIChanged: false }),
      });

      const result = await refactorCode(sampleCode, "typescript", { types: ["dead_code"] });

      expect(result.opportunities).toHaveLength(1);
      expect(result.opportunities[0].type).toBe("dead_code");
    });

    it("should limit opportunities by maxOpportunities", async () => {
      mockRouteAndCollect.mockResolvedValueOnce({
        text: JSON.stringify([
          { type: "rename", description: "a", severity: "suggestion", location: { startLine: 1, endLine: 1 }, effort: "trivial" },
          { type: "rename", description: "b", severity: "suggestion", location: { startLine: 2, endLine: 2 }, effort: "trivial" },
          { type: "rename", description: "c", severity: "suggestion", location: { startLine: 3, endLine: 3 }, effort: "trivial" },
        ]),
      });

      // Only 1 diff (maxOpportunities=1)
      mockRouteAndCollect.mockResolvedValueOnce({
        text: JSON.stringify({ original: "a", refactored: "b", explanation: "renamed" }),
      });

      // Safety
      mockRouteAndCollect.mockResolvedValueOnce({
        text: JSON.stringify({ safe: true, risks: [], behaviorPreserved: true, typeCompatible: true, publicAPIChanged: false }),
      });

      const result = await refactorCode(sampleCode, "typescript", { maxOpportunities: 1 });

      expect(result.opportunities).toHaveLength(1);
    });
  });

  describe("formatSummary", () => {
    it("should format a readable summary", () => {
      const opportunities: RefactoringOpportunity[] = [
        { type: "dead_code", description: "Remove unused variable", severity: "warning", location: { startLine: 5, endLine: 5 }, effort: "trivial" },
        { type: "simplify_conditional", description: "Flatten nested if", severity: "suggestion", location: { startLine: 3, endLine: 8 }, effort: "small" },
      ];

      const safety: SafetyAnalysis = {
        safe: true,
        risks: [],
        behaviorPreserved: true,
        typeCompatible: true,
        publicAPIChanged: false,
      };

      const summary = formatSummary(opportunities, [], safety);

      expect(summary).toContain("2");
      expect(summary).toContain("dead_code");
      expect(summary).toContain("Safe to apply");
    });

    it("should show risks when present", () => {
      const safety: SafetyAnalysis = {
        safe: false,
        risks: [{ level: "error", description: "API contract broken" }],
        behaviorPreserved: false,
        typeCompatible: true,
        publicAPIChanged: true,
      };

      const summary = formatSummary([], [], safety);

      expect(summary).toContain("Review required");
      expect(summary).toContain("API contract broken");
    });
  });
});
