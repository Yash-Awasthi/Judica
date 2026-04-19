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
  reviewDiff,
  formatReviewSummary,
  type ReviewFinding,
  type ReviewSummary,
} from "../../src/services/prReview.service.js";

const sampleDiff = `
diff --git a/src/auth.ts b/src/auth.ts
--- a/src/auth.ts
+++ b/src/auth.ts
@@ -10,6 +10,8 @@
 export function authenticate(token: string) {
-  return jwt.verify(token, SECRET);
+  const decoded = jwt.verify(token, process.env.JWT_SECRET!);
+  console.log("User logged in:", decoded);
+  return decoded;
 }
`;

describe("prReview.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("reviewDiff", () => {
    it("should run triple review and aggregate findings", async () => {
      // Security perspective
      mockRouteAndCollect.mockResolvedValueOnce({
        text: JSON.stringify([
          { category: "security", severity: "warning", file: "src/auth.ts", line: 12, description: "Logging decoded token may expose PII", suggestion: "Remove or redact the log" },
        ]),
      });

      // Performance perspective
      mockRouteAndCollect.mockResolvedValueOnce({ text: "[]" });

      // Style perspective
      mockRouteAndCollect.mockResolvedValueOnce({
        text: JSON.stringify([
          { category: "style", severity: "info", file: "src/auth.ts", description: "Use a logger instead of console.log" },
        ]),
      });

      const result = await reviewDiff(sampleDiff);

      expect(result.findings).toHaveLength(2);
      expect(result.findings[0].category).toBe("security");
      expect(result.findings[1].category).toBe("style");
      expect(result.score.overall).toBeGreaterThan(0);
      expect(result.approved).toBe(true); // no critical, score should be > 70
    });

    it("should reject when critical findings exist", async () => {
      mockRouteAndCollect.mockResolvedValueOnce({
        text: JSON.stringify([
          { category: "security", severity: "critical", file: "src/auth.ts", description: "SQL injection vulnerability" },
        ]),
      });
      mockRouteAndCollect.mockResolvedValueOnce({ text: "[]" });
      mockRouteAndCollect.mockResolvedValueOnce({ text: "[]" });

      const result = await reviewDiff(sampleDiff);

      expect(result.approved).toBe(false);
      expect(result.findings).toHaveLength(1);
      expect(result.score.security).toBeLessThan(100);
    });

    it("should approve clean diffs", async () => {
      mockRouteAndCollect.mockResolvedValue({ text: "[]" });

      const result = await reviewDiff(sampleDiff);

      expect(result.approved).toBe(true);
      expect(result.findings).toHaveLength(0);
      expect(result.score.overall).toBe(100);
    });

    it("should handle perspective failures gracefully", async () => {
      mockRouteAndCollect
        .mockResolvedValueOnce({ text: "[]" })
        .mockRejectedValueOnce(new Error("LLM error"))
        .mockResolvedValueOnce({ text: "[]" });

      const result = await reviewDiff(sampleDiff);

      expect(result.approved).toBe(true);
      expect(result.findings).toHaveLength(0);
    });

    it("should calculate weighted scores correctly", async () => {
      // 2 security warnings = 100 - 20 = 80
      mockRouteAndCollect.mockResolvedValueOnce({
        text: JSON.stringify([
          { category: "security", severity: "warning", file: "a.ts", description: "issue 1" },
          { category: "security", severity: "warning", file: "a.ts", description: "issue 2" },
        ]),
      });
      // 1 performance critical = 100 - 25 = 75
      mockRouteAndCollect.mockResolvedValueOnce({
        text: JSON.stringify([
          { category: "performance", severity: "critical", file: "a.ts", description: "slow query" },
        ]),
      });
      // Clean style
      mockRouteAndCollect.mockResolvedValueOnce({ text: "[]" });

      const result = await reviewDiff(sampleDiff);

      expect(result.score.security).toBe(80);
      expect(result.score.performance).toBe(75);
      expect(result.score.style).toBe(100);
      // overall = 80*0.5 + 75*0.3 + 100*0.2 = 40 + 22.5 + 20 = 82.5 → 83
      expect(result.score.overall).toBe(83);
      // Has critical → not approved
      expect(result.approved).toBe(false);
    });
  });

  describe("formatReviewSummary", () => {
    it("should format clean review", () => {
      const score = { security: 100, performance: 100, style: 100, overall: 100 };
      const summary = formatReviewSummary([], score, true);

      expect(summary).toContain("Approved");
      expect(summary).toContain("Clean code");
      expect(summary).toContain("100/100");
    });

    it("should format review with findings", () => {
      const findings: ReviewFinding[] = [
        { category: "security", severity: "critical", file: "auth.ts", line: 5, description: "SQL injection", suggestion: "Use parameterized queries" },
        { category: "style", severity: "info", file: "utils.ts", description: "Use const instead of let" },
      ];
      const score = { security: 75, performance: 100, style: 97, overall: 87 };

      const summary = formatReviewSummary(findings, score, false);

      expect(summary).toContain("Changes Requested");
      expect(summary).toContain("Critical (1)");
      expect(summary).toContain("SQL injection");
      expect(summary).toContain("parameterized queries");
      expect(summary).toContain("Info (1)");
    });
  });
});
