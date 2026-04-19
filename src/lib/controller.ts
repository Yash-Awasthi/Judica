import { ScoredOpinion } from "./schemas.js";

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
const BLOOM_GATE_TOLERANCE = 0.03; // allow up to 3% dip before halting

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

  shouldAcceptRound(currentScored: ScoredOpinion[]): boolean {
    const currentMax = Math.max(...currentScored.map((s) => s.scores.final), 0);

    const anyCriticalFailures = currentScored.some((s) => s.scores.final < 0.2);

    if (currentMax <= this.previousMaxScore || anyCriticalFailures) {
      return false;
    }

    this.previousMaxScore = currentMax;
    return true;
  }

  /** Reset per-deliberation state so the controller can be safely reused. */
  reset(): void {
    this.previousMaxScore = 0;
    this.peakConsensusScore = 0;
    this.roundScores = [];
  }

  selectTopK(scored: ScoredOpinion[], k = 3): ScoredOpinion[] {
    return scored
      .filter((s) => s.scores.final >= 0.5)
      .sort((a, b) => b.scores.final - a.scores.final)
      .slice(0, k);
  }

  /** Returns the peak consensus score observed across all rounds. */
  getPeakScore(): number {
    return this.peakConsensusScore;
  }
}

export function createController(): DeliberationController {
  return new DeliberationController();
}
