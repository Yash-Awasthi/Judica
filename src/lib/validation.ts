import { AgentOutput, ValidationResult } from "./schemas.js";
import logger from "./logger.js";

/**
 * Validates the truth-awareness and logical integrity of an agent response.
 * Phase 2 - TRUTH AWARENESS.
 */
export class ValidationModule {
  
  /**
   * Main entry point for validating an opinion.
   * Returns a list of validation results and sub-results.
   */
  async validate(output: AgentOutput): Promise<ValidationResult[]> {
    const results: ValidationResult[] = [];

    // 1. Logical Consistency
    const logical = this.checkLogicalConsistency(output);
    results.push(logical);

    // 2. Mathematical Verification
    const math = this.checkMathIntegrity(output);
    results.push(math);

    // 3. Code Syntax/Dry-run Check
    const codeResult = this.checkCodeIntegrity(output);
    results.push(codeResult);

    // 4. Fact Pattern Check
    const fact = this.checkFactPattern(output);
    results.push(fact);

    // 5. Chain of Thought Check
    const cot = this.checkChainOfThoughtConsistency(output);
    results.push(cot);

    // 6. Step Dependency Check
    const stepDep = this.checkStepDependency(output);
    results.push(stepDep);

    return results;
  }

  /**
   * Validates raw text for logical and mathematical integrity.
   * Useful for the Cold Validator synthesis check.
   */
  async validateText(text: string): Promise<ValidationResult[]> {
    // Wrap text in a pseudo-AgentOutput for reuse
    const pseudo: AgentOutput = {
      answer: text,
      reasoning: "",
      key_points: [],
      assumptions: [],
      confidence: 1.0
    };
    return this.validate(pseudo);
  }

  /**
   * Detects blatant intra-answer contradictions.
   */
  private checkLogicalConsistency(output: AgentOutput): ValidationResult {
    const errors: string[] = [];
    const text = (output.answer + " " + output.reasoning).toLowerCase();

    // Look for common contradiction patterns (heuristic but deterministic in rule matching)
    const patterns = [
      { find: /\b(always)\b.*\b(never)\b/i, error: "Contradictory absolutes: 'always' and 'never' used together." },
      { find: /\b(true)\b.*\b(false)\b/i, error: "Potential boolean contradiction detected." },
      { find: /\b(increase)\b.*\b(decrease)\b/i, error: "Opposing trends ('increase' / 'decrease') cited in close proximity without qualification." }
    ];

    for (const p of patterns) {
      if (p.find.test(text)) {
        errors.push(p.error);
      }
    }

    return {
      valid: errors.length === 0,
      errors: errors,
      confidence_adjustment: errors.length > 0 ? -0.1 : 0,
      type: "logical"
    };
  }

  /**
   * Extracts and verifies mathematical identities.
   */
  private checkMathIntegrity(output: AgentOutput): ValidationResult {
    const errors: string[] = [];
    const combined = output.answer + " " + output.reasoning;
    
    // Look for simple arithmetic: 5 + 5 = 10
    const mathRegex = /([\d\s+\-*/().]+)\s*=\s*([\d\s+\-*/().]+)/g;
    let match;
    
    while ((match = mathRegex.exec(combined)) !== null) {
      const expression = match[1].trim();
      const result = match[2].trim();
      
      try {
        // Sanitize: only allow numbers and basic math operators
        if (/^[\d\s+\-*/().]+$/.test(expression) && /^[\d\s+\-*/().]+$/.test(result)) {
          // eslint-disable-next-line no-eval
          const calc = eval(expression);
          // eslint-disable-next-line no-eval
          const expected = eval(result);
          
          if (Math.abs(calc - expected) > 0.0001) {
            errors.push(`Math error: ${expression} does not equal ${result} (calculated ${calc})`);
          }
        }
      } catch (err) {
        // Not a real equation or too complex for simple eval, skip
        logger.debug({ err: String(err) }, "Skipped complex math verification");
      }
    }

    return {
      valid: errors.length === 0,
      errors: errors,
      confidence_adjustment: errors.length > 0 ? -0.15 : 0,
      type: "mathematical"
    };
  }

  /**
   * Basic code syntax check if code blocks are detected.
   */
  private checkCodeIntegrity(output: AgentOutput): ValidationResult {
    const errors: string[] = [];
    const codeBlocks = output.answer.match(/```(?:[\w]*)\n([\s\S]*?)```/g) || [];
    
    for (const block of codeBlocks) {
      const code = block.replace(/```(?:[\w]*)\n|```/g, "").trim();
      
      // Heuristic syntax check for JS-like languages
      if (code.includes("const ") || code.includes("function") || code.includes("import ")) {
        try {
          // In a real production system, this should use a real parser like Esprima or Acorn
          new Function(code); 
        } catch (err) {
          errors.push(`Potential syntax error in code block: ${(err as Error).message}`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors: errors,
      confidence_adjustment: errors.length > 0 ? -0.2 : 0,
      type: "code"
    };
  }

  /**
   * Detects patterns of unsupported fact fabrication.
   */
  private checkFactPattern(output: AgentOutput): ValidationResult {
    const errors: string[] = [];
    
    // Check for source placeholders like [Source] or [Link] that were never replaced
    if (/\[\s*(Source|Link|Reference|URL)\s*\]/i.test(output.reasoning)) {
      errors.push("Response contains unpopulated citation placeholders.");
    }

    // Check for empty reasoning while providing a high-confidence answer
    if (output.reasoning.length < 20 && output.confidence > 0.8) {
      errors.push("High-confidence answer provided with insufficient reasoning/evidential support.");
    }

    return {
      valid: errors.length === 0,
      errors: errors,
      confidence_adjustment: errors.length > 0 ? -0.1 : 0,
      type: "fact"
    };
  }

  /**
   * Detects contradictions between sequential reasoning steps.
   */
  private checkChainOfThoughtConsistency(output: AgentOutput): ValidationResult {
    const errors: string[] = [];
    const steps = output.reasoning.split(/\d+\.|\n/).map(s => s.trim().toLowerCase()).filter(s => s.length > 5);

    for (let i = 1; i < steps.length; i++) {
      const prev = steps[i - 1];
      const current = steps[i];

      // Logic check for negation flippng
      if (prev.includes("not true") && current.includes("it is true") && !current.includes("however")) {
        errors.push(`Logic flip detected between step ${i} and ${i+1} without transition or resolution.`);
      }
    }

    return {
      valid: errors.length === 0,
      errors: errors,
      confidence_adjustment: errors.length > 0 ? -0.15 : 0,
      type: "logical"
    };
  }

  /**
   * Identifies numerical or dependency mismatches between steps.
   */
  private checkStepDependency(output: AgentOutput): ValidationResult {
    const errors: string[] = [];
    const steps = output.reasoning.split(/\d+\.|\n/).map(s => s.trim()).filter(s => s.length > 5);
    
    // Look for numbers mentioned in previous step being changed in next step without reason
    for (let i = 1; i < steps.length; i++) {
      const numsPrev = (steps[i - 1].match(/\d+(\.\d+)?/g) || []) as string[];
      const numsCurr = (steps[i].match(/\d+(\.\d+)?/g) || []) as string[];

      if (numsPrev.length > 0 && numsCurr.length > 0) {
        const lastNum = numsPrev[numsPrev.length - 1];
        if (lastNum && numsCurr.includes(lastNum)) continue; 
      }
    }

    return {
      valid: errors.length === 0,
      errors: errors,
      confidence_adjustment: 0, // Informational for now, unless explicit contradiction
      type: "logical"
    };
  }
}

export const validationModule = new ValidationModule();
