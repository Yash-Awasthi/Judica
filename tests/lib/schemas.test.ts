import { describe, it, expect } from "vitest";
import { parseAgentOutput, formatAgentOutput, AgentOutputSchema } from "../../src/lib/schemas.js";

describe("Schemas", () => {
  describe("parseAgentOutput", () => {
    it("should parse valid JSON string", () => {
      const input = JSON.stringify({
        answer: "This is a long enough answer for the schema.",
        reasoning: "This reasoning is also long enough.",
        key_points: ["Point one is here", "Point two is also here"],
        confidence: 0.9
      });
      const result = parseAgentOutput(input);
      expect(result).not.toBeNull();
      expect(result?.answer).toContain("long enough answer");
    });

    it("should parse JSON inside a code block", () => {
      const input = "```json\n" + JSON.stringify({
        answer: "This is a long enough answer for the schema.",
        reasoning: "This reasoning is also long enough.",
        key_points: ["Point one is here"],
        confidence: 0.8
      }) + "\n```";
      const result = parseAgentOutput(input);
      expect(result).not.toBeNull();
      expect(result?.confidence).toBe(0.8);
    });

    it("should return null for invalid JSON", () => {
      const result = parseAgentOutput("not json");
      expect(result).toBeNull();
    });

    it("should return null for JSON that fails schema validation", () => {
      const input = JSON.stringify({
        answer: "short", // Too short
        reasoning: "too short",
        key_points: [], // Min 1
        confidence: 1.5 // Max 1.0
      });
      const result = parseAgentOutput(input);
      expect(result).toBeNull();
    });

    it("should ignore surrounding text", () => {
        const input = "Here is the result: " + JSON.stringify({
            answer: "This is a long enough answer for the schema.",
            reasoning: "This reasoning is also long enough.",
            key_points: ["Point one is here"],
            confidence: 0.7
        }) + " Hope this helps!";
        const result = parseAgentOutput(input);
        expect(result?.confidence).toBe(0.7);
    });
  });

  describe("formatAgentOutput", () => {
    it("should format AgentOutput correctly", () => {
      const output = {
        answer: "The answer.",
        key_points: ["Point 1", "Point 2"],
        assumptions: ["Assumption 1"],
        confidence: 0.85,
        reasoning: "Some reasoning here."
      } as any;
      const formatted = formatAgentOutput(output);
      expect(formatted).toContain("The answer.");
      expect(formatted).toContain("Key Points:");
      expect(formatted).toContain("- Point 1");
      expect(formatted).toContain("Assumptions:");
      expect(formatted).toContain("Confidence: 85%");
    });

    it("should omit sections with no entries", () => {
        const output = {
          answer: "Minimal answer.",
          key_points: [],
          assumptions: [],
          confidence: 0.5,
          reasoning: "Reason"
        } as any;
        const formatted = formatAgentOutput(output);
        expect(formatted).not.toContain("Key Points:");
        expect(formatted).not.toContain("Assumptions:");
    });
  });

  describe("AgentOutputSchema directly", () => {
    it("should validate a correct object", () => {
        const valid = {
            answer: "A sufficiently long answer for testing purposes.",
            reasoning: "A sufficiently long reasoning for testing purposes.",
            key_points: ["Valid key point 1", "Valid key point 2"],
            confidence: 0.95
        };
        const result = AgentOutputSchema.safeParse(valid);
        expect(result.success).toBe(true);
    });

    it("should reject a very long answer", () => {
        const invalid = {
            answer: "a".repeat(2001),
            reasoning: "valid reasoning",
            key_points: ["valid point"],
            confidence: 0.5
        };
        const result = AgentOutputSchema.safeParse(invalid);
        expect(result.success).toBe(false);
    });
  });
});
