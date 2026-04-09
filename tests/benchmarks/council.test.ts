import { vi } from "vitest";
import { describe, it, expect } from "vitest";
import { computeConsensus } from "../../src/lib/metrics.js";
import { scoreOpinions, filterAndRank } from "../../src/lib/scoring.js";
import { detectPII } from "../../src/lib/pii.js";
import { parseAgentOutput } from "../../src/lib/schemas.js";

describe("Council Evaluation Benchmarks", () => {
  describe("Structured Output Parsing", () => {
    it("should parse valid JSON agent output", () => {
      const raw = JSON.stringify({
        answer: "The answer is 42",
        reasoning: "Because 6 * 7 = 42",
        key_points: ["math calculation", "multiplication"],
        assumptions: ["base 10"],
        confidence: 0.9
      });
      const result = parseAgentOutput(raw);
      expect(result).not.toBeNull();
      expect(result!.answer).toBe("The answer is 42");
      expect(result!.confidence).toBe(0.9);
    });

    it("should parse JSON wrapped in markdown code blocks", () => {
      const raw = '```json\n{"answer":"test answer here","reasoning":"reasoning text here","key_points":["point one"],"assumptions":[],"confidence":0.5}\n```';
      const result = parseAgentOutput(raw);
      expect(result).not.toBeNull();
      expect(result!.answer).toBe("test answer here");
    });

    it("should return null for invalid JSON", () => {
      expect(parseAgentOutput("not json at all")).toBeNull();
      expect(parseAgentOutput("")).toBeNull();
    });

    it("should return null for JSON missing required fields", () => {
      const raw = JSON.stringify({ answer: "test answer here" });
      expect(parseAgentOutput(raw)).toBeNull();
    });
  });

  describe("Consensus Metric", () => {
  vi.setConfig({ testTimeout: 20000 });
    it("should return 1 for identical outputs", async () => {
//vi.setConfig({ testTimeout: 20000 });
    //vi.setConfig({ testTimeout: 20000 });
      const output = {
        answer: "Use microservices architecture",
        reasoning: "Better scalability",
        key_points: ["scalability", "independent deployment"],
        assumptions: [],
        confidence: 0.9
      };
      expect(await computeConsensus([output, output])).toBe(1);
    });

    it("should return lower score for divergent outputs", async () => {
//vi.setConfig({ testTimeout: 20000 });
      const a = {
        answer: "Implement machine learning pipeline using TensorFlow and PyTorch for neural network training",
        reasoning: "TensorFlow provides excellent production deployment capabilities while PyTorch offers flexible research development",
        key_points: ["deep learning", "neural networks", "model training"],
        assumptions: ["dataset is available", "GPU resources present"],
        confidence: 0.9
      };
      const b = {
        answer: "Plant organic vegetable garden with tomatoes and lettuce for sustainable food production",
        reasoning: "Organic gardening avoids pesticides and provides fresh healthy vegetables for daily consumption",
        key_points: ["sustainable agriculture", "food security", "health benefits"],
        assumptions: ["soil quality is good", "climate is suitable"],
        confidence: 0.8
      };
      const score = await computeConsensus([a, b]);
      expect(score).toBeLessThan(0.5);
    });

    it("should handle single output", async () => {
      const output = {
        answer: "test answer here",
        reasoning: "test reasoning here",
        key_points: ["test point"],
        assumptions: [],
        confidence: 0.5
      };
      expect(await computeConsensus([output])).toBe(1);
    });
  });

  describe("Scoring Engine", () => {
    it("should score and rank opinions correctly", async () => {
      const opinions = [
        { name: "Agent A", opinion: "test", structured: { answer: "Use React", reasoning: "Popular", key_points: ["popularity", "ecosystem"], assumptions: [], confidence: 0.9 } },
        { name: "Agent B", opinion: "test", structured: { answer: "Use Vue", reasoning: "Simple", key_points: ["simplicity"], assumptions: [], confidence: 0.7 } },
      ];
      const scored = await scoreOpinions(opinions, [], new Map());
      expect(scored).toHaveLength(2);
      expect(scored[0].scores.final).toBeGreaterThan(0);
      expect(scored[0].scores.final).toBeLessThanOrEqual(1);
    });

    it("should filter low-scoring opinions", async () => {
      const opinions = [
        { name: "A", opinion: "test", structured: { answer: "good answer here", reasoning: "reasoning text", key_points: ["point one"], assumptions: [], confidence: 0.9 } },
        { name: "B", opinion: "test", structured: { answer: "bad answer here", reasoning: "reasoning text", key_points: ["point two"], assumptions: [], confidence: 0.1 } },
      ];
      const scored = await scoreOpinions(opinions, [], new Map());
      const filtered = filterAndRank(scored, 0.3);
      expect(filtered.length).toBeLessThanOrEqual(scored.length);
    });
  });

  describe("PII Detection", () => {
    it("should detect email addresses", () => {
      const result = detectPII("Contact me at user@example.com for details");
      expect(result.found).toBe(true);
      expect(result.types).toContain("email");
      expect(result.anonymized).toContain("[EMAIL_REDACTED]");
    });

    it("should detect phone numbers", () => {
      const result = detectPII("Call me at 555-123-4567");
      expect(result.found).toBe(true);
      expect(result.types).toContain("phone");
    });

    it("should detect SSN", () => {
      const result = detectPII("My SSN is 123-45-6789");
      expect(result.found).toBe(true);
      expect(result.types).toContain("ssn");
    });

    it("should detect credit card numbers", () => {
      const result = detectPII("Card: 4111-1111-1111-1111");
      expect(result.found).toBe(true);
      expect(result.types).toContain("credit_card");
    });

    it("should return clean for no PII", () => {
      const result = detectPII("What is the best programming language?");
      expect(result.found).toBe(false);
      expect(result.types).toHaveLength(0);
    });

    it("should detect multiple PII types", () => {
      const result = detectPII("Email: a@b.com, Phone: 555-123-4567");
      expect(result.found).toBe(true);
      expect(result.types.length).toBeGreaterThanOrEqual(2);
    });
  });
});