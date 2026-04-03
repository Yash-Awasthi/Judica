import logger from "./logger.js";

export type QueryType = "factual" | "analytical" | "creative" | "strategic" | "ethical" | "technical";

export interface RouterResult {
  type: QueryType;
  archetypes: string[];
  confidence: number;
  reasoning: string;
  fallback: boolean;
}

interface QueryPattern {
  type: QueryType;
  keywords: string[];
  phrasePatterns: string[];
  keywordWeight: number;
  phraseWeight: number;
}

// ── Query Classification Patterns ──────────────────────────────────────────

const QUERY_PATTERNS: QueryPattern[] = [
  {
    type: "factual",
    keywords: [
      "what is", "who is", "when", "where", "how many", "how much",
      "latest", "news", "current", "today", "yesterday", "recent",
      "fact", "data", "statistic", "population", "definition",
      "weather", "price", "stock", "market", "election", "score",
      "history", "historical", "born", "died", "founded"
    ],
    phrasePatterns: [
      "what's the", "what are the", "tell me about", "information about",
      "lookup", "search for", "find out", "get me", "current events"
    ],
    keywordWeight: 1,
    phraseWeight: 3
  },
  {
    type: "analytical",
    keywords: [
      "analyze", "analysis", "compare", "comparison", "evaluate",
      "assessment", "review", "breakdown", "examine", "investigate",
      "study", "research", "data", "metrics", "performance",
      "trend", "pattern", "correlation", "statistics", "report",
      "pros and cons", "advantages", "disadvantages", "strengths",
      "weaknesses", "opportunities", "threats", "swot"
    ],
    phrasePatterns: [
      "how does", "why does", "what causes", "what are the reasons",
      "explain why", "root cause", "deep dive", "in depth"
    ],
    keywordWeight: 1,
    phraseWeight: 3
  },
  {
    type: "creative",
    keywords: [
      "create", "design", "write", "generate", "compose", "craft",
      "story", "poem", "song", "script", "novel", "character",
      "imagine", "brainstorm", "idea", "concept", "innovative",
      "artistic", "creative", "original", "unique", "inspired",
      "fiction", "fantasy", "sci-fi", "romance", "mystery",
      "marketing", "slogan", "tagline", "campaign", "brand"
    ],
    phrasePatterns: [
      "come up with", "think of", "help me write", "write a",
      "make up", "invent", "fantasy about", "story about"
    ],
    keywordWeight: 1,
    phraseWeight: 3
  },
  {
    type: "strategic",
    keywords: [
      "strategy", "strategic", "plan", "planning", "roadmap",
      "goal", "objective", "mission", "vision", "initiative",
      "prioritize", "focus", "direction", "long-term", "future",
      "growth", "expansion", "scale", "scaling", "market",
      "competitive", "advantage", "positioning", "differentiation",
      "business", "startup", "company", "organization", "team"
    ],
    phrasePatterns: [
      "how to grow", "how to scale", "how to expand", "best approach",
      "action plan", "next steps", "way forward", "path to",
      "strategy for", "plan for"
    ],
    keywordWeight: 1,
    phraseWeight: 3
  },
  {
    type: "ethical",
    keywords: [
      "should i", "should we", "is it right", "is it wrong",
      "ethical", "ethics", "moral", "morality", "values",
      "principles", "fair", "unfair", "just", "unjust",
      "responsibility", "accountable", "consequence", "impact",
      "dilemma", "choice", "decision", "tension",
      "privacy", "consent", "autonomy", "rights", "harm",
      "benefit", "risk", "safety", "trust", "transparency"
    ],
    phrasePatterns: [
      "is it okay to", "would it be", "is it ethical", "morally",
      "right thing", "wrong thing", "ethical to", "permissible"
    ],
    keywordWeight: 1,
    phraseWeight: 3
  },
  {
    type: "technical",
    keywords: [
      "code", "programming", "software", "hardware", "system",
      "architecture", "database", "api", "server", "client",
      "frontend", "backend", "fullstack", "devops", "cloud",
      "aws", "azure", "gcp", "docker", "kubernetes", "container",
      "javascript", "typescript", "python", "java", "go", "rust",
      "react", "vue", "angular", "node", "express", "django",
      "bug", "error", "fix", "debug", "optimize", "performance",
      "security", "vulnerability", "encrypt", "authenticate",
      "framework", "library", "dependency", "package", "module"
    ],
    phrasePatterns: [
      "how to implement", "how to build", "how to fix",
      "error in", "bug in", "code for", "function to",
      "class for", "api for", "endpoint for"
    ],
    keywordWeight: 1,
    phraseWeight: 3
  }
];

// ── Scoring and Classification ─────────────────────────────────────────────

interface Scores {
  factual: number;
  analytical: number;
  creative: number;
  strategic: number;
  ethical: number;
  technical: number;
}

/**
 * Calculate scores for all query types based on keyword/phrase matching.
 */
function calculateScores(query: string): Scores {
  const lowerQuery = query.toLowerCase();
  const scores: Scores = {
    factual: 0,
    analytical: 0,
    creative: 0,
    strategic: 0,
    ethical: 0,
    technical: 0
  };

  for (const pattern of QUERY_PATTERNS) {
    let score = 0;

    // Keyword matches
    for (const keyword of pattern.keywords) {
      if (lowerQuery.includes(keyword)) {
        score += pattern.keywordWeight;
      }
    }

    // Phrase pattern matches (higher weight)
    for (const phrase of pattern.phrasePatterns) {
      if (lowerQuery.includes(phrase)) {
        score += pattern.phraseWeight;
      }
    }

    scores[pattern.type] = score;
  }

  return scores;
}

/**
 * Select best query type from scores.
 */
function selectBestType(scores: Scores): { type: QueryType; score: number; totalScore: number } {
  let maxScore = -1;
  let bestType: QueryType = "analytical";
  let totalScore = 0;

  for (const [type, score] of Object.entries(scores)) {
    const s = score as number;
    totalScore += s;
    if (s > maxScore) {
      maxScore = s;
      bestType = type as QueryType;
    }
  }

  return { type: bestType, score: maxScore, totalScore };
}

/**
 * Calculate real confidence: score[top] / sum(all_scores)
 */
function calculateConfidence(topScore: number, totalScore: number): number {
  if (totalScore === 0 || !isFinite(topScore) || !isFinite(totalScore) || topScore < 0 || totalScore < 0) return 0;
  return Math.min(Math.max(topScore / totalScore, 0), 1);
}

// ── Archetype Mapping ──────────────────────────────────────────────────────

// Primary archetypes for each type
const PRIMARY_ARCHETYPES: Record<QueryType, string[]> = {
  factual: ["empiricist", "historian"],
  analytical: ["architect", "strategist"],
  creative: ["creator", "outsider"],
  strategic: ["strategist", "futurist"],
  ethical: ["ethicist", "empath"],
  technical: ["architect", "empiricist"]
};

// Opposing/diversity archetypes to ensure balanced perspective
const DIVERSITY_ARCHETYPES: Record<QueryType, string[]> = {
  factual: ["contrarian"],
  analytical: ["outsider"],
  creative: ["pragmatist"],
  strategic: ["empiricist"],
  ethical: ["strategist"],
  technical: ["futurist"]
};

/**
 * Build diverse archetype set with 2-4 agents.
 * Always includes primary + diversity archetype for balanced perspective.
 */
function buildArchetypeSet(type: QueryType, confidence: number): string[] {
  const primary = PRIMARY_ARCHETYPES[type] || ["strategist", "architect"];
  const diversity = DIVERSITY_ARCHETYPES[type] || ["outsider"];

  // Always include at least 2: primary + diversity
  const archetypes = [...primary, diversity[0]];

  // Add second primary if confidence is high enough (3 agents)
  if (confidence >= 0.5 && primary[1]) {
    archetypes.push(primary[1]);
  }

  // Add another diversity if very confident (4 agents max)
  if (confidence >= 0.7 && diversity[1]) {
    archetypes.push(diversity[1]);
  }

  // Remove duplicates while preserving order
  return [...new Set(archetypes)];
}

// ── Fallback Configuration ────────────────────────────────────────────────

const FALLBACK_ARCHETYPES = ["strategist", "architect", "empiricist", "outsider"];
const CONFIDENCE_THRESHOLD = 0.4;

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Classify a query and return appropriate archetypes.
 *
 * @param query - The user query string
 * @returns RouterResult with type, archetypes, confidence, reasoning, and fallback flag
 */
export function classifyQuery(query: string): RouterResult {
  const startTime = Date.now();

  // Calculate scores for all types
  const scores = calculateScores(query);
  const { type, score: topScore, totalScore } = selectBestType(scores);

  // Calculate real confidence: topScore / totalScore
  const confidence = calculateConfidence(topScore, totalScore);

  // Determine if we should use fallback
  const useFallback = confidence < CONFIDENCE_THRESHOLD;

  // Build archetype set (or use fallback)
  const archetypes = useFallback ? FALLBACK_ARCHETYPES : buildArchetypeSet(type, confidence);

  // Build reasoning
  let reasoning: string;
  if (useFallback) {
    reasoning = `Low confidence (${confidence.toFixed(2)}), using balanced fallback council`;
  } else {
    const matches = Object.entries(scores)
      .filter(([_, s]) => s > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([t, s]) => `${t}(${s})`)
      .join(", ");
    reasoning = `Selected ${type} [${matches}]`;
  }

  logger.debug({
    query: query.slice(0, 50),
    type,
    confidence,
    archetypes,
    fallback: useFallback,
    scores,
    durationMs: Date.now() - startTime
  }, "Query classified");

  return {
    type,
    archetypes,
    confidence,
    reasoning,
    fallback: useFallback
  };
}

/**
 * Get all available query types.
 */
export function getQueryTypes(): QueryType[] {
  return ["factual", "analytical", "creative", "strategic", "ethical", "technical"];
}

/**
 * Check if query classification has sufficient confidence for auto-routing.
 *
 * @param result - RouterResult from classifyQuery
 * @param threshold - Minimum confidence (default: 0.4)
 * @returns boolean indicating if auto-routing should proceed
 */
export function shouldAutoRoute(result: RouterResult, threshold = CONFIDENCE_THRESHOLD): boolean {
  return result.confidence >= threshold;
}

/**
 * Format router result for logging/metadata.
 */
export function formatRouterMetadata(result: RouterResult): Record<string, unknown> {
  return {
    routerType: result.type,
    routerConfidence: result.confidence,
    routerArchetypes: result.archetypes,
    routerReasoning: result.reasoning,
    routerFallback: result.fallback
  };
}

/**
 * Get archetypes for auto mode (ignores user input completely).
 * Returns router-selected archetypes or fallback set.
 */
export function getAutoArchetypes(query: string): { archetypes: string[]; result: RouterResult } {
  const result = classifyQuery(query);
  return { archetypes: result.archetypes, result };
}