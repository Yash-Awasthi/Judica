/**
 * P4-48: Counterfactual debate mode.
 *
 * Forces an agent to argue the opposite position of the current consensus,
 * then measures how robust the original verdict is to counterarguments.
 */

import logger from "../lib/logger.js";

export interface CounterfactualResult {
  originalVerdict: string;
  counterArgument: string;
  rebuttal: string;
  robustnessScore: number;  // 0-1: how well the original verdict withstands challenge
  verdictChanged: boolean;
  reason?: string;
}

export interface DebateRound {
  position: "for" | "against";
  argument: string;
  strength: number;          // 0-1
  archetype?: string;
}

/**
 * Generate the counterfactual prompt that forces the opposite position.
 */
export function buildCounterfactualPrompt(
  originalQuestion: string,
  originalVerdict: string,
  context?: string,
): string {
  return `You are playing devil's advocate. The council reached this verdict:

"${originalVerdict}"

For the question: "${originalQuestion}"
${context ? `\nContext: ${context}` : ""}

Your task: Construct the STRONGEST possible argument AGAINST this verdict.
Find weaknesses, contradictions, overlooked evidence, or logical fallacies.
Be rigorous and specific. Do not simply say "it could be wrong" — explain exactly why and how.`;
}

/**
 * Evaluate how robust the original verdict is against the counterargument.
 * Higher score = more robust (harder to overturn).
 */
export function evaluateRobustness(rounds: DebateRound[]): number {
  if (rounds.length === 0) return 0.5;

  const forStrengths = rounds.filter((r) => r.position === "for").map((r) => r.strength);
  const againstStrengths = rounds.filter((r) => r.position === "against").map((r) => r.strength);

  const avgFor = forStrengths.length > 0
    ? forStrengths.reduce((a, b) => a + b, 0) / forStrengths.length
    : 0.5;

  const avgAgainst = againstStrengths.length > 0
    ? againstStrengths.reduce((a, b) => a + b, 0) / againstStrengths.length
    : 0.5;

  // Robustness = how much stronger the "for" position is vs "against"
  const raw = (avgFor - avgAgainst + 1) / 2; // normalize to 0-1
  return Math.max(0, Math.min(1, raw));
}

/**
 * Determine if the verdict should change based on counterfactual debate.
 * Only flips if counterarguments are significantly stronger.
 */
export function shouldFlipVerdict(
  robustness: number,
  flipThreshold: number = 0.35,
): { flip: boolean; confidence: number } {
  if (robustness < flipThreshold) {
    return { flip: true, confidence: 1 - robustness };
  }
  return { flip: false, confidence: robustness };
}
