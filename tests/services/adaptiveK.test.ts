import { describe, it, expect } from "vitest";
import { classifyQueryComplexity, getAdaptiveK } from "../../src/services/adaptiveK.service.js";

describe("adaptiveK.service", () => {
  describe("classifyQueryComplexity", () => {
    it("should classify simple factoid queries", () => {
      const result = classifyQueryComplexity("What is machine learning?");
      expect(result.level).toBe("simple");
      expect(result.k).toBe(3);
      expect(result.useHyde).toBe(false);
    });

    it("should classify yes/no questions as simple", () => {
      const result = classifyQueryComplexity("Is Python a programming language?");
      expect(result.level).toBe("simple");
      expect(result.k).toBe(3);
    });

    it("should classify moderate queries", () => {
      const result = classifyQueryComplexity(
        "How does the authentication middleware handle expired tokens?"
      );
      expect(result.level).toBe("moderate");
      expect(result.k).toBe(7);
    });

    it("should classify complex comparison queries", () => {
      const result = classifyQueryComplexity(
        "Compare the advantages and disadvantages of SQL and NoSQL databases for our use case"
      );
      expect(result.level).toBe("complex");
      expect(result.k).toBe(12);
    });

    it("should classify multi-question queries as complex", () => {
      const result = classifyQueryComplexity(
        "What is the current architecture? How does it handle scaling? What are the bottlenecks?"
      );
      expect(result.level).toBe("complex");
      expect(result.k).toBe(12);
      expect(result.reason).toContain("multiple questions");
    });

    it("should enable HyDE for abstract queries", () => {
      const result = classifyQueryComplexity("Why does the system sometimes return stale data?");
      expect(result.useHyde).toBe(true);
    });

    it("should not enable HyDE for simple lookups", () => {
      const result = classifyQueryComplexity("What is the API endpoint for login?");
      expect(result.useHyde).toBe(false);
    });

    it("should handle empty queries gracefully", () => {
      const result = classifyQueryComplexity("");
      expect(result.level).toBe("simple");
      expect(result.k).toBe(3);
    });

    it("should handle very long analytical queries as complex", () => {
      const result = classifyQueryComplexity(
        "Analyze the relationship between our caching strategy and the database query patterns, " +
        "evaluate whether the current approach is optimal, and explain how it impacts the overall system performance"
      );
      expect(result.level).toBe("complex");
      expect(result.k).toBe(12);
    });
  });

  describe("getAdaptiveK", () => {
    it("should return adaptive k based on query complexity", () => {
      const result = getAdaptiveK("What is X?");
      expect(result.k).toBe(3);
      expect(result.complexity.level).toBe("simple");
    });

    it("should respect override k when provided", () => {
      const result = getAdaptiveK("What is X?", 20);
      expect(result.k).toBe(20);
    });

    it("should still compute useHyde even with override k", () => {
      const result = getAdaptiveK("Why does the authentication system sometimes fail under load?", 10);
      expect(result.k).toBe(10);
      expect(result.useHyde).toBe(true);
    });

    it("should ignore non-positive override", () => {
      const result = getAdaptiveK("Compare the advantages and disadvantages of A and B, and analyze their differences", 0);
      expect(result.complexity.level).toBe("complex");
      expect(result.k).toBe(12);
    });
  });
});
