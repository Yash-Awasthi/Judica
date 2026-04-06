import { AgentOutput } from "./schemas.js";
import { ScoredOpinion } from "./schemas.js";

/**
 * Controller-level decision making for the AI Council deliberation engine.
 */
export interface ControllerDecision {
  shouldHalt: boolean;
  reason?: string;
  selectTopK: number;
}

export class DeliberationController {
  private threshold = 0.85;
  private previousMaxScore = 0;

  /**
   * Evaluates whether to continue deliberation based on current consensus.
   * Phase 1 & 5 IMPLEMENT.
   */
  decide(round: number, maxRounds: number, consensusScore: number): ControllerDecision {
    // Phase 1: Pure mathematical halt
    if (consensusScore >= this.threshold) {
      return {
        shouldHalt: true,
        reason: `Consensus score ${(consensusScore * 100).toFixed(1)}% reached deterministic threshold.`,
        selectTopK: 3
      };
    }

    if (round >= maxRounds) {
      return {
        shouldHalt: true,
        reason: "Maximum rounds reached.",
        selectTopK: 5
      };
    }

    return {
      shouldHalt: false,
      selectTopK: 0
    };
  }

  /**
   * Phase 4: Validates if the current round improved quality.
   * If currentMax < previousMax OR any critical validation failures: signal discard.
   */
  shouldAcceptRound(currentScored: ScoredOpinion[]): boolean {
    const currentMax = Math.max(...currentScored.map(s => s.scores.final), 0);
    
    // Check for catastrophic validation failures in the council
    const anyCriticalFailures = currentScored.some(s => {
      // If final score is heavily penalized by validation, we consider it a failure
      // or we can check the structured data if we passed it along.
      // For now, let's use the score degradation as primary and add the validation requirement.
      return s.scores.final < 0.2; // Assuming < 0.2 means critical logic/truth failure
    });

    if (currentMax <= this.previousMaxScore || anyCriticalFailures) {
      return false; // Discard round
    }
    
    this.previousMaxScore = currentMax;
    return true;
  }

  /**
   * Phase 5: Selects the high-fidelity opinions for synthesis.
   * Removes outliers (score < 0.5) and ranks by mathematical agreement.
   */
  selectTopK(scored: ScoredOpinion[], k: number = 3): ScoredOpinion[] {
    return scored
      .filter(s => s.scores.final >= 0.5) // Phase 5: Strict outlier threshold
      .sort((a, b) => b.scores.final - a.scores.final)
      .slice(0, k);
  }
}

export const controller = new DeliberationController();
