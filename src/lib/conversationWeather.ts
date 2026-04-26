/**
 * Conversation Weather — Phase 1.11
 *
 * A single at-a-glance indicator of epistemic health derived from
 * existing deliberation metrics (no extra API cost).
 *
 * Conditions:
 * - Sunny   (☀️)  — strong consensus, high confidence, few open questions
 * - Cloudy  (⛅)  — moderate agreement, some uncertainty
 * - Foggy   (🌫️)  — low information, models are guessing, inconclusive
 * - Stormy  (⛈️)  — high disagreement, many conflicts, low confidence
 *
 * Inspired by Argilla (Apache 2.0, argilla-io/argilla) — data quality indicators
 * and annotation confidence visualisations.
 */

export type WeatherCondition = "sunny" | "cloudy" | "foggy" | "stormy";

export interface WeatherReport {
  condition: WeatherCondition;
  emoji: string;
  label: string;
  description: string;
  /** 0–1: overall epistemic health score */
  healthScore: number;
}

export interface DeliberationMetrics {
  /** 0–1: how much the council agrees */
  consensusScore?: number;
  /** Number of detected conflicts between members */
  conflictCount?: number;
  /** 0–1: average confidence across members */
  avgConfidence?: number;
  /** Number of open questions / hedging phrases detected */
  openQuestionCount?: number;
  /** Number of council members who participated */
  memberCount?: number;
}

const WEATHER_EMOJIS: Record<WeatherCondition, string> = {
  sunny: "☀️",
  cloudy: "⛅",
  foggy: "🌫️",
  stormy: "⛈️",
};

const WEATHER_LABELS: Record<WeatherCondition, string> = {
  sunny: "Clear Consensus",
  cloudy: "Partial Agreement",
  foggy: "Low Confidence",
  stormy: "High Disagreement",
};

const WEATHER_DESCRIPTIONS: Record<WeatherCondition, string> = {
  sunny: "Strong council consensus. High confidence in the response.",
  cloudy: "Moderate agreement. Some members have differing views.",
  foggy: "Inconclusive. Models have limited information or are uncertain.",
  stormy: "Significant disagreement. Multiple conflicting perspectives.",
};

/**
 * Compute the conversation weather from deliberation metrics.
 * Mirrors Argilla's annotation confidence score aggregation approach.
 */
export function computeWeather(metrics: DeliberationMetrics): WeatherReport {
  const consensus = metrics.consensusScore ?? 0.5;
  const conflicts = metrics.conflictCount ?? 0;
  const confidence = metrics.avgConfidence ?? 0.5;
  const openQ = metrics.openQuestionCount ?? 0;

  // Health score: weighted combination of positive signals
  const conflictPenalty = Math.min(conflicts * 0.1, 0.4);
  const openQPenalty = Math.min(openQ * 0.05, 0.2);
  const healthScore = Math.max(0, Math.min(1,
    (consensus * 0.5) + (confidence * 0.3) - conflictPenalty - openQPenalty,
  ));

  let condition: WeatherCondition;
  if (healthScore >= 0.7) condition = "sunny";
  else if (healthScore >= 0.45) condition = "cloudy";
  else if (conflicts >= 3 || consensus < 0.3) condition = "stormy";
  else condition = "foggy";

  return {
    condition,
    emoji: WEATHER_EMOJIS[condition],
    label: WEATHER_LABELS[condition],
    description: WEATHER_DESCRIPTIONS[condition],
    healthScore: Math.round(healthScore * 100) / 100,
  };
}

/**
 * Extract weather metrics from raw council opinions.
 * Counts hedging phrases as open question signals.
 */
const HEDGING_PATTERNS = [
  /\b(unclear|uncertain|unknown|debatable|controversial|it depends|arguably)\b/gi,
  /\b(may|might|could|possibly|perhaps|potentially)\b/gi,
  /\?$/gm,
];

export function extractWeatherMetrics(
  opinions: Array<{ opinion: string; confidence?: number }>,
  consensusScore?: number,
): DeliberationMetrics {
  let openQuestionCount = 0;
  let totalConfidence = 0;
  let confidenceCount = 0;

  for (const op of opinions) {
    if (op.confidence !== undefined) {
      totalConfidence += op.confidence;
      confidenceCount++;
    }
    for (const pattern of HEDGING_PATTERNS) {
      const matches = op.opinion.match(pattern);
      if (matches) openQuestionCount += matches.length;
      pattern.lastIndex = 0;
    }
  }

  return {
    consensusScore,
    conflictCount: 0, // populated from deliberation phases
    avgConfidence: confidenceCount > 0 ? totalConfidence / confidenceCount : undefined,
    openQuestionCount: Math.min(openQuestionCount, 20),
    memberCount: opinions.length,
  };
}
