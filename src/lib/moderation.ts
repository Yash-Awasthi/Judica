/**
 * Automated Moderation — Phase 1.21
 *
 * Content moderation layer that checks user input and AI output
 * using the OpenAI Moderation API (free endpoint) or heuristic fallback.
 *
 * Inspired by:
 * - LibreChat (MIT, danny-avila/LibreChat) — optional OpenAI moderation
 *   middleware with configurable block/warn thresholds
 *
 * Configuration:
 * - MODERATION_ENABLED=true — enable moderation (default: false)
 * - OPENAI_MODERATION_KEY — OpenAI API key for moderation endpoint
 *   If not set, falls back to local heuristic patterns
 * - MODERATION_BLOCK_THRESHOLD=0.9 — score above which to block (0–1)
 * - MODERATION_WARN_THRESHOLD=0.7  — score above which to warn
 *
 * Categories checked: hate, harassment, self-harm, sexual, violence
 */

const MODERATION_ENABLED = process.env.MODERATION_ENABLED === "true";
const OPENAI_MOD_KEY = process.env.OPENAI_MODERATION_KEY ?? process.env.OPENAI_API_KEY;
const BLOCK_THRESHOLD = parseFloat(process.env.MODERATION_BLOCK_THRESHOLD ?? "0.9");
const WARN_THRESHOLD = parseFloat(process.env.MODERATION_WARN_THRESHOLD ?? "0.7");

const OPENAI_MODERATION_URL = "https://api.openai.com/v1/moderations";

export interface ModerationResult {
  /** Whether the content is flagged as policy violation */
  flagged: boolean;
  /** Whether the content should be hard-blocked (above block threshold) */
  blocked: boolean;
  /** Category scores (0–1) */
  scores: Record<string, number>;
  /** Highest scoring category */
  topCategory: string;
  /** Highest score */
  topScore: number;
}

/** Hard-coded fallback patterns for offline moderation */
const HEURISTIC_PATTERNS = [
  /\b(bomb\s*making|how\s+to\s+make\s+explosives?|synthesize\s+meth)\b/i,
  /\b(CSAM|child\s+pornography|child\s+sexual\s+abuse)\b/i,
  /\b(kill\s+yourself|you\s+should\s+die|self[-\s]harm\s+methods)\b/i,
];

function heuristicModerate(text: string): ModerationResult {
  for (const pattern of HEURISTIC_PATTERNS) {
    if (pattern.test(text)) {
      return {
        flagged: true,
        blocked: true,
        scores: { "violence/graphic": 0.95 },
        topCategory: "violence/graphic",
        topScore: 0.95,
      };
    }
  }
  return {
    flagged: false,
    blocked: false,
    scores: {},
    topCategory: "none",
    topScore: 0,
  };
}

async function openaiModerate(text: string): Promise<ModerationResult> {
  const response = await fetch(OPENAI_MODERATION_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_MOD_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ input: text.slice(0, 2000) }), // API limit
  });

  if (!response.ok) {
    throw new Error(`Moderation API error: ${response.status}`);
  }

  const data = await response.json() as {
    results: Array<{
      flagged: boolean;
      categories: Record<string, boolean>;
      category_scores: Record<string, number>;
    }>;
  };

  const result = data.results[0];
  const scores = result.category_scores;
  const entries = Object.entries(scores);
  const [topCategory, topScore] = entries.reduce(
    (max, [k, v]) => v > max[1] ? [k, v] : max,
    ["none", 0] as [string, number],
  );

  return {
    flagged: result.flagged,
    blocked: topScore >= BLOCK_THRESHOLD,
    scores,
    topCategory,
    topScore,
  };
}

/**
 * Run moderation on a text string.
 * Returns a ModerationResult. If moderation is disabled, returns a pass-through result.
 */
export async function moderateContent(text: string): Promise<ModerationResult> {
  if (!MODERATION_ENABLED) {
    return { flagged: false, blocked: false, scores: {}, topCategory: "none", topScore: 0 };
  }

  try {
    if (OPENAI_MOD_KEY) {
      return await openaiModerate(text);
    }
    return heuristicModerate(text);
  } catch {
    // On API failure, fall back to heuristic
    return heuristicModerate(text);
  }
}

export { MODERATION_ENABLED, BLOCK_THRESHOLD, WARN_THRESHOLD };
