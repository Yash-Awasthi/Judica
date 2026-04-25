/**
 * Standard Answers — Matcher
 *
 * Matches incoming queries against keyword, regex, and semantic rules.
 * Returns the best matching standard answer or null.
 */

import type { StandardAnswer, MatchRule, MatchResult, StandardAnswerConfig } from "./models.js";
import { DEFAULT_STANDARD_ANSWER_CONFIG } from "./models.js";
import logger from "../../lib/logger.js";

/** Normalize text for matching: lowercase, collapse whitespace. */
function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Check if query matches a keyword rule. */
function matchKeywordRule(query: string, rule: MatchRule): number {
  const normalizedQuery = normalize(query);
  const keywords = rule.value
    .split(",")
    .map((k) => normalize(k))
    .filter((k) => k.length > 0);

  if (keywords.length === 0) return 0;

  const matchedCount = keywords.filter((kw) => normalizedQuery.includes(kw)).length;

  if (rule.matchAll) {
    // All keywords must be present
    return matchedCount === keywords.length ? 1.0 : 0;
  }

  // Any keyword present — confidence scales with match count
  return matchedCount > 0 ? matchedCount / keywords.length : 0;
}

/** Check if query matches a regex rule. */
function matchRegexRule(query: string, rule: MatchRule): number {
  try {
    const regex = new RegExp(rule.value, "i");
    return regex.test(query) ? 1.0 : 0;
  } catch {
    logger.warn({ ruleId: rule.id, pattern: rule.value }, "Invalid regex in standard answer rule");
    return 0;
  }
}

/** Check if query matches a semantic rule (simple cosine-like heuristic). */
function matchSemanticRule(query: string, rule: MatchRule): number {
  // Simple word-overlap similarity as a baseline.
  // In production, this would use embedding cosine similarity.
  const queryWords = new Set(normalize(query).split(" ").filter((w) => w.length > 2));
  const refWords = new Set(normalize(rule.value).split(" ").filter((w) => w.length > 2));

  if (queryWords.size === 0 || refWords.size === 0) return 0;

  let overlap = 0;
  for (const w of queryWords) {
    if (refWords.has(w)) overlap++;
  }

  const similarity = (2 * overlap) / (queryWords.size + refWords.size);
  return similarity;
}

/** Match a single rule against a query. */
function matchRule(query: string, rule: MatchRule): number {
  switch (rule.type) {
    case "keyword":
      return matchKeywordRule(query, rule);
    case "regex":
      return matchRegexRule(query, rule);
    case "semantic":
      return matchSemanticRule(query, rule);
    default:
      return 0;
  }
}

/**
 * Match a query against all standard answers.
 * Returns matches sorted by confidence, filtered by threshold.
 */
export function matchStandardAnswers(
  query: string,
  answers: StandardAnswer[],
  config: StandardAnswerConfig = DEFAULT_STANDARD_ANSWER_CONFIG,
): MatchResult[] {
  if (!config.enabled || !query.trim()) return [];

  const results: MatchResult[] = [];

  // Sort by priority (higher first)
  const sortedAnswers = [...answers]
    .filter((a) => a.enabled)
    .sort((a, b) => b.priority - a.priority);

  for (const answer of sortedAnswers) {
    for (const rule of answer.rules) {
      const confidence = matchRule(query, rule);
      const threshold = rule.threshold || config.defaultThreshold;

      if (confidence >= threshold) {
        results.push({
          answerId: answer.id,
          answer,
          confidence,
          matchedRule: rule,
        });
        break; // Only match one rule per answer
      }
    }
  }

  // Sort by confidence descending
  results.sort((a, b) => b.confidence - a.confidence);

  return results.slice(0, config.maxMatches);
}

/**
 * Try to match a query and return the best standard answer.
 * Returns null if no match found.
 */
export function findBestStandardAnswer(
  query: string,
  answers: StandardAnswer[],
  config?: StandardAnswerConfig,
): MatchResult | null {
  const matches = matchStandardAnswers(query, answers, config);
  return matches.length > 0 ? matches[0] : null;
}
