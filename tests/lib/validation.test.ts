import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock logger
vi.mock("../../src/lib/logger.js", () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

describe("ValidationModule", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("validate", () => {
    it("should return successful results for valid output", async () => {
      const { validationModule } = await import("../../src/lib/validation.js");
      const output = {
        answer: "The sky is blue because of Rayleigh scattering. 5 + 5 = 10.",
        reasoning: "1. Sunlight enters atmosphere.\n2. Shorter wavelengths scatter.\n3. Result is 10.",
        key_points: ["Scattering"],
        assumptions: [],
        confidence: 0.9
      } as any;

      const results = await validationModule.validate(output);
      expect(results.length).toBe(6);
      
      const allValid = results.every(r => r.valid);
      expect(allValid).toBe(true);
    });

    it("should catch logical contradictions", async () => {
      const { validationModule } = await import("../../src/lib/validation.js");
      const output = {
        answer: "It is always true but never happens.",
        reasoning: "I like contradiction",
        key_points: [],
        assumptions: [],
        confidence: 0.9
      } as any;

      const results = await validationModule.validate(output);
      const logical = results.find(r => r.type === "logical" && r.confidence_adjustment === -0.1);
      expect(logical?.valid).toBe(false);
      expect(logical?.errors[0]).toContain("always");
    });

    it("should catch math errors", async () => {
      const { validationModule } = await import("../../src/lib/validation.js");
      const output = {
        answer: "I calculated it: 5 * 5 = 30",
        reasoning: "",
        key_points: [],
        assumptions: [],
        confidence: 0.9
      } as any;

      const results = await validationModule.validate(output);
      const math = results.find(r => r.type === "mathematical");
      expect(math?.valid).toBe(false);
      expect(math?.errors[0]).toContain("Math error");
    });

    it("should detect code syntax errors", async () => {
      const { validationModule } = await import("../../src/lib/validation.js");
      const output = {
        answer: "Here is code:\n```js\nfunction test() { console.log('hi'); \n```",
        reasoning: "",
        key_points: [],
        assumptions: [],
        confidence: 0.9
      } as any;

      const results = await validationModule.validate(output);
      const code = results.find(r => r.type === "code");
      expect(code?.valid).toBe(false);
      expect(code?.errors[0]).toContain("mismatched braces");
    });

    it("should detect fact pattern errors (unpopulated placeholders)", async () => {
      const { validationModule } = await import("../../src/lib/validation.js");
      const output = {
        answer: "Some facts.",
        reasoning: "According to [Source]",
        key_points: [],
        assumptions: [],
        confidence: 0.9
      } as any;

      const results = await validationModule.validate(output);
      const fact = results.find(r => r.type === "fact");
      expect(fact?.valid).toBe(false);
      expect(fact?.errors[0]).toContain("placeholders");
    });

    it("should detect step dependency gaps", async () => {
      const { validationModule } = await import("../../src/lib/validation.js");
      const output = {
        answer: "Step proof.",
        reasoning: "1. x = 42\n2. Therefore y = 100", // No 42 carried over
        key_points: [],
        assumptions: [],
        confidence: 0.9
      } as any;

      const results = await validationModule.validate(output);
      const step = results.find(r => !r.valid && r.errors.some(e => e.includes("numerical dependency issue")));
      expect(step).toBeDefined();
    });
  });

  describe("validateText", () => {
      it("should convert string to output and validate", async () => {
          const { validationModule } = await import("../../src/lib/validation.js");
          const results = await validationModule.validateText("10 + 10 = 25");
          const math = results.find(r => r.type === "mathematical");
          expect(math?.valid).toBe(false);
      });
  });
});
