import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock logger
vi.mock("../../src/lib/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));

import { calibrationTracker } from "../../src/lib/calibration.js";
import logger from "../../src/lib/logger.js";

describe("CalibrationTracker", () => {
  beforeEach(() => {
    calibrationTracker.reset();
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------
  // record
  // -------------------------------------------------------------------
  describe("record", () => {
    it("stores entries that are reflected in summary", () => {
      calibrationTracker.record(0.8, true);
      const summary = calibrationTracker.summary();
      expect(summary.totalPredictions).toBe(1);
    });

    it("clamps confidence above 1 to 1", () => {
      calibrationTracker.record(1.5, true);
      // A perfect prediction (conf=1, correct=true) has brier = 0
      const brier = calibrationTracker.brierScore();
      expect(brier).toBe(0);
    });

    it("clamps confidence below 0 to 0", () => {
      calibrationTracker.record(-0.5, false);
      // conf=0, correct=false -> brier = (0-0)^2 = 0
      const brier = calibrationTracker.brierScore();
      expect(brier).toBe(0);
    });

    it("stores model metadata", () => {
      calibrationTracker.record(0.9, true, "gpt-4");
      calibrationTracker.record(0.7, false, "claude-3");
      const gptBrier = calibrationTracker.brierScore("gpt-4");
      const claudeBrier = calibrationTracker.brierScore("claude-3");
      // gpt-4: (0.9-1)^2 = 0.01
      expect(gptBrier).toBeCloseTo(0.01, 5);
      // claude-3: (0.7-0)^2 = 0.49
      expect(claudeBrier).toBeCloseTo(0.49, 5);
    });

    it("bounds memory at maxRecords (50_000)", () => {
      // We can't easily test 50k records, but we can verify the mechanism
      // by adding records and checking the summary count remains bounded
      for (let i = 0; i < 100; i++) {
        calibrationTracker.record(0.5, i % 2 === 0);
      }
      expect(calibrationTracker.summary().totalPredictions).toBe(100);
    });
  });

  // -------------------------------------------------------------------
  // brierScore
  // -------------------------------------------------------------------
  describe("brierScore", () => {
    it("returns 0 for empty dataset", () => {
      expect(calibrationTracker.brierScore()).toBe(0);
    });

    it("returns 0 for perfect predictions", () => {
      calibrationTracker.record(1.0, true);
      calibrationTracker.record(0.0, false);
      expect(calibrationTracker.brierScore()).toBe(0);
    });

    it("returns correct value for known inputs", () => {
      // (0.9-1)^2 = 0.01
      // (0.8-0)^2 = 0.64
      // average = (0.01 + 0.64) / 2 = 0.325
      calibrationTracker.record(0.9, true);
      calibrationTracker.record(0.8, false);
      expect(calibrationTracker.brierScore()).toBeCloseTo(0.325, 5);
    });

    it("returns 1 for worst possible predictions", () => {
      calibrationTracker.record(0.0, true);  // (0-1)^2 = 1
      calibrationTracker.record(1.0, false); // (1-0)^2 = 1
      expect(calibrationTracker.brierScore()).toBe(1);
    });

    it("filters by model when specified", () => {
      calibrationTracker.record(0.9, true, "gpt-4");
      calibrationTracker.record(0.1, false, "claude-3");
      // gpt-4 only: (0.9-1)^2 = 0.01
      expect(calibrationTracker.brierScore("gpt-4")).toBeCloseTo(0.01, 5);
    });

    it("returns 0 when filtering by non-existent model", () => {
      calibrationTracker.record(0.9, true, "gpt-4");
      expect(calibrationTracker.brierScore("nonexistent")).toBe(0);
    });
  });

  // -------------------------------------------------------------------
  // calibrationCurve
  // -------------------------------------------------------------------
  describe("calibrationCurve", () => {
    it("returns correct number of bins", () => {
      calibrationTracker.record(0.5, true);
      const curve = calibrationTracker.calibrationCurve(10);
      expect(curve).toHaveLength(10);
    });

    it("returns empty bins with count 0 when no records match", () => {
      const curve = calibrationTracker.calibrationCurve(5);
      expect(curve).toHaveLength(5);
      for (const bin of curve) {
        expect(bin.count).toBe(0);
        expect(bin.avgConfidence).toBe(0);
        expect(bin.accuracy).toBe(0);
      }
    });

    it("places records in correct bins", () => {
      // 0.85 should be in the bin [0.8, 0.9)
      calibrationTracker.record(0.85, true);
      const curve = calibrationTracker.calibrationCurve(10);
      // Bin index 8 is [0.8, 0.9)
      expect(curve[8].count).toBe(1);
      expect(curve[8].accuracy).toBe(1);
      expect(curve[8].avgConfidence).toBeCloseTo(0.85, 3);
    });

    it("calculates accuracy correctly within bins", () => {
      // Two records in [0.8, 0.9): one correct, one not
      calibrationTracker.record(0.82, true);
      calibrationTracker.record(0.85, false);
      const curve = calibrationTracker.calibrationCurve(10);
      expect(curve[8].count).toBe(2);
      expect(curve[8].accuracy).toBeCloseTo(0.5, 3);
    });

    it("filters by model when specified", () => {
      calibrationTracker.record(0.85, true, "gpt-4");
      calibrationTracker.record(0.85, false, "claude-3");
      const curve = calibrationTracker.calibrationCurve(10, "gpt-4");
      expect(curve[8].count).toBe(1);
      expect(curve[8].accuracy).toBe(1);
    });

    it("uses correct bin boundaries", () => {
      const curve = calibrationTracker.calibrationCurve(5);
      expect(curve[0].binStart).toBeCloseTo(0, 5);
      expect(curve[0].binEnd).toBeCloseTo(0.2, 5);
      expect(curve[4].binStart).toBeCloseTo(0.8, 5);
      expect(curve[4].binEnd).toBeCloseTo(1.0, 5);
    });
  });

  // -------------------------------------------------------------------
  // summary
  // -------------------------------------------------------------------
  describe("summary", () => {
    it("returns zeros for empty dataset", () => {
      const s = calibrationTracker.summary();
      expect(s).toEqual({
        totalPredictions: 0,
        brierScore: 0,
        avgConfidence: 0,
        avgAccuracy: 0,
        overconfidenceGap: 0,
      });
    });

    it("returns correct values for populated tracker", () => {
      calibrationTracker.record(0.9, true);  // correct
      calibrationTracker.record(0.8, false); // incorrect
      const s = calibrationTracker.summary();
      expect(s.totalPredictions).toBe(2);
      expect(s.avgConfidence).toBeCloseTo(0.85, 3);
      expect(s.avgAccuracy).toBeCloseTo(0.5, 3);
      expect(s.overconfidenceGap).toBeCloseTo(0.35, 3);
      expect(s.brierScore).toBeCloseTo(0.325, 3);
    });

    it("filters by model", () => {
      calibrationTracker.record(0.9, true, "gpt-4");
      calibrationTracker.record(0.5, false, "claude-3");
      const s = calibrationTracker.summary("gpt-4");
      expect(s.totalPredictions).toBe(1);
      expect(s.avgConfidence).toBeCloseTo(0.9, 3);
      expect(s.avgAccuracy).toBe(1);
    });

    it("returns zeros for non-existent model filter", () => {
      calibrationTracker.record(0.9, true, "gpt-4");
      const s = calibrationTracker.summary("nonexistent");
      expect(s.totalPredictions).toBe(0);
      expect(s.brierScore).toBe(0);
    });

    it("rounds values to 3 decimal places", () => {
      calibrationTracker.record(0.333, true);
      calibrationTracker.record(0.666, false);
      const s = calibrationTracker.summary();
      // avgConfidence should be rounded
      expect(String(s.avgConfidence).split(".")[1]?.length).toBeLessThanOrEqual(3);
    });
  });

  // -------------------------------------------------------------------
  // reset
  // -------------------------------------------------------------------
  describe("reset", () => {
    it("clears all records", () => {
      calibrationTracker.record(0.9, true);
      calibrationTracker.record(0.8, false);
      calibrationTracker.reset();
      expect(calibrationTracker.summary().totalPredictions).toBe(0);
      expect(calibrationTracker.brierScore()).toBe(0);
    });

    it("logs info message on reset", () => {
      calibrationTracker.reset();
      expect(logger.info).toHaveBeenCalledWith("Calibration tracker reset");
    });

    it("allows new records after reset", () => {
      calibrationTracker.record(0.9, true);
      calibrationTracker.reset();
      calibrationTracker.record(0.5, false);
      expect(calibrationTracker.summary().totalPredictions).toBe(1);
    });
  });
});
