import logger from "../lib/logger.js";

/**
 * Adaptive k selection: dynamically determines how many chunks to retrieve
 * based on query complexity. Simple factoid queries need fewer chunks,
 * while multi-part analytical queries benefit from broader context.
 */

export interface QueryComplexity {
  level: "simple" | "moderate" | "complex";
  k: number;
  useHyde: boolean;
  reason: string;
}

// Patterns that indicate complex, multi-part queries
const COMPLEX_INDICATORS = [
  /\bcompare\b.*\band\b/i,
  /\bcontrast\b/i,
  /\bdifference\s+between\b/i,
  /\bpros\s+and\s+cons\b/i,
  /\badvantages\s+and\s+disadvantages\b/i,
  /\banalyze\b/i,
  /\bevaluate\b/i,
  /\bexplain\s+how\b.*\brelates?\b/i,
  /\brelationship\s+between\b/i,
  /\bimplications?\s+of\b/i,
  /\bwhat\s+are\s+the\b.*\band\b.*\bof\b/i,
  /\bsummarize\s+(all|every|the\s+entire)\b/i,
  /\bhistory\s+of\b/i,
  /\boverview\s+of\b/i,
];

// Patterns that indicate abstract/conceptual queries (benefit from HyDE)
const ABSTRACT_INDICATORS = [
  /\bwhy\s+(does|do|is|are|did|should|would|could)\b/i,
  /\bhow\s+(does|do|is|are|should|would|could)\b/i,
  /\bwhat\s+causes?\b/i,
  /\bwhat\s+is\s+the\s+(meaning|purpose|significance|impact|effect)\b/i,
  /\bin\s+what\s+ways?\b/i,
  /\bwhat\s+would\s+happen\b/i,
  /\bcan\s+you\s+explain\b/i,
];

// Patterns that indicate simple factoid queries
const SIMPLE_INDICATORS = [
  /^(what|who|where|when)\s+is\b/i,
  /^(what|who|where|when)\s+was\b/i,
  /^(define|what\s+does)\b/i,
  /^(how\s+many|how\s+much)\b/i,
  /^(is|are|does|do|did|was|were)\s+\w+\b/i,
];

/**
 * Classify query complexity and return optimal retrieval parameters.
 */
export function classifyQueryComplexity(query: string): QueryComplexity {
  // P36-05: Cap query length to prevent unbounded split/regex operations
  const trimmed = query.trim().slice(0, 10_000);
  const wordCount = trimmed.split(/\s+/).length;
  const questionMarks = (trimmed.match(/\?/g) || []).length;
  const clauses = trimmed.split(/[,;]/).length;

  // Count matching indicators
  const complexMatches = COMPLEX_INDICATORS.filter((p) => p.test(trimmed)).length;
  const abstractMatches = ABSTRACT_INDICATORS.filter((p) => p.test(trimmed)).length;
  const simpleMatches = SIMPLE_INDICATORS.filter((p) => p.test(trimmed)).length;

  // Multi-question queries are always complex
  if (questionMarks >= 2) {
    return {
      level: "complex",
      k: 12,
      useHyde: true,
      reason: `multiple questions (${questionMarks})`,
    };
  }

  // Score-based classification
  let complexityScore = 0;

  // Word count contribution
  if (wordCount <= 6) complexityScore -= 1;
  else if (wordCount <= 15) complexityScore += 0;
  else if (wordCount <= 30) complexityScore += 1;
  else complexityScore += 2;

  // Pattern contributions
  complexityScore += complexMatches * 2;
  complexityScore += abstractMatches * 1;
  complexityScore -= simpleMatches * 1.5;

  // Clause count contribution
  if (clauses >= 3) complexityScore += 1;

  if (complexityScore >= 3) {
    return {
      level: "complex",
      k: 12,
      useHyde: abstractMatches > 0,
      reason: `high complexity (score=${complexityScore.toFixed(1)}, ${complexMatches} complex patterns)`,
    };
  }

  if (complexityScore >= 1) {
    return {
      level: "moderate",
      k: 7,
      useHyde: abstractMatches > 0,
      reason: `moderate complexity (score=${complexityScore.toFixed(1)})`,
    };
  }

  return {
    level: "simple",
    k: 3,
    useHyde: false,
    reason: `simple query (score=${complexityScore.toFixed(1)}, ${wordCount} words)`,
  };
}

/**
 * Get adaptive k for RAG retrieval, with optional override.
 */
export function getAdaptiveK(query: string, overrideK?: number): { k: number; useHyde: boolean; complexity: QueryComplexity } {
  if (overrideK !== undefined && overrideK > 0) {
    // P36-06: Cap overrideK to prevent unbounded retrieval
    const cappedK = Math.min(Math.floor(overrideK), 100);
    const complexity = classifyQueryComplexity(query);
    return { k: cappedK, useHyde: complexity.useHyde, complexity };
  }

  const complexity = classifyQueryComplexity(query);
  logger.debug({ query: query.substring(0, 80), ...complexity }, "Adaptive k selection");
  return { k: complexity.k, useHyde: complexity.useHyde, complexity };
}
