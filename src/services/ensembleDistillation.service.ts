/**
 * P4-49: Ensemble distillation.
 *
 * Uses council deliberation outputs to generate training datasets
 * for fine-tuning smaller local models. The council acts as a "teacher"
 * producing high-quality examples.
 */

import logger from "../lib/logger.js";

export interface TrainingSample {
  id: string;
  question: string;
  context?: string;
  response: string;
  confidence: number;
  archetypeContributions: Record<string, number>;
  quality: "high" | "medium" | "low";
  timestamp: string;
}

export interface DistillationConfig {
  minConfidence: number;         // Only include high-confidence verdicts
  minAgreement: number;          // Minimum archetype agreement ratio
  maxSamples: number;            // Cap dataset size
  includeReasoning: boolean;     // Include chain-of-thought in training data
  format: "jsonl" | "alpaca" | "sharegpt";
}

const DEFAULT_CONFIG: DistillationConfig = {
  minConfidence: 0.8,
  minAgreement: 0.7,
  maxSamples: 10000,
  includeReasoning: true,
  format: "jsonl",
};

/**
 * Filter deliberation results that are high-quality enough for training.
 */
export function filterForTraining(
  samples: TrainingSample[],
  config: DistillationConfig = DEFAULT_CONFIG,
): TrainingSample[] {
  return samples
    .filter((s) => s.confidence >= config.minConfidence)
    .filter((s) => s.quality === "high" || s.quality === "medium")
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, config.maxSamples);
}

/**
 * Convert training samples to JSONL format for fine-tuning.
 */
export function toJSONL(samples: TrainingSample[], includeReasoning: boolean = true): string {
  return samples.map((s) => {
    const entry: Record<string, unknown> = {
      messages: [
        { role: "user", content: s.question },
        { role: "assistant", content: s.response },
      ],
    };

    if (includeReasoning && s.context) {
      (entry.messages as Array<Record<string, string>>).splice(1, 0, {
        role: "system",
        content: `Context: ${s.context}`,
      });
    }

    return JSON.stringify(entry);
  }).join("\n");
}

/**
 * Convert to Alpaca format for instruction tuning.
 */
export function toAlpacaFormat(samples: TrainingSample[]): string {
  const entries = samples.map((s) => ({
    instruction: s.question,
    input: s.context || "",
    output: s.response,
  }));

  return JSON.stringify(entries, null, 2);
}

/**
 * Compute quality metrics for the distillation dataset.
 */
export function computeDatasetMetrics(samples: TrainingSample[]): {
  totalSamples: number;
  avgConfidence: number;
  qualityDistribution: Record<string, number>;
  avgResponseLength: number;
} {
  const total = samples.length;
  if (total === 0) {
    return { totalSamples: 0, avgConfidence: 0, qualityDistribution: {}, avgResponseLength: 0 };
  }

  const avgConf = samples.reduce((s, x) => s + x.confidence, 0) / total;
  const avgLen = samples.reduce((s, x) => s + x.response.length, 0) / total;

  const distribution: Record<string, number> = {};
  for (const s of samples) {
    distribution[s.quality] = (distribution[s.quality] || 0) + 1;
  }

  return {
    totalSamples: total,
    avgConfidence: Math.round(avgConf * 100) / 100,
    qualityDistribution: distribution,
    avgResponseLength: Math.round(avgLen),
  };
}
