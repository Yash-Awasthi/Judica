import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/lib/providers.js", () => ({
  askProvider: vi.fn(),
}));

vi.mock("../../src/lib/logger.js", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe("ColdValidator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should create default validator config", async () => {
    const { createDefaultValidator } = await import("../../src/lib/validator.js");
    const mockProvider = { name: "test", model: "model", client: {} } as any;
    
    const config = createDefaultValidator(mockProvider);
    expect(config.model).toBe("model");
    expect(config.enableFactChecking).toBe(true);
    expect(config.customRules?.length).toBe(1);
    
    // Test the custom rule 'answer_relevance'
    const rule = config.customRules![0];
    const ctx = { question: "What is the meaning of life?", agentOutputs: [] };
    
    // Relevant
    expect(rule.check("The meaning of life is 42", ctx)).toBeNull();
    
    // Irrelevant
    const issue = rule.check("Bananas are yellow", ctx);
    expect(issue).toBeDefined();
    expect(issue?.type).toBe("inconsistency");
  });

  describe("validateDeliberation", () => {
    it("should perform full validation and return result with stats", async () => {
      const { ColdValidator, createDefaultValidator } = await import("../../src/lib/validator.js");
      const { askProvider } = await import("../../src/lib/providers.js");

      // Mock askProvider calls
      // 1. Content Validation
      // 2. Fact Check
      // 3. Bias Check
      // 4. Corrector
      (askProvider as any).mockResolvedValue({ text: `{"issues":[]}` });

      const mockProvider = { name: "test", model: "model", client: {} } as any;
      const config = createDefaultValidator(mockProvider);
      const validator = new ColdValidator(config);

      const agentOutputs = [
        { name: "Agent1", answer: "A perfectly long answer for agent one.", reasoning: "", key_points: [], assumptions: [], confidence: 0.9 },
        { name: "Agent2", answer: "A perfectly long answer for agent two.", reasoning: "", key_points: [], assumptions: [], confidence: 0.9 }
      ] as any;

      const verdict = "The meaning of life is exactly 42 as stated by Agent1 and agreed by Agent2. This verdict is sufficiently long to pass the minimum length check which requires fifty characters to be valid.";

      const result = await validator.validateDeliberation("session-1", "What is the meaning of life?", verdict, agentOutputs, []);

      expect(result.isValid).toBe(true);
      expect(result.issues.length).toBe(0); // All rules passed
      expect(result.riskLevel).toBe("low");

      const stats = validator.getValidationStats();
      expect(stats.totalValidations).toBe(1);
      expect(stats.averageConfidence).toBeGreaterThan(0.9);
      expect(stats.riskDistribution.low).toBe(1);
    });

    it("should capture issues like length and safety", async () => {
      const { ColdValidator, createDefaultValidator } = await import("../../src/lib/validator.js");
      const { askProvider } = await import("../../src/lib/providers.js");

      (askProvider as any).mockResolvedValue({ text: `{"issues":[{"type":"inaccuracy","severity":"high","description":"Bad"}]}` });

      const mockProvider = { name: "test", model: "model", client: {} } as any;
      const config = createDefaultValidator(mockProvider);
      const validator = new ColdValidator(config);

      const agentOutputs = [
        { name: "Agent1", answer: "short", reasoning: "", key_points: [], assumptions: [], confidence: 0.9 }
      ] as any;

      // Verdict too short
      const verdict = "Dangerous stuff.";

      const result = await validator.validateDeliberation("session-2", "Query?", verdict, agentOutputs, []);

      expect(result.isValid).toBe(false);
      expect(result.riskLevel).toBe("high");
      
      const issueTypes = result.issues.map(i => i.type);
      expect(issueTypes).toContain("incomplete"); // Short verdict
      expect(issueTypes).toContain("safety"); // "dangerous" keyword
      expect(issueTypes).toContain("inaccuracy"); // Mocked provider issue
    });

    it("should handle provider throwing error", async () => {
      const { ColdValidator, createDefaultValidator } = await import("../../src/lib/validator.js");
      const { askProvider } = await import("../../src/lib/providers.js");

      (askProvider as any).mockRejectedValue(new Error("Provider down"));

      const mockProvider = { name: "test", model: "model", client: {} } as any;
      const config = createDefaultValidator(mockProvider);
      const validator = new ColdValidator(config);

      const result = await validator.validateDeliberation("session-3", "Query?", "Long enough verdict to pass format check. This part makes it over 50 characters.", [], []);
      expect(result.isValid).toBe(true);

    });
  });
});
