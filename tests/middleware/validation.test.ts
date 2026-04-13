import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/lib/logger.js", () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { ValidationModule } from "../../src/lib/validation.js";

// ── Access safeMathEval via the public checkMathIntegrity path.
const vm = new ValidationModule();
const safeMathEval = (vm as any).safeMathEval.bind(vm);

// ── safeMathEval ─────────────────────────────────────────────────────
describe("Validation — safeMathEval", () => {
  // Basic arithmetic
  it("should compute 2+2 = 4", () => {
    expect(safeMathEval("2+2")).toBe(4);
  });

  it("should compute 3*4 = 12", () => {
    expect(safeMathEval("3*4")).toBe(12);
  });

  it("should compute 10/2 = 5", () => {
    expect(safeMathEval("10/2")).toBe(5);
  });

  it("should compute 10-3 = 7", () => {
    expect(safeMathEval("10-3")).toBe(7);
  });

  // Parentheses and precedence
  it("should compute (2+3)*4 = 20", () => {
    expect(safeMathEval("(2+3)*4")).toBe(20);
  });

  it("should respect operator precedence: 2+3*4 = 14", () => {
    expect(safeMathEval("2+3*4")).toBe(14);
  });

  it("should handle nested parentheses: ((2+3)*4)+1 = 21", () => {
    expect(safeMathEval("((2+3)*4)+1")).toBe(21);
  });

  // Decimal numbers
  it("should handle decimal numbers: 1.5+2.5 = 4", () => {
    expect(safeMathEval("1.5+2.5")).toBe(4);
  });

  it("should handle decimal result: 7/2 = 3.5", () => {
    expect(safeMathEval("7/2")).toBe(3.5);
  });

  // Negative numbers (unary minus)
  it("should handle unary minus: -5+3 = -2", () => {
    expect(safeMathEval("-5+3")).toBe(-2);
  });

  // ── Rejection of dangerous input ──────────────────────────────────
  it("should reject process.exit() — returns null", () => {
    expect(safeMathEval("process.exit()")).toBeNull();
  });

  it("should reject require('fs') — returns null", () => {
    expect(safeMathEval("require('fs')")).toBeNull();
  });

  it("should reject arbitrary JS: console.log(1)", () => {
    expect(safeMathEval("console.log(1)")).toBeNull();
  });

  it("should reject import statements", () => {
    expect(safeMathEval("import('child_process')")).toBeNull();
  });

  it("should reject __proto__ access", () => {
    expect(safeMathEval("__proto__")).toBeNull();
  });

  // Empty / invalid
  it("should reject empty string — returns null", () => {
    expect(safeMathEval("")).toBeNull();
  });

  it("should reject plain text", () => {
    expect(safeMathEval("hello world")).toBeNull();
  });

  it("should reject expressions with letters mixed in", () => {
    expect(safeMathEval("2+abc")).toBeNull();
  });
});

// ── ValidationModule.validate ────────────────────────────────────────
describe("Validation — checkMathIntegrity via validate()", () => {
  it("should detect a wrong math claim: 2+2 = 5", async () => {
    const results = await vm.validate({
      answer: "The result is 2 + 2 = 5",
      reasoning: "Simple addition",
      key_points: [],
      assumptions: [],
      confidence: 0.9,
    });

    const mathResult = results.find((r: any) => r.type === "mathematical");
    expect(mathResult).toBeDefined();
    expect(mathResult!.valid).toBe(false);
    expect(mathResult!.errors.length).toBeGreaterThan(0);
  });

  it("should pass a correct math claim: 3*4 = 12", async () => {
    const results = await vm.validate({
      answer: "The result is 3 * 4 = 12",
      reasoning: "Multiplication",
      key_points: [],
      assumptions: [],
      confidence: 0.9,
    });

    const mathResult = results.find((r: any) => r.type === "mathematical");
    expect(mathResult).toBeDefined();
    expect(mathResult!.valid).toBe(true);
  });

  it('should pass a correct math claim: 3*4 = 12', () => {
    const output = { answer: '3*4 = 12', reasoning: '', key_points: [], assumptions: [], confidence: 1.0 };
    const result = (vm as any).checkMathIntegrity(output);
    expect(result.valid).toBe(true);
  });

  it('should flag code syntax errors', () => {
    const output = {
      answer: '```javascript\nfunction test() {\n if (true) return 1;\n```', // missing closing brace
      reasoning: 'Testing code',
      key_points: [], assumptions: [], confidence: 1.0
    };
    const result = (vm as any).checkCodeIntegrity(output);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('mismatched braces');
  });

  it('should flag unpopulated fact patterns', () => {
    const output = {
      answer: 'Answer',
      reasoning: 'See [Source] for details.',
      key_points: [], assumptions: [], confidence: 1.0
    };
    const result = (vm as any).checkFactPattern(output);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('unpopulated citation placeholders');
  });

  it('should flag logic flips in chain of thought', () => {
    const output = {
      answer: 'Answer',
      reasoning: '1. It is not true.\n2. It is true.',
      key_points: [], assumptions: [], confidence: 1.0
    };
    const result = (vm as any).checkChainOfThoughtConsistency(output);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Logic flip detected');
  });

  it('should flag numerical dependency issues in steps', () => {
    const output = {
      answer: 'Answer',
      reasoning: 'Step 1: The value is 42.\nStep 2: The result is 100.', // 42 is lost
      key_points: [], assumptions: [], confidence: 1.0
    };
    const result = (vm as any).checkStepDependency(output);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('numerical dependency issue');
  });

  it('should run full validation and validateText', async () => {
    const output = {
      answer: '5+5=10',
      reasoning: 'reasoning',
      key_points: [], assumptions: [], confidence: 1.0
    };
    const results = await vm.validate(output);
    expect(results).toHaveLength(6);
    
    const textResults = await vm.validateText('5+5=10');
    expect(textResults).toHaveLength(6);
  });
});

// ── Logical consistency checks ───────────────────────────────────────
describe("Validation — checkLogicalConsistency", () => {
  it("should flag contradictory 'always' and 'never' in same text", async () => {
    const results = await vm.validate({
      answer: "This always works and never fails",
      reasoning: "",
      key_points: [],
      assumptions: [],
      confidence: 0.5,
    });

    const logical = results.find((r: any) => r.type === "logical");
    expect(logical).toBeDefined();
    expect(logical!.errors.length).toBeGreaterThan(0);
  });
});
