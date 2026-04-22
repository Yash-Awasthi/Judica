import type { ScoredOpinion } from "./schemas.js";
import logger from "./logger.js";

export interface ControllerDecision {
  shouldHalt: boolean;
  reason?: string;
  selectTopK: number;
  bloomGateTriggered?: boolean;
}

/**
 * Bloom Gate: halt if consensus score degrades compared to the previous round
 * beyond the tolerance band. Prevents artificial convergence and logic
 * degradation across subsequent debate rounds.
 */
// P10-21: Convergence tolerance configurable via env var (default 0.03 = 3% dip tolerance)
// P19-05: Guard against NaN from invalid env var
const _parsedTolerance = parseFloat(process.env.BLOOM_GATE_TOLERANCE || "0.03");
const BLOOM_GATE_TOLERANCE = Number.isFinite(_parsedTolerance) && _parsedTolerance >= 0 ? _parsedTolerance : 0.03;

export class DeliberationController {
  private threshold = 0.85;
  private previousMaxScore: number;
  private peakConsensusScore: number;
  private roundScores: number[];

  constructor() {
    this.previousMaxScore = 0;
    this.peakConsensusScore = 0;
    this.roundScores = [];
  }

  decide(round: number, maxRounds: number, consensusScore: number): ControllerDecision {
    // Track round-over-round consensus history
    this.roundScores.push(consensusScore);
    const previousRoundScore =
      this.roundScores.length >= 2 ? this.roundScores[this.roundScores.length - 2] : 0;

    // Update peak
    if (consensusScore > this.peakConsensusScore) {
      this.peakConsensusScore = consensusScore;
    }

    // Bloom Gate: halt when current round degrades beyond tolerance vs previous round
    if (round > 1 && previousRoundScore > 0) {
      const delta = consensusScore - previousRoundScore;
      if (delta < -BLOOM_GATE_TOLERANCE) {
        return {
          shouldHalt: true,
          bloomGateTriggered: true,
          reason: `Bloom Gate: consensus degraded ${(delta * 100).toFixed(1)}% `
            + `(${(previousRoundScore * 100).toFixed(1)}% → ${(consensusScore * 100).toFixed(1)}%). `
            + `Halting to preserve peak quality.`,
          selectTopK: 3,
        };
      }
    }

    if (consensusScore >= this.threshold) {
      return {
        shouldHalt: true,
        reason: `Consensus score ${(consensusScore * 100).toFixed(1)}% reached deterministic threshold.`,
        selectTopK: 3,
      };
    }

    if (round >= maxRounds) {
      return {
        shouldHalt: true,
        reason: "Maximum rounds reached.",
        selectTopK: 5,
      };
    }

    return { shouldHalt: false, selectTopK: 0 };
  }

  // P10-22: Validate that rounds have responses before accepting
  validateRoundResponses(responseCount: number): boolean {
    if (responseCount === 0) {
      logger.warn("Empty round detected — zero archetype responses. Round rejected.");
      return false;
    }
    return true;
  }

  shouldAcceptRound(currentScored: ScoredOpinion[]): boolean {
    // P10-22: Reject empty rounds
    if (currentScored.length === 0) {
      logger.warn("shouldAcceptRound called with empty scored list — rejecting");
      return false;
    }
    const currentMax = Math.max(...currentScored.map((s) => s.scores.final), 0);

    const anyCriticalFailures = currentScored.some((s) => s.scores.final < 0.2);

    if (currentMax <= this.previousMaxScore || anyCriticalFailures) {
      return false;
    }

    this.previousMaxScore = currentMax;
    return true;
  }

  /**
   * P10-20: Actually revert state when a round is discarded.
   * Callers MUST invoke this when shouldAcceptRound() returns false
   * to remove the discarded round's score from history.
   */
  discardLastRound(): void {
    if (this.roundScores.length > 0) {
      this.roundScores.pop();
    }
    // Recalculate peak from remaining rounds
    this.peakConsensusScore = this.roundScores.length > 0
      ? Math.max(...this.roundScores)
      : 0;
  }

  /** Reset per-deliberation state so the controller can be safely reused. */
  reset(): void {
    this.previousMaxScore = 0;
    this.peakConsensusScore = 0;
    this.roundScores = [];
  }

  selectTopK(scored: ScoredOpinion[], k = 3): ScoredOpinion[] {
    const qualified = scored.filter((s) => s.scores.final >= 0.5);
    // P10-23: Log filtering stats so callers can distinguish "no good" from "no responses"
    if (qualified.length < scored.length) {
      logger.debug({
        total: scored.length,
        qualified: qualified.length,
        filtered: scored.length - qualified.length,
        minScore: scored.length > 0 ? Math.min(...scored.map(s => s.scores.final)).toFixed(3) : "N/A",
      }, "selectTopK: responses below 0.5 quality threshold filtered out");
    }
    return qualified
      .sort((a, b) => b.scores.final - a.scores.final)
      .slice(0, k);
  }

  /**
   * P10-24: Returns the peak consensus score observed across all rounds.
   * Exposed for use in deliberation metadata (trace, audit log, response headers).
   * Callers: endTrace(), councilService response assembly.
   */
  getPeakScore(): number {
    return this.peakConsensusScore;
  }
}

export function createController(): DeliberationController {
  return new DeliberationController();
}
