/**
 * Input/Output Guardrails — Input Guard
 *
 * Checks user inputs for prompt injection, toxicity, topic boundaries, and PII.
 */

import type { GuardrailRule, GuardrailCheck, GuardrailResult } from "./models.js";
import logger from "../../lib/logger.js";

/** Run a single rule against text. */
function evaluateRule(text: string, rule: GuardrailRule): GuardrailCheck {
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
          check.detail = `Matched pattern: ${rule.name}`;
          if (rule.action === "redact") {
            check.redactedText = text.replace(regex, "[REDACTED]");
          }
        }
      } catch (err) {
        logger.warn({ err, ruleId: rule.id }, "Invalid regex in guardrail rule");
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
        check.detail = `Matched keywords: ${matched.join(", ")}`;
      }
      break;
    }
    case "pii": {
      // Basic PII patterns
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
        pp.pattern.lastIndex = 0; // Reset regex state
      }
      if (found.length > 0) {
        check.triggered = true;
        check.detail = `PII detected: ${found.join(", ")}`;
        check.redactedText = redacted;
      }
      break;
    }
    case "llm":
    case "builtin":
      // LLM-based checks would call the AI here; stub for now
      break;
  }

  return check;
}

/**
 * Check user input against all input guardrail rules.
 */
export function checkInput(
  text: string,
  rules: GuardrailRule[],
): GuardrailResult {
  const inputRules = rules.filter((r) => r.scope === "input" || r.scope === "both");
  const checks: GuardrailCheck[] = [];
  let processedText = text;
  let blocked = false;
  let blockedReason: string | undefined;

  for (const rule of inputRules) {
    const check = evaluateRule(processedText, rule);
    checks.push(check);

    if (check.triggered) {
      if (check.action === "block") {
        blocked = true;
        blockedReason = `Blocked by ${check.ruleName}: ${check.detail}`;
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
