/**
 * Ensemble distillation.
 *
 * Use the council to generate training datasets for smaller local models.
 * After a deliberation reaches high-confidence consensus, the query-answer
 * pair can be exported as a distillation training sample.
 *
 * The idea: if 4+ LLMs agree on an answer with high confidence, that
 * answer is likely correct and can train a smaller model to approximate
 * the council's collective intelligence.
 *
 * Usage:
 *   recordDistillationSample({ query, answer, confidence, models });
 *   const dataset = exportDistillationDataset("jsonl");
 */

import { randomUUID } from "crypto";
import logger from "./logger.js";

export interface DistillationSample {
  id: string;
  query: string;
  answer: string;
  confidence: number;
  consensusScore: number;
  participatingModels: string[];
  createdAt: string;
  metadata?: Record<string, unknown>;
}

const distillationStore: DistillationSample[] = [];
const MAX_SAMPLES = 100_000;
const MIN_CONFIDENCE_THRESHOLD = 0.75;
const MAX_QUERY_LENGTH = 50_000; // 50 KB cap per field
const MAX_ANSWER_LENGTH = 200_000; // 200 KB cap per field
const MAX_METADATA_KEYS = 50;

function truncate(value: string, limit: number): string {
  return value.length > limit ? value.slice(0, limit) : value;
}

function clampMetadata(
  meta: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!meta) return meta;
  const keys = Object.keys(meta);
  if (keys.length <= MAX_METADATA_KEYS) return meta;
  const clamped: Record<string, unknown> = {};
  for (let i = 0; i < MAX_METADATA_KEYS; i++) {
    clamped[keys[i]] = meta[keys[i]];
  }
  return clamped;
}

/**
 * Record a distillation sample from a high-confidence council verdict.
 * Only records if confidence exceeds the threshold.
 */
export function recordDistillationSample(sample: {
  query: string;
  answer: string;
  confidence: number;
  consensusScore: number;
  participatingModels: string[];
  metadata?: Record<string, unknown>;
}): boolean {
  if (sample.confidence < MIN_CONFIDENCE_THRESHOLD) {
    return false; // Not confident enough for training data
  }

  const entry: DistillationSample = {
    // Use crypto.randomUUID for collision-resistant IDs instead of Math.random
    id: `ds_${randomUUID()}`,
    query: sample.query,
    answer: sample.answer,
    confidence: sample.confidence,
    consensusScore: sample.consensusScore,
    participatingModels: sample.participatingModels,
    createdAt: new Date().toISOString(),
    metadata: clampMetadata(sample.metadata),
  };

  distillationStore.push(entry);

  // Bound memory — drop the oldest half when we exceed the cap.
  // This amortises the O(n) copy: instead of shifting on every insert
  // once at capacity, we pay once per (MAX_SAMPLES / 2) inserts.
  if (distillationStore.length > MAX_SAMPLES) {
    const keep = Math.floor(MAX_SAMPLES / 2);
    const start = distillationStore.length - keep;
    const recent = distillationStore.slice(start);
    distillationStore.length = 0;
    distillationStore.push(...recent);
  }

  logger.debug({ sampleId: entry.id, confidence: entry.confidence }, "Distillation sample recorded");
  return true;
}

/**
 * Export distillation dataset in various formats.
 */
export function exportDistillationDataset(
  format: "jsonl" | "json" | "openai" = "jsonl",
  minConfidence: number = MIN_CONFIDENCE_THRESHOLD,
): string {
  const filtered = distillationStore.filter((s) => s.confidence >= minConfidence);

  switch (format) {
    case "json":
      return JSON.stringify(filtered, null, 2);

    case "openai":
      // OpenAI fine-tuning format
      return filtered
        .map((s) =>
          JSON.stringify({
            messages: [
              { role: "user", content: s.query },
              { role: "assistant", content: s.answer },
            ],
          }),
        )
        .join("\n");

    case "jsonl":
    default:
      return filtered.map((s) => JSON.stringify(s)).join("\n");
  }
}

/** Get sample count. */
export function getDistillationStats(): {
  totalSamples: number;
  avgConfidence: number;
  modelCoverage: Record<string, number>;
} {
  if (distillationStore.length === 0) {
    return { totalSamples: 0, avgConfidence: 0, modelCoverage: {} };
  }

  const avgConf = distillationStore.reduce((s, r) => s + r.confidence, 0) / distillationStore.length;
  const coverage: Record<string, number> = {};
  for (const s of distillationStore) {
    for (const m of s.participatingModels) {
      coverage[m] = (coverage[m] || 0) + 1;
    }
  }

  return {
    totalSamples: distillationStore.length,
    avgConfidence: Math.round(avgConf * 1000) / 1000,
    modelCoverage: coverage,
  };
}

/** Clear all samples. */
export function clearDistillationStore(): void {
  distillationStore.length = 0;
}
