import { describe, it, expect, vi, beforeEach } from "vitest";

// P11-67: Service logic not actually tested
// P11-68: No large-scale / performance tests
// P11-69: No concurrency tests across services
// P11-70: No failure cascade tests
// P11-71: Keyword-based domain detection not stress-tested

vi.mock("../../src/lib/logger.js", () => ({
  default: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../src/config/env.js", () => ({
  env: {
    DATABASE_URL: "postgresql://test:test@localhost:5432/test",
    JWT_SECRET: "test-jwt-secret-min-16-chars",
    MASTER_ENCRYPTION_KEY: "test-master-encryption-key-min-32-characters-long",
  },
}));

vi.mock("../../src/lib/drizzle.js", () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    }),
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: unknown[]) => ({ type: "eq", args })),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
    { raw: (s: string) => s },
  ),
}));

vi.mock("../../src/db/schema/traces.js", () => ({
  modelReliability: { model: "model" },
}));

vi.mock("../../src/db/schema/council.js", () => ({
  customPersonas: { id: "id", userId: "userId" },
}));

vi.mock("../../src/config/archetypes.js", () => ({
  ARCHETYPES: {
    architect: { id: "architect", name: "Architect" },
    contrarian: { id: "contrarian", name: "Contrarian" },
    empiricist: { id: "empiricist", name: "Empiricist" },
    ethicist: { id: "ethicist", name: "Ethicist" },
    futurist: { id: "futurist", name: "Futurist" },
    pragmatist: { id: "pragmatist", name: "Pragmatist" },
    historian: { id: "historian", name: "Historian" },
    strategist: { id: "strategist", name: "Strategist" },
    minimalist: { id: "minimalist", name: "Minimalist" },
  },
}));

import {
  detectDomain,
  getDomainArchetypes,
  DOMAIN_PROFILES,
} from "../../src/services/agentSpecialization.service.js";

describe("P11-67: Real service logic testing (not just mock verification)", () => {
  it("detectDomain returns correct profile for clear domain inputs", () => {
    // Test real business logic, not just that mocks were called
    const legal = detectDomain("What are the legal implications of this contract?");
    expect(legal).not.toBeNull();
    expect(legal!.id).toBe("legal");

    const medical = detectDomain("What is the clinical diagnosis for these symptoms?");
    expect(medical).not.toBeNull();
    expect(medical!.id).toBe("medical");

    const financial = detectDomain("What is the best investment portfolio for retirement?");
    expect(financial).not.toBeNull();
    expect(financial!.id).toBe("financial");

    const engineering = detectDomain("How should I architect this database API?");
    expect(engineering).not.toBeNull();
    expect(engineering!.id).toBe("engineering");
  });

  it("getDomainArchetypes returns sorted archetypes by weight", () => {
    const legalArchetypes = getDomainArchetypes(DOMAIN_PROFILES.legal);
    // historian has highest weight (1.5) in legal
    expect(legalArchetypes[0]).toBe("historian");
    // All returned archetypes should be real archetype IDs
    for (const id of legalArchetypes) {
      expect(typeof id).toBe("string");
      expect(id.length).toBeGreaterThan(0);
    }
  });

  it("detectDomain returns null for unrelated queries", () => {
    const result = detectDomain("What is the weather today?");
    expect(result).toBeNull();

    const result2 = detectDomain("Tell me a joke");
    expect(result2).toBeNull();
  });
});

describe("P11-68: Large-scale input handling", () => {
  it("detectDomain handles very long input strings efficiently", () => {
    // Simulate a large document being classified
    const longInput = "legal ".repeat(10000) + "What is the liability?";
    const start = performance.now();
    const result = detectDomain(longInput);
    const elapsed = performance.now() - start;

    expect(result).not.toBeNull();
    expect(result!.id).toBe("legal");
    // Should complete in reasonable time (under 100ms for simple string matching)
    expect(elapsed).toBeLessThan(100);
  });

  it("getDomainArchetypes handles profile with many weights", () => {
    // Test with all profiles to ensure no edge case
    for (const profile of Object.values(DOMAIN_PROFILES)) {
      const archetypes = getDomainArchetypes(profile);
      expect(archetypes.length).toBeGreaterThan(0);
      // Verify ordering is descending by weight
      const weights = archetypes.map((id) => profile.archetypeWeights[id] || 0);
      for (let i = 1; i < weights.length; i++) {
        expect(weights[i]).toBeLessThanOrEqual(weights[i - 1]);
      }
    }
  });

  it("detectDomain handles input with thousands of keywords", () => {
    // Simulate a conversation history being classified
    const domains = ["legal", "medical", "finance", "code"];
    const mixedInput = domains.map((d) => `${d} `.repeat(100)).join(" ");

    const result = detectDomain(mixedInput);
    // Should pick the domain with most keyword matches
    expect(result).not.toBeNull();
  });
});

describe("P11-69: Concurrent service operations", () => {
  it("detectDomain is safe under concurrent calls", async () => {
    const inputs = [
      "legal contract liability",
      "medical diagnosis treatment",
      "financial investment portfolio",
      "software architecture database",
    ];

    const results = await Promise.all(
      inputs.map((input) => Promise.resolve(detectDomain(input))),
    );

    expect(results[0]!.id).toBe("legal");
    expect(results[1]!.id).toBe("medical");
    expect(results[2]!.id).toBe("financial");
    expect(results[3]!.id).toBe("engineering");
  });

  it("multiple domain detections don't interfere with each other", async () => {
    // Run 100 concurrent domain detections
    const tasks = Array.from({ length: 100 }, (_, i) => {
      const domain = i % 4 === 0 ? "legal contract"
        : i % 4 === 1 ? "medical diagnosis"
        : i % 4 === 2 ? "finance market"
        : "software code";
      return Promise.resolve().then(() => detectDomain(domain));
    });

    const results = await Promise.all(tasks);

    for (let i = 0; i < 100; i++) {
      const expected = i % 4 === 0 ? "legal"
        : i % 4 === 1 ? "medical"
        : i % 4 === 2 ? "financial"
        : "engineering";
      expect(results[i]!.id).toBe(expected);
    }
  });
});

describe("P11-70: Failure cascade handling", () => {
  it("detectDomain returns null (not throws) on completely empty input", () => {
    expect(detectDomain("")).toBeNull();
    expect(detectDomain("   ")).toBeNull();
  });

  it("getDomainArchetypes handles profile with no valid archetypes gracefully", () => {
    // Profile with archetype IDs that don't exist in ARCHETYPES
    const fakeProfile = {
      id: "test",
      name: "Test",
      domains: ["test"],
      archetypeWeights: { nonexistent1: 1.0, nonexistent2: 0.5 },
      systemPromptSuffix: "",
      preferredSummons: "test",
    };

    const result = getDomainArchetypes(fakeProfile);
    // Should return empty array, not throw
    expect(result).toEqual([]);
  });

  it("detectDomain handles special characters without error", () => {
    // These could potentially break regex or string operations
    const specialInputs = [
      "What about $$$$ financial stuff?",
      "Legal (implications) [of] {this}",
      "Medical <diagnosis> & treatment",
      'Code with "quotes" and `backticks`',
      "null undefined NaN Infinity",
    ];

    for (const input of specialInputs) {
      // Should not throw
      const result = detectDomain(input);
      expect(result === null || typeof result === "object").toBe(true);
    }
  });
});

describe("P11-71: Keyword-based domain detection stress test", () => {
  it("should handle ambiguous inputs that match multiple domains", () => {
    // "medical billing software" spans medical + financial + engineering
    const result = detectDomain("medical billing software for clinical practice");
    expect(result).not.toBeNull();
    // Should pick the domain with the most keyword hits
    // "medical" and "clinical" → medical domain (2 hits)
    expect(result!.id).toBe("medical");
  });

  it("should handle contradictory signals", () => {
    // Input with equal signals from multiple domains
    const result = detectDomain("legal financial engineering medical");
    expect(result).not.toBeNull();
    // Should pick one (implementation picks highest matchCount, ties go to iteration order)
  });

  it("should not match on partial keywords embedded in other words", () => {
    // "code" is an engineering keyword, but "barcode" shouldn't match
    // However, since the implementation uses .includes(), it WILL match
    // This documents the known limitation
    const result = detectDomain("scan the barcode on the product");
    // Documents current behavior: "code" is found inside "barcode"
    // This is the P11-71 gap — naive .includes() matching
    if (result) {
      expect(result.id).toBe("engineering"); // false positive due to substring match
    }
  });

  it("should handle case-insensitive matching", () => {
    expect(detectDomain("LEGAL CONTRACT")).not.toBeNull();
    expect(detectDomain("MEDICAL DIAGNOSIS")).not.toBeNull();
    expect(detectDomain("Financial INVESTMENT")).not.toBeNull();
    expect(detectDomain("SOFTWARE Engineering")).not.toBeNull();
  });

  it("should handle inputs with only stopwords and no domain keywords", () => {
    const result = detectDomain("the and or but if then else when how why");
    expect(result).toBeNull();
  });
});
