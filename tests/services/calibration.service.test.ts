import { describe, it, expect, beforeEach } from "vitest";
import {
  recordPrediction,
  computeBrierScore,
  computeCalibrationCurve,
  getCalibrationGap,
  resetPredictions,
} from "../../src/services/calibration.service.js";

describe("Calibration Service", () => {
  beforeEach(() => {
    resetPredictions();
  });

  describe("recordPrediction", () => {
    it("stores a prediction that affects Brier score", () => {
      recordPrediction(0.9, true);
      const score = computeBrierScore();
      expect(score.sampleCount).toBe(1);
    });

    it("clamps confidence above 1 to 1", () => {
      recordPrediction(1.5, true);
      const score = computeBrierScore();
      // confidence clamped to 1.0, outcome=1 => (1-1)^2 = 0
      expect(score.score).toBe(0);
    });

    it("clamps confidence below 0 to 0", () => {
      recordPrediction(-0.5, false);
      const score = computeBrierScore();
      // confidence clamped to 0.0, outcome=0 => (0-0)^2 = 0
      expect(score.score).toBe(0);
    });

    it("stores a timestamp on each prediction", () => {
      const before = new Date();
      recordPrediction(0.5, true);
      // Verify the prediction was stored (indirectly via sampleCount)
      expect(computeBrierScore().sampleCount).toBe(1);
      expect(computeBrierScore().timestamp).toBeTruthy();
    });

    it("handles multiple predictions", () => {
      recordPrediction(0.8, true);
      recordPrediction(0.2, false);
      recordPrediction(0.5, true);
      expect(computeBrierScore().sampleCount).toBe(3);
    });
  });

  describe("computeBrierScore", () => {
    it("returns score=0 and sampleCount=0 for empty predictions", () => {
      const result = computeBrierScore();
      expect(result.score).toBe(0);
      expect(result.sampleCount).toBe(0);
    });

    it("returns a valid ISO timestamp", () => {
      const result = computeBrierScore();
      expect(result.timestamp).toBeTruthy();
      expect(() => new Date(result.timestamp)).not.toThrow();
    });

    it("returns 0 for a perfect prediction (confidence=1, correct=true)", () => {
      recordPrediction(1.0, true);
      const result = computeBrierScore();
      expect(result.score).toBe(0);
    });

    it("returns 1 for the worst prediction (confidence=1, correct=false)", () => {
      recordPrediction(1.0, false);
      const result = computeBrierScore();
      expect(result.score).toBe(1);
    });

    it("returns 1 for the worst prediction (confidence=0, correct=true)", () => {
      recordPrediction(0.0, true);
      const result = computeBrierScore();
      expect(result.score).toBe(1);
    });

    it("returns 0 for perfect prediction (confidence=0, correct=false)", () => {
      recordPrediction(0.0, false);
      const result = computeBrierScore();
      expect(result.score).toBe(0);
    });

    it("computes correct Brier score for mixed predictions", () => {
      // (0.9 - 1)^2 = 0.01
      recordPrediction(0.9, true);
      // (0.1 - 0)^2 = 0.01
      recordPrediction(0.1, false);
      const result = computeBrierScore();
      expect(result.score).toBeCloseTo(0.01, 5);
      expect(result.sampleCount).toBe(2);
    });

    it("computes correct score for mediocre predictions", () => {
      // (0.5 - 1)^2 = 0.25
      recordPrediction(0.5, true);
      // (0.5 - 0)^2 = 0.25
      recordPrediction(0.5, false);
      const result = computeBrierScore();
      expect(result.score).toBeCloseTo(0.25, 5);
    });

    it("computes correct score for a single mid-range prediction", () => {
      // (0.7 - 1)^2 = 0.09
      recordPrediction(0.7, true);
      expect(computeBrierScore().score).toBeCloseTo(0.09, 5);
    });
  });

  describe("computeCalibrationCurve", () => {
    it("returns empty array when no predictions", () => {
      const curve = computeCalibrationCurve();
      expect(curve).toEqual([]);
    });

    it("returns correct bucket centers for default 10 buckets", () => {
      // Add predictions across different confidence ranges
      recordPrediction(0.05, false); // bucket 0: center 0.05
      recordPrediction(0.15, true);  // bucket 1: center 0.15
      recordPrediction(0.85, true);  // bucket 8: center 0.85
      recordPrediction(0.95, true);  // bucket 9: center 0.95

      const curve = computeCalibrationCurve();
      const bucketCenters = curve.map((p) => p.bucket);
      expect(bucketCenters).toContain(0.05);
      expect(bucketCenters).toContain(0.15);
      expect(bucketCenters).toContain(0.85);
      expect(bucketCenters).toContain(0.95);
    });

    it("computes correct accuracy within a bucket", () => {
      // All in 0.8-0.9 bucket (center 0.85)
      recordPrediction(0.85, true);
      recordPrediction(0.82, true);
      recordPrediction(0.88, false);

      const curve = computeCalibrationCurve();
      const bucket = curve.find((p) => p.bucket === 0.85);
      expect(bucket).toBeDefined();
      expect(bucket!.actualAccuracy).toBeCloseTo(2 / 3, 5);
      expect(bucket!.sampleCount).toBe(3);
    });

    it("respects custom bucketCount", () => {
      recordPrediction(0.1, true);
      recordPrediction(0.3, false);
      recordPrediction(0.5, true);
      recordPrediction(0.7, false);
      recordPrediction(0.9, true);

      const curve5 = computeCalibrationCurve(5);
      // With 5 buckets: 0-0.2, 0.2-0.4, 0.4-0.6, 0.6-0.8, 0.8-1.0
      // Each prediction falls in a different bucket
      expect(curve5.length).toBe(5);
    });

    it("defaults to 10 when bucketCount is NaN", () => {
      recordPrediction(0.5, true);
      const curve = computeCalibrationCurve(NaN);
      // Should use default of 10, prediction at 0.5 falls in 5th bucket
      expect(curve.length).toBe(1);
      // Center should be 0.55 for bucket 5 (0.50-0.60) with 10 buckets
      expect(curve[0].bucket).toBe(0.55);
    });

    it("defaults to 10 when bucketCount is 0", () => {
      recordPrediction(0.5, true);
      const curve = computeCalibrationCurve(0);
      expect(curve.length).toBe(1);
      expect(curve[0].bucket).toBe(0.55);
    });

    it("defaults to 10 when bucketCount is negative", () => {
      recordPrediction(0.5, true);
      const curve = computeCalibrationCurve(-5);
      expect(curve.length).toBe(1);
      expect(curve[0].bucket).toBe(0.55);
    });

    it("caps bucketCount at 100", () => {
      recordPrediction(0.5, true);
      const curve = computeCalibrationCurve(200);
      // With 100 buckets, bucket size = 0.01
      // 0.5 falls in bucket 50 (0.50-0.51), center = 0.505
      expect(curve.length).toBe(1);
      expect(curve[0].bucket).toBe(0.51); // Math.round(0.505 * 100) / 100
    });

    it("floors non-integer bucketCount", () => {
      recordPrediction(0.5, true);
      const curve = computeCalibrationCurve(10.9);
      // Should floor to 10
      expect(curve[0].bucket).toBe(0.55);
    });

    it("only includes buckets with predictions", () => {
      recordPrediction(0.15, true);
      recordPrediction(0.85, false);

      const curve = computeCalibrationCurve();
      expect(curve.length).toBe(2);
    });

    it("computes predictedConfidence as bucket center", () => {
      recordPrediction(0.35, true);
      const curve = computeCalibrationCurve();
      const bucket = curve.find((p) => Math.abs(p.bucket - 0.35) < 0.01);
      expect(bucket).toBeDefined();
      expect(bucket!.predictedConfidence).toBeCloseTo(0.35, 2);
    });
  });

  describe("getCalibrationGap", () => {
    it("returns 0 when no predictions", () => {
      expect(getCalibrationGap()).toBe(0);
    });

    it("returns small gap for well-calibrated predictions", () => {
      // In bucket 0.45-0.55 (center 0.5), need confidence in that range
      // With 10 buckets, 0.5 falls in bucket 5 (0.50-0.60, center 0.55)
      // 50% correct => gap = |0.55 - 0.5| = 0.05
      recordPrediction(0.5, true);
      recordPrediction(0.5, false);
      expect(getCalibrationGap()).toBeCloseTo(0.05, 2);
    });

    it("returns correct gap for skewed predictions", () => {
      // Confidence 0.9-1.0 (center 0.95), but 0% correct => gap = 0.95
      recordPrediction(0.95, false);
      recordPrediction(0.95, false);
      expect(getCalibrationGap()).toBeCloseTo(0.95, 2);
    });

    it("returns max gap across all buckets", () => {
      // Bucket 0.0-0.1 (center 0.05): 100% correct => gap = |0.05-1| = 0.95
      recordPrediction(0.05, true);
      // Bucket 0.9-1.0 (center 0.95): 100% correct => gap = |0.95-1| = 0.05
      recordPrediction(0.95, true);

      const gap = getCalibrationGap();
      expect(gap).toBeCloseTo(0.95, 2);
    });
  });

  describe("resetPredictions", () => {
    it("clears all stored predictions", () => {
      recordPrediction(0.8, true);
      recordPrediction(0.3, false);
      expect(computeBrierScore().sampleCount).toBe(2);

      resetPredictions();
      expect(computeBrierScore().sampleCount).toBe(0);
    });

    it("Brier score returns 0 after reset", () => {
      recordPrediction(0.5, true);
      resetPredictions();
      const result = computeBrierScore();
      expect(result.score).toBe(0);
      expect(result.sampleCount).toBe(0);
    });

    it("calibration curve returns empty after reset", () => {
      recordPrediction(0.5, true);
      resetPredictions();
      expect(computeCalibrationCurve()).toEqual([]);
    });
  });

  describe("Memory bounding (MAX_PREDICTIONS = 10000)", () => {
    it("evicts oldest entries when exceeding MAX_PREDICTIONS", () => {
      // Add 10001 predictions, first ones should be evicted
      for (let i = 0; i < 10001; i++) {
        recordPrediction(0.5, true);
      }
      const result = computeBrierScore();
      expect(result.sampleCount).toBeLessThanOrEqual(10000);
    });

    it("still computes correctly after eviction", () => {
      // Fill to capacity with correct predictions
      for (let i = 0; i < 10000; i++) {
        recordPrediction(1.0, true);
      }
      // Add one more that's wrong
      recordPrediction(1.0, false);

      const result = computeBrierScore();
      expect(result.sampleCount).toBeLessThanOrEqual(10000);
      // Score should be close to 0 since almost all are perfect, with 1 wrong
      expect(result.score).toBeLessThan(0.01);
    });
  });
});
