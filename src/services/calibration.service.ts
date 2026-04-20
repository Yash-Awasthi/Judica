/**
 * P4-47: Calibration curves and Brier score tracking.
 *
 * Measures how well the council's confidence scores predict actual correctness.
 * - Brier score: lower is better (0 = perfect, 1 = worst)
 * - Calibration curve: groups predictions by confidence bucket, measures actual accuracy
 */


export interface CalibrationPoint {
  bucket: number;         // confidence range center (e.g., 0.85 for 0.80-0.90)
  predictedConfidence: number;
  actualAccuracy: number;
  sampleCount: number;
}

export interface BrierScore {
  score: number;          // 0-1, lower is better
  sampleCount: number;
  timestamp: string;
}

export interface PredictionRecord {
  confidence: number;     // council's predicted confidence (0-1)
  wasCorrect: boolean;    // ground truth outcome
  timestamp: Date;
}

// In-memory store for predictions (would use DB in production)
const predictions: PredictionRecord[] = [];

/**
 * Record a prediction and its outcome for calibration tracking.
 */
export function recordPrediction(confidence: number, wasCorrect: boolean): void {
  predictions.push({
    confidence: Math.max(0, Math.min(1, confidence)),
    wasCorrect,
    timestamp: new Date(),
  });
}

/**
 * Compute Brier score for all recorded predictions.
 * Brier = (1/N) * Σ(confidence - outcome)²
 */
export function computeBrierScore(): BrierScore {
  if (predictions.length === 0) {
    return { score: 0, sampleCount: 0, timestamp: new Date().toISOString() };
  }

  const sum = predictions.reduce((acc, p) => {
    const outcome = p.wasCorrect ? 1 : 0;
    return acc + Math.pow(p.confidence - outcome, 2);
  }, 0);

  return {
    score: sum / predictions.length,
    sampleCount: predictions.length,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Generate calibration curve data (10 buckets from 0.0-1.0).
 */
export function computeCalibrationCurve(bucketCount: number = 10): CalibrationPoint[] {
  const bucketSize = 1.0 / bucketCount;
  const points: CalibrationPoint[] = [];

  for (let i = 0; i < bucketCount; i++) {
    const low = i * bucketSize;
    const high = (i + 1) * bucketSize;
    const center = (low + high) / 2;

    const inBucket = predictions.filter(
      (p) => p.confidence >= low && p.confidence < high,
    );

    if (inBucket.length > 0) {
      const actualCorrect = inBucket.filter((p) => p.wasCorrect).length;
      points.push({
        bucket: Math.round(center * 100) / 100,
        predictedConfidence: center,
        actualAccuracy: actualCorrect / inBucket.length,
        sampleCount: inBucket.length,
      });
    }
  }

  return points;
}

/**
 * Get calibration gap (max deviation between predicted and actual).
 * A well-calibrated system has gap close to 0.
 */
export function getCalibrationGap(): number {
  const curve = computeCalibrationCurve();
  if (curve.length === 0) return 0;

  return Math.max(
    ...curve.map((p) => Math.abs(p.predictedConfidence - p.actualAccuracy)),
  );
}

/**
 * Reset prediction store (for testing).
 */
export function resetPredictions(): void {
  predictions.length = 0;
}
