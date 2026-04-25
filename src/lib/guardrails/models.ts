/**
 * Input/Output Guardrails — Models
 *
 * Content safety layer for checking user inputs and LLM outputs.
 * Modeled after Onyx's guardrail system.
 */

export type GuardrailAction = "block" | "warn" | "redact" | "log";

export interface GuardrailRule {
  id: string;
  name: string;
  description: string;
  /** Where this rule applies. */
  scope: "input" | "output" | "both";
  /** Check type. */
  type: "regex" | "keyword" | "llm" | "pii" | "builtin";
  /** For regex/keyword: the pattern or comma-separated keywords. */
  pattern?: string;
  /** For llm: the evaluation prompt. */
  llmPrompt?: string;
  /** Action to take when triggered. */
  action: GuardrailAction;
  /** Severity level. */
  severity: "low" | "medium" | "high" | "critical";
  /** Whether the rule is enabled. */
  enabled: boolean;
}

export interface GuardrailCheck {
  ruleId: string;
  ruleName: string;
  triggered: boolean;
  action: GuardrailAction;
  severity: string;
  detail?: string;
  redactedText?: string;
}

export interface GuardrailResult {
  passed: boolean;
  checks: GuardrailCheck[];
  /** The (possibly redacted) text after all guardrails. */
  processedText: string;
  /** Blocked reason if passed=false. */
  blockedReason?: string;
}

export interface GuardrailConfig {
  /** Whether guardrails are enabled globally. */
  enabled: boolean;
  /** Rules to apply to user inputs. */
  inputRules: GuardrailRule[];
  /** Rules to apply to LLM outputs. */
  outputRules: GuardrailRule[];
  /** Whether to fail open (allow) on guardrail errors. */
  failOpen: boolean;
}

export const DEFAULT_GUARDRAIL_CONFIG: GuardrailConfig = {
  enabled: true,
  inputRules: [],
  outputRules: [],
  failOpen: true,
};
