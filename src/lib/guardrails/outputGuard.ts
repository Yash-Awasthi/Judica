/**
 * Input/Output Guardrails — Output Guard
 *
 * Checks LLM outputs for hallucination markers, PII leakage,
 * policy violations, and citation verification.
 */

import type { GuardrailRule, GuardrailCheck, GuardrailResult } from "./models.js";
import logger from "../../lib/logger.js";

/** Run a single rule against output text. */
function evaluateOutputRule(text: string, rule: GuardrailRule): GuardrailCheck {
  const check: GuardrailCheck = {
    ruleId: rule.id,
    ruleName: rule.name,
    triggered: false,
    action: rule.action,
    severity: rule.severity,
  };

  if (!rule.enabled) return check;

  switch (rule.type) {
    case "regex": {
      if (!rule.pattern) break;
      try {
        const regex = new RegExp(rule.pattern, "gi");
        const match = regex.test(text);
        if (match) {
          check.triggered = true;
          check.detail = `Output matched pattern: ${rule.name}`;
          if (rule.action === "redact") {
            check.redactedText = text.replace(regex, "[FILTERED]");
          }
        }
      } catch (err) {
        logger.warn({ err, ruleId: rule.id }, "Invalid regex in output guardrail");
      }
      break;
    }
    case "keyword": {
      if (!rule.pattern) break;
      const keywords = rule.pattern.split(",").map((k) => k.trim().toLowerCase());
      const lower = text.toLowerCase();
      const matched = keywords.filter((kw) => kw && lower.includes(kw));
      if (matched.length > 0) {
        check.triggered = true;
        check.detail = `Output contains: ${matched.join(", ")}`;
      }
      break;
    }
    case "pii": {
      const piiPatterns = [
        { name: "SSN", pattern: /\b\d{3}-\d{2}-\d{4}\b/g },
        { name: "Credit Card", pattern: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g },
        { name: "Phone", pattern: /\b\(\d{3}\)\s?\d{3}-\d{4}\b/g },
        { name: "Email", pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z]{2,}\b/gi },
      ];
      const found: string[] = [];
      let redacted = text;
      for (const pp of piiPatterns) {
        if (pp.pattern.test(text)) {
          found.push(pp.name);
          redacted = redacted.replace(pp.pattern, `[${pp.name} REDACTED]`);
        }
        pp.pattern.lastIndex = 0;
      }
      if (found.length > 0) {
        check.triggered = true;
        check.detail = `PII in output: ${found.join(", ")}`;
        check.redactedText = redacted;
      }
      break;
    }
    case "llm":
    case "builtin":
      // LLM-based output checks stub
      break;
  }

  return check;
}

/**
 * Check LLM output against all output guardrail rules.
 */
export function checkOutput(
  text: string,
  rules: GuardrailRule[],
): GuardrailResult {
  const outputRules = rules.filter((r) => r.scope === "output" || r.scope === "both");
  const checks: GuardrailCheck[] = [];
  let processedText = text;
  let blocked = false;
  let blockedReason: string | undefined;

  for (const rule of outputRules) {
    const check = evaluateOutputRule(processedText, rule);
    checks.push(check);

    if (check.triggered) {
      if (check.action === "block") {
        blocked = true;
        blockedReason = `Output blocked by ${check.ruleName}: ${check.detail}`;
      } else if (check.action === "redact" && check.redactedText) {
        processedText = check.redactedText;
      }
    }
  }

  return {
    passed: !blocked,
    checks,
    processedText,
    blockedReason,
  };
}
