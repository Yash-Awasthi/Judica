/**
 * P4-47: Calibration curves and Brier score tracking.
 *
 * Current confidence formula is heuristic with no ground truth.
 * This module provides tools to measure and improve calibration:
 *
 * - Brier score: measures accuracy of probabilistic predictions
 *   Lower = better. 0 = perfect, 0.25 = random, 1 = always wrong.
 *
 * - Calibration bins: group predictions by confidence bracket and
 *   compare stated confidence to actual accuracy.
 *
 * Usage:
 *   tracker.record(0.85, true);   // predicted 85% confident, was correct
 *   tracker.record(0.90, false);  // predicted 90% confident, was wrong
 *   const brier = tracker.brierScore();
 *   const curve = tracker.calibrationCurve(10);
 */

import logger from "./logger.js";

export interface CalibrationBin {
  /** Lower bound of confidence bracket (e.g., 0.8) */
  binStart: number;
  /** Upper bound of confidence bracket (e.g., 0.9) */
  binEnd: number;
  /** Average stated confidence in this bin */
  avgConfidence: number;
  /** Fraction of predictions in this bin that were actually correct */
  accuracy: number;
  /** Number of predictions in this bin */
  count: number;
}

export interface CalibrationRecord {
  confidence: number; // stated confidence 0–1
  correct: boolean;   // ground truth: was the answer correct?
  model?: string;
  timestamp: Date;
}

class CalibrationTracker {
  private records: CalibrationRecord[] = [];
  private maxRecords = 50_000;

  /** Record a prediction outcome. */
  record(confidence: number, correct: boolean, model?: string): void {
    this.records.push({
      confidence: Math.max(0, Math.min(1, confidence)),
      correct,
      model,
      timestamp: new Date(),
    });

    // Bound memory
    if (this.records.length > this.maxRecords) {
      this.records = this.records.slice(-this.maxRecords);
    }
  }

  /**
   * Brier score = (1/N) * Σ(confidence - outcome)²
   * Where outcome is 1 (correct) or 0 (incorrect).
   */
  brierScore(model?: string): number {
    const filtered = model
      ? this.records.filter((r) => r.model === model)
      : this.records;

    if (filtered.length === 0) return NaN;

    const sum = filtered.reduce((acc, r) => {
      const outcome = r.correct ? 1 : 0;
      return acc + (r.confidence - outcome) ** 2;
    }, 0);

    return sum / filtered.length;
  }

  /**
   * Generate calibration curve with N bins.
   * Each bin shows average confidence vs actual accuracy.
   */
  calibrationCurve(bins: number = 10, model?: string): CalibrationBin[] {
    const filtered = model
      ? this.records.filter((r) => r.model === model)
      : this.records;

    const binSize = 1 / bins;
    const result: CalibrationBin[] = [];

    for (let i = 0; i < bins; i++) {
      const binStart = i * binSize;
      const binEnd = (i + 1) * binSize;
      const inBin = filtered.filter(
        (r) => r.confidence >= binStart && r.confidence < binEnd,
      );

      if (inBin.length === 0) {
        result.push({ binStart, binEnd, avgConfidence: 0, accuracy: 0, count: 0 });
        continue;
      }

      const avgConf = inBin.reduce((s, r) => s + r.confidence, 0) / inBin.length;
      const accuracy = inBin.filter((r) => r.correct).length / inBin.length;

      result.push({
        binStart,
        binEnd,
        avgConfidence: Math.round(avgConf * 1000) / 1000,
        accuracy: Math.round(accuracy * 1000) / 1000,
        count: inBin.length,
      });
    }

    return result;
  }

  /** Get summary statistics. */
  summary(model?: string): {
    totalPredictions: number;
    brierScore: number;
    avgConfidence: number;
    avgAccuracy: number;
    overconfidenceGap: number;
  } {
    const filtered = model
      ? this.records.filter((r) => r.model === model)
      : this.records;

    if (filtered.length === 0) {
      return { totalPredictions: 0, brierScore: NaN, avgConfidence: 0, avgAccuracy: 0, overconfidenceGap: 0 };
    }

    const avgConf = filtered.reduce((s, r) => s + r.confidence, 0) / filtered.length;
    const avgAcc = filtered.filter((r) => r.correct).length / filtered.length;

    return {
      totalPredictions: filtered.length,
      brierScore: this.brierScore(model),
      avgConfidence: Math.round(avgConf * 1000) / 1000,
      avgAccuracy: Math.round(avgAcc * 1000) / 1000,
      overconfidenceGap: Math.round((avgConf - avgAcc) * 1000) / 1000,
    };
  }

  /** Clear all records. */
  reset(): void {
    this.records = [];
    logger.info("Calibration tracker reset");
  }
}

export const calibrationTracker = new CalibrationTracker();
