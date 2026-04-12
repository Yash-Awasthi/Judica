import { AgentOutput } from "./schemas.js";
import { ScoredOpinion } from "./schemas.js";

export interface ControllerDecision {
  shouldHalt: boolean;
  reason?: string;
  selectTopK: number;
}

export class DeliberationController {
  private threshold = 0.85;
  private previousMaxScore: number;

  constructor() {
    this.previousMaxScore = 0;
  }

  decide(round: number, maxRounds: number, consensusScore: number): ControllerDecision {
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

  shouldAcceptRound(currentScored: ScoredOpinion[]): boolean {
    const currentMax = Math.max(...currentScored.map(s => s.scores.final), 0);
    
    const anyCriticalFailures = currentScored.some(s => {
      return s.scores.final < 0.2; // Assuming < 0.2 means critical logic/truth failure
    });

    if (currentMax <= this.previousMaxScore || anyCriticalFailures) {
      return false; // Discard round
    }
    
    this.previousMaxScore = currentMax;
    return true;
  }

  /** Reset per-deliberation state so the controller can be safely reused. */
  reset(): void {
    this.previousMaxScore = 0;
  }

  selectTopK(scored: ScoredOpinion[], k: number = 3): ScoredOpinion[] {
    return scored
      .filter(s => s.scores.final >= 0.5) // Phase 5: Strict outlier threshold
      .sort((a, b) => b.scores.final - a.scores.final)
      .slice(0, k);
  }
}

export function createController(): DeliberationController {
  return new DeliberationController();
}
