import { describe, it, expect } from "vitest";
import { classifyQueryComplexity, getAdaptiveK } from "../../src/services/adaptiveK.service.js";

describe("adaptiveK.service", () => {
  describe("classifyQueryComplexity — simple queries", () => {
    it('classifies "what is X" as simple with k=3 and useHyde=false', () => {
      const result = classifyQueryComplexity("What is machine learning?");
      expect(result.level).toBe("simple");
      expect(result.k).toBe(3);
      expect(result.useHyde).toBe(false);
    });

    it('classifies "who is X" as simple', () => {
      const result = classifyQueryComplexity("Who is Alan Turing?");
      expect(result.level).toBe("simple");
      expect(result.k).toBe(3);
      expect(result.useHyde).toBe(false);
    });

    it('classifies "define X" as simple', () => {
      const result = classifyQueryComplexity("Define polymorphism");
      expect(result.level).toBe("simple");
      expect(result.k).toBe(3);
      expect(result.useHyde).toBe(false);
    });

    it('classifies "what does X mean" as simple', () => {
      const result = classifyQueryComplexity("What does idempotent mean?");
      expect(result.level).toBe("simple");
      expect(result.k).toBe(3);
      expect(result.useHyde).toBe(false);
    });

    it('classifies "how many X" as simple', () => {
      const result = classifyQueryComplexity("How many endpoints does the API have?");
      expect(result.level).toBe("simple");
      expect(result.k).toBe(3);
    });

    it('classifies boolean yes/no questions as simple', () => {
      const result = classifyQueryComplexity("Is TypeScript a superset of JavaScript?");
      expect(result.level).toBe("simple");
      expect(result.k).toBe(3);
    });

    it("returns a reason string for simple queries", () => {
      const result = classifyQueryComplexity("What is Redis?");
      expect(result.reason).toBeTruthy();
      expect(typeof result.reason).toBe("string");
    });
  });

  describe("classifyQueryComplexity — multiple question marks → complex", () => {
    it("classifies 2 question marks as complex with k=12 and useHyde=true", () => {
      const result = classifyQueryComplexity("What is caching? How does it improve performance?");
      expect(result.level).toBe("complex");
      expect(result.k).toBe(12);
      expect(result.useHyde).toBe(true);
    });

    it("classifies 3 question marks as complex", () => {
      const result = classifyQueryComplexity(
        "What is the architecture? How does it scale? What are the bottlenecks?"
      );
      expect(result.level).toBe("complex");
      expect(result.k).toBe(12);
      expect(result.useHyde).toBe(true);
    });

    it('includes "multiple questions" in the reason when 2+ question marks', () => {
      const result = classifyQueryComplexity("What is X? What is Y?");
      expect(result.reason).toContain("multiple questions");
    });
  });

  describe("classifyQueryComplexity — complex indicators", () => {
    it('classifies "compare X and Y" combined with a long query as complex', () => {
      // Two complex indicators (compare...and + advantages and disadvantages) push score >= 3
      const result = classifyQueryComplexity(
        "Compare the advantages and disadvantages of SQL and NoSQL databases for our use case"
      );
      expect(result.level).toBe("complex");
      expect(result.k).toBe(12);
    });

    it('classifies a single "analyze" indicator as at least moderate', () => {
      // One complex indicator (+2) with short word count (0) = score 2 → moderate
      const result = classifyQueryComplexity(
        "Analyze the performance characteristics of this caching layer"
      );
      expect(result.level).not.toBe("simple");
      expect(result.k).toBeGreaterThan(3);
    });

    it('classifies "analyze" + long query as complex', () => {
      // One complex indicator (+2) + word count >30 (+2) = score 4 → complex
      const result = classifyQueryComplexity(
        "Analyze the relationship between our caching strategy and the database query patterns to determine whether the current approach is optimal and sustainable"
      );
      expect(result.level).toBe("complex");
      expect(result.k).toBe(12);
    });

    it('classifies "contrast" indicator as at least moderate', () => {
      const result = classifyQueryComplexity(
        "Contrast the approaches taken in functional vs object-oriented programming"
      );
      expect(result.level).not.toBe("simple");
      expect(result.k).toBeGreaterThan(3);
    });

    it('classifies "pros and cons" combined with a long query as complex', () => {
      // complex indicator (+2) + long query (>15 words, +1) = score 3 → complex
      const result = classifyQueryComplexity(
        "What are the pros and cons of microservices architecture for a large distributed system?"
      );
      expect(result.level).toBe("complex");
      expect(result.k).toBe(12);
    });

    it('classifies two complex indicators in the same query as complex', () => {
      // Two complex indicators → +4, clearly complex
      const result = classifyQueryComplexity(
        "Analyze and evaluate the current authentication approach and its security tradeoffs"
      );
      expect(result.level).toBe("complex");
      expect(result.k).toBe(12);
    });

    it('classifies "history of" + adequate word count as complex', () => {
      // complex indicator (+2) + word count in 15-30 range (+1) = score 3 → complex
      const result = classifyQueryComplexity(
        "Give an overview of the history of relational databases and their evolution"
      );
      expect(result.level).toBe("complex");
      expect(result.k).toBe(12);
    });
  });

  describe("classifyQueryComplexity — abstract indicators (useHyde=true)", () => {
    it('sets useHyde=true for "why does" queries', () => {
      const result = classifyQueryComplexity(
        "Why does the system sometimes return stale cache data?"
      );
      expect(result.useHyde).toBe(true);
    });

    it('sets useHyde=true for "how does" queries', () => {
      const result = classifyQueryComplexity(
        "How does the middleware handle token expiration?"
      );
      expect(result.useHyde).toBe(true);
    });

    it('sets useHyde=true for "what causes" queries', () => {
      const result = classifyQueryComplexity(
        "What causes memory leaks in this service?"
      );
      expect(result.useHyde).toBe(true);
    });

    it('sets useHyde=true for "can you explain" queries', () => {
      const result = classifyQueryComplexity(
        "Can you explain the retry logic used here?"
      );
      expect(result.useHyde).toBe(true);
    });

    it("sets useHyde=false when no abstract indicators are present", () => {
      const result = classifyQueryComplexity("What is the API endpoint for login?");
      expect(result.useHyde).toBe(false);
    });
  });

  describe("classifyQueryComplexity — moderate complexity", () => {
    it("classifies a medium-length abstract query without complex indicators as moderate", () => {
      const result = classifyQueryComplexity(
        "How does the authentication middleware handle expired tokens?"
      );
      expect(result.level).toBe("moderate");
      expect(result.k).toBe(7);
    });

    it("classifies moderate queries with useHyde matching abstract presence", () => {
      const result = classifyQueryComplexity(
        "How does rate limiting work in this service?"
      );
      expect(result.level).toBe("moderate");
      expect(result.useHyde).toBe(true);
    });
  });

  describe("classifyQueryComplexity — long queries and clause counts", () => {
    it("classifies a long query (>30 words) with multiple clauses as complex", () => {
      const result = classifyQueryComplexity(
        "I need to understand the overall architecture of this system, " +
        "including the database layer, the API gateway, the caching strategy, " +
        "and how all these components interact with each other to serve requests efficiently"
      );
      expect(result.level).toBe("complex");
      expect(result.k).toBe(12);
    });

    it("gives a +2 score boost to queries with more than 30 words, pushing abstract queries to complex", () => {
      // abstract indicator (+1) + word count >30 (+2) + another abstract match = score >=3
      const longQuery =
        "Why does the system behave differently under high load when the cache is warm " +
        "compared to when it starts cold, and how does this affect the overall query performance and latency?";
      const result = classifyQueryComplexity(longQuery);
      expect(result.level).toBe("complex");
    });
  });

  describe("classifyQueryComplexity — edge cases", () => {
    it("handles empty string gracefully as simple", () => {
      const result = classifyQueryComplexity("");
      expect(result.level).toBe("simple");
      expect(result.k).toBe(3);
    });

    it("handles whitespace-only input gracefully", () => {
      const result = classifyQueryComplexity("   ");
      expect(result.level).toBe("simple");
      expect(result.k).toBe(3);
    });
  });

  describe("getAdaptiveK — without overrideK", () => {
    it("returns k=3 and level=simple for a simple query", () => {
      const result = getAdaptiveK("What is X?");
      expect(result.k).toBe(3);
      expect(result.complexity.level).toBe("simple");
    });

    it("returns k=7 and level=moderate for a moderate query", () => {
      const result = getAdaptiveK("How does token refresh work in this API?");
      expect(result.k).toBe(7);
      expect(result.complexity.level).toBe("moderate");
    });

    it("returns k=12 and level=complex for a complex query", () => {
      const result = getAdaptiveK(
        "Compare the advantages and disadvantages of SQL vs NoSQL for high-traffic workloads"
      );
      expect(result.k).toBe(12);
      expect(result.complexity.level).toBe("complex");
    });

    it("includes useHyde reflecting abstract indicators", () => {
      const result = getAdaptiveK("Why does the caching layer sometimes serve stale responses?");
      expect(result.useHyde).toBe(true);
    });

    it("returns the full complexity object", () => {
      const result = getAdaptiveK("What is a REST API?");
      expect(result.complexity).toMatchObject({
        level: expect.stringMatching(/simple|moderate|complex/),
        k: expect.any(Number),
        useHyde: expect.any(Boolean),
        reason: expect.any(String),
      });
    });
  });

  describe("getAdaptiveK — with overrideK", () => {
    it("uses overrideK instead of computed k", () => {
      const result = getAdaptiveK("What is X?", 20);
      expect(result.k).toBe(20);
    });

    it("still computes useHyde correctly when overrideK is provided", () => {
      const result = getAdaptiveK(
        "Why does the authentication system sometimes fail under load?",
        10
      );
      expect(result.k).toBe(10);
      expect(result.useHyde).toBe(true);
    });

    it("still includes the complexity object when overrideK is provided", () => {
      const result = getAdaptiveK("What is Y?", 5);
      expect(result.complexity).toBeDefined();
      expect(result.complexity.level).toBe("simple");
    });

    it("ignores overrideK of 0 and falls back to computed k", () => {
      const result = getAdaptiveK(
        "Compare the advantages and disadvantages of A and B, and analyze their differences",
        0
      );
      expect(result.complexity.level).toBe("complex");
      expect(result.k).toBe(12);
    });

    it("ignores negative overrideK and falls back to computed k", () => {
      const result = getAdaptiveK("What is Z?", -5);
      expect(result.k).toBe(3);
    });

    it("caps overrideK at 100", () => {
      const result = getAdaptiveK("What is A?", 200);
      expect(result.k).toBe(100);
    });

    it("caps overrideK of exactly 100 to 100", () => {
      const result = getAdaptiveK("What is B?", 100);
      expect(result.k).toBe(100);
    });

    it("caps overrideK of 101 to 100", () => {
      const result = getAdaptiveK("What is C?", 101);
      expect(result.k).toBe(100);
    });

    it("floors fractional overrideK values", () => {
      const result = getAdaptiveK("What is D?", 7.9);
      expect(result.k).toBe(7);
    });
  });
});
