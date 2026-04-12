import { describe, it, expect, vi } from "vitest";

vi.mock("../src/lib/logger.js", () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { ValidationModule } from "../src/lib/validation.js";

// ── Access safeMathEval via the public checkMathIntegrity path.
// safeMathEval is private, so we test it indirectly through the
// ValidationModule's math check, or we use a cheeky cast to access it directly.
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

    const mathResult = results.find((r) => r.type === "mathematical");
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

    const mathResult = results.find((r) => r.type === "mathematical");
    expect(mathResult).toBeDefined();
    expect(mathResult!.valid).toBe(true);
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

    const logical = results.find((r) => r.type === "logical");
    expect(logical).toBeDefined();
    // The first logical result is from checkLogicalConsistency
    expect(logical!.errors.length).toBeGreaterThan(0);
  });
});
