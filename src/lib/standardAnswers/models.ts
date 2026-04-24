/**
 * Standard Answers — Models
 *
 * Pre-defined answers for common/sensitive questions. Matches incoming
 * queries against keyword/semantic rules and returns curated responses,
 * bypassing the LLM entirely.
 *
 * Modeled after Onyx's standard answers feature.
 */

export interface StandardAnswer {
  id: string;
  /** Display title for admin UI. */
  title: string;
  /** The curated answer text (Markdown supported). */
  answer: string;
  /** Whether this standard answer is active. */
  enabled: boolean;
  /** Match rules that trigger this answer. */
  rules: MatchRule[];
  /** Categories/tags for organization. */
  categories: string[];
  /** Priority (higher = checked first). */
  priority: number;
  /** Creator user ID. */
  createdBy: number;
  createdAt: Date;
  updatedAt: Date;
}

export type MatchRuleType = "keyword" | "regex" | "semantic";

export interface MatchRule {
  id: string;
  type: MatchRuleType;
  /** For keyword: comma-separated keywords. For regex: pattern string. For semantic: reference phrase. */
  value: string;
  /** Minimum confidence threshold (0-1) for semantic matching. */
  threshold: number;
  /** Whether ALL keywords must match (AND) or any (OR). Only for keyword type. */
  matchAll: boolean;
}

export interface StandardAnswerConfig {
  /** Whether the standard answers feature is enabled globally. */
  enabled: boolean;
  /** Check standard answers before LLM call. */
  checkBeforeLLM: boolean;
  /** Default semantic similarity threshold. */
  defaultThreshold: number;
  /** Maximum number of standard answers to return per query. */
  maxMatches: number;
}

export const DEFAULT_STANDARD_ANSWER_CONFIG: StandardAnswerConfig = {
  enabled: true,
  checkBeforeLLM: true,
  defaultThreshold: 0.8,
  maxMatches: 1,
};

export interface MatchResult {
  answerId: string;
  answer: StandardAnswer;
  confidence: number;
  matchedRule: MatchRule;
}
