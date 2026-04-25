/**
 * Standard Answers — Barrel Export
 */

export type {
  StandardAnswer,
  MatchRule,
  MatchRuleType,
  MatchResult,
  StandardAnswerConfig,
} from "./models.js";
export { DEFAULT_STANDARD_ANSWER_CONFIG } from "./models.js";
export { matchStandardAnswers, findBestStandardAnswer } from "./matcher.js";
