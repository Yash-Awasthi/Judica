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

// Mock db
const mockSelectResult: any[] = [];
vi.mock("../../src/lib/drizzle.js", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => mockSelectResult,
      }),
    }),
  },
}));

// Mock drizzle-orm
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: unknown[]) => ({ type: "eq", args })),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
    { raw: (s: string) => s }
  ),
}));

// Mock schemas
vi.mock("../../src/db/schema/traces.js", () => ({
  modelReliability: { model: "model" },
}));

vi.mock("../../src/db/schema/council.js", () => ({
  customPersonas: { id: "id", userId: "userId" },
}));

// Mock archetypes config
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
    creator: { id: "creator", name: "Creator" },
    empath: { id: "empath", name: "Empath" },
    outsider: { id: "outsider", name: "Outsider" },
  },
  SUMMONS: {},
}));

import {
  detectDomain,
  getDomainArchetypes,
  getPersonaPerformance,
  generatePromptAdjustment,
  computeCalibration,
  suggestDelegation,
  DOMAIN_PROFILES,
} from "../../src/services/agentSpecialization.service.js";

describe("agentSpecialization.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectResult.length = 0;
  });

  describe("detectDomain", () => {
    it("should detect legal domain", () => {
      const result = detectDomain("What are the compliance requirements for this contract?");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("legal");
    });

    it("should detect medical domain", () => {
      const result = detectDomain("What is the recommended treatment for this diagnosis?");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("medical");
    });

    it("should detect financial domain", () => {
      const result = detectDomain("Analyze the portfolio risk and investment strategy");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("financial");
    });

    it("should detect engineering domain", () => {
      const result = detectDomain("Design the database architecture for this system");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("engineering");
    });

    it("should return null for generic queries", () => {
      const result = detectDomain("What is the meaning of life?");
      expect(result).toBeNull();
    });
  });

  describe("getDomainArchetypes", () => {
    it("should return archetypes sorted by domain weight", () => {
      const legal = DOMAIN_PROFILES.legal;
      const archetypes = getDomainArchetypes(legal);

      expect(archetypes[0]).toBe("historian"); // highest weight 1.5
      expect(archetypes[1]).toBe("ethicist"); // 1.3
      expect(archetypes.length).toBeGreaterThan(0);
    });

    it("should only return valid archetype IDs", () => {
      const engineering = DOMAIN_PROFILES.engineering;
      const archetypes = getDomainArchetypes(engineering);

      for (const id of archetypes) {
        expect(["architect", "contrarian", "empiricist", "ethicist", "futurist",
          "pragmatist", "historian", "strategist", "minimalist", "creator",
          "empath", "outsider"]).toContain(id);
      }
    });
  });

  describe("getPersonaPerformance", () => {
    it("should compute performance metrics from reliability data", async () => {
      mockSelectResult.push(
        {
          model: "gpt-4",
          totalResponses: 100,
          agreedWith: 70,
          contradicted: 20,
          toolErrors: 5,
          avgConfidence: 0.8,
        },
      );

      const result = await getPersonaPerformance(["gpt-4"]);

      expect(result).toHaveLength(1);
      expect(result[0].personaId).toBe("gpt-4");
      expect(result[0].totalDeliberations).toBe(100);
      expect(result[0].agreementRate).toBeGreaterThan(0);
      expect(result[0].agreementRate).toBeLessThan(1);
    });

    it("should return empty for no models", async () => {
      const result = await getPersonaPerformance([]);
      expect(result).toHaveLength(0);
    });

    it("should detect declining trend (overconfident)", async () => {
      mockSelectResult.push({
        model: "gpt-4",
        totalResponses: 50,
        agreedWith: 10,
        contradicted: 30,
        toolErrors: 0,
        avgConfidence: 0.9,
      });

      const result = await getPersonaPerformance(["gpt-4"]);
      expect(result[0].recentTrend).toBe("declining");
    });
  });

  describe("generatePromptAdjustment", () => {
    it("should return null for insufficient data", () => {
      const result = generatePromptAdjustment({
        personaId: "test",
        totalDeliberations: 3,
        agreementRate: 0.5,
        avgScore: 0.5,
        recentTrend: "stable",
      });
      expect(result).toBeNull();
    });

    it("should warn divergent personas", () => {
      const result = generatePromptAdjustment({
        personaId: "test",
        totalDeliberations: 20,
        agreementRate: 0.2,
        avgScore: 0.5,
        recentTrend: "declining",
      });
      expect(result).toContain("diverged");
    });

    it("should encourage unique thinking for overly agreeable personas", () => {
      const result = generatePromptAdjustment({
        personaId: "test",
        totalDeliberations: 20,
        agreementRate: 0.95,
        avgScore: 0.9,
        recentTrend: "stable",
      });
      expect(result).toContain("unique value");
    });

    it("should advise confidence calibration for declining trend", () => {
      const result = generatePromptAdjustment({
        personaId: "test",
        totalDeliberations: 20,
        agreementRate: 0.5,
        avgScore: 0.7,
        recentTrend: "declining",
      });
      expect(result).toContain("confidence");
    });
  });

  describe("computeCalibration", () => {
    it("should detect well-calibrated models", async () => {
      mockSelectResult.push({
        model: "gpt-4",
        totalResponses: 50,
        agreedWith: 35,
        contradicted: 5,
        toolErrors: 0,
        avgConfidence: 0.85,
      });

      const result = await computeCalibration(["gpt-4"]);
      expect(result).toHaveLength(1);
      expect(result[0].model).toBe("gpt-4");
      expect(result[0].recommendation).toBeDefined();
    });

    it("should detect overconfident models", async () => {
      mockSelectResult.push({
        model: "gpt-4",
        totalResponses: 50,
        agreedWith: 10,
        contradicted: 30,
        toolErrors: 0,
        avgConfidence: 0.95,
      });

      const result = await computeCalibration(["gpt-4"]);
      expect(result[0].recommendation).toContain("Overconfident");
    });
  });

  describe("suggestDelegation", () => {
    const allArchetypes = [
      "architect", "contrarian", "empiricist", "ethicist",
      "futurist", "pragmatist", "historian", "strategist",
      "minimalist", "creator", "empath", "outsider",
    ];

    it("should suggest architect for implementation tasks", () => {
      const result = suggestDelegation("implement the new API endpoint", allArchetypes);
      expect(result).not.toBeNull();
      expect(result!.suggestedArchetype).toBe("architect");
    });

    it("should suggest empiricist for research tasks", () => {
      const result = suggestDelegation("research the latest ML papers", allArchetypes);
      expect(result).not.toBeNull();
      expect(result!.suggestedArchetype).toBe("empiricist");
    });

    it("should suggest contrarian for risk assessment", () => {
      const result = suggestDelegation("assess the security risks", allArchetypes);
      expect(result).not.toBeNull();
      expect(result!.suggestedArchetype).toBe("contrarian");
    });

    it("should suggest ethicist for ethical considerations", () => {
      const result = suggestDelegation("evaluate the ethical implications and bias", allArchetypes);
      expect(result).not.toBeNull();
      expect(result!.suggestedArchetype).toBe("ethicist");
    });

    it("should return null when no pattern matches", () => {
      const result = suggestDelegation("hello world", allArchetypes);
      expect(result).toBeNull();
    });

    it("should not suggest unavailable archetypes", () => {
      const result = suggestDelegation("implement the feature", ["empiricist", "ethicist"]);
      // architect not available
      expect(result).toBeNull();
    });
  });
});
