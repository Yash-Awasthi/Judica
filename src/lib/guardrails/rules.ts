/**
 * Input/Output Guardrails — Built-in Rules
 *
 * Default rule definitions for common safety checks.
 */

import type { GuardrailRule } from "./models.js";

export const BUILTIN_INPUT_RULES: GuardrailRule[] = [
  {
    id: "builtin-prompt-injection",
    name: "Prompt Injection Detection",
    description: "Detects common prompt injection patterns in user input",
    scope: "input",
    type: "regex",
    pattern: [
      "ignore\\s+(all\\s+)?previous\\s+instructions",
      "you\\s+are\\s+now\\s+(a|an)\\b",
      "disregard\\s+(all\\s+)?(previous|prior|above)",
      "forget\\s+(all\\s+)?(previous|prior|your)\\s+instructions",
      "system\\s*prompt\\s*:",
      "\\bDAN\\b.*\\bmode\\b",
      "pretend\\s+you\\s+are",
      "act\\s+as\\s+(if\\s+)?you\\s+(are|were)",
      "new\\s+instructions?\\s*:",
      "override\\s+(previous|all|system)",
    ].join("|"),
    action: "block",
    severity: "critical",
    enabled: true,
  },
  {
    id: "builtin-toxicity",
    name: "Toxicity Filter",
    description: "Blocks overtly toxic, hateful, or violent content",
    scope: "input",
    type: "keyword",
    pattern: "", // Empty — requires LLM-based check or external API in production
    action: "block",
    severity: "high",
    enabled: false, // Disabled by default; enable with LLM-based check
  },
  {
    id: "builtin-off-topic",
    name: "Off-Topic Detection",
    description: "Flags queries unrelated to the configured knowledge domain",
    scope: "input",
    type: "llm",
    llmPrompt: "Is the following user query related to the configured knowledge domain? Respond ONLY with YES or NO.",
    action: "warn",
    severity: "low",
    enabled: false,
  },
];

export const BUILTIN_OUTPUT_RULES: GuardrailRule[] = [
  {
    id: "builtin-pii-leak",
    name: "PII Leak Detection",
    description: "Detects PII in LLM output that should not be exposed",
    scope: "output",
    type: "pii",
    action: "redact",
    severity: "high",
    enabled: true,
  },
  {
    id: "builtin-hallucination-markers",
    name: "Hallucination Markers",
    description: "Flags common hallucination indicators in LLM output",
    scope: "output",
    type: "regex",
    pattern: [
      "as\\s+an\\s+AI\\s+(language\\s+)?model",
      "I\\s+don'?t\\s+have\\s+access\\s+to",
      "I\\s+cannot\\s+verify",
      "I\\s+made\\s+(?:that|this)\\s+up",
      "this\\s+is\\s+(?:a\\s+)?(?:fictional|hypothetical)",
    ].join("|"),
    action: "warn",
    severity: "medium",
    enabled: true,
  },
  {
    id: "builtin-citation-check",
    name: "Citation Verification",
    description: "Warns when output makes claims without citing sources",
    scope: "output",
    type: "llm",
    llmPrompt: "Does this response make factual claims without citing any sources? Respond ONLY with YES or NO.",
    action: "log",
    severity: "low",
    enabled: false,
  },
];
