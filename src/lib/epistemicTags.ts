/**
 * Epistemic Status Tags — Phase 1.10
 *
 * Tags factual claims in LLM output with their certainty level.
 * Inspired by:
 * - Elicit (elicit.com) — surfaces uncertainty and evidence quality per claim
 * - Gwern's epistemic status annotations (gwern.net/about#confidence-tags)
 *
 * Tags: [established] [working hypothesis] [speculation] [contested]
 *
 * Implementation: post-process verdict text by injecting a system prompt
 * that instructs the model to annotate claims before synthesis.
 * Off by default — enabled via epistemicStatusTags user setting.
 */

export type EpistemicTag =
  | "established"
  | "working-hypothesis"
  | "speculation"
  | "contested"
  | "unknown";

/** System prompt injection for epistemic tagging (appended to master's system prompt) */
export const EPISTEMIC_SYSTEM_SUFFIX = `
---
EPISTEMIC TAGGING (active):
For every factual claim in your response, prepend an epistemic status tag:
- [established] — well-supported by evidence, expert consensus, or empirical data
- [working-hypothesis] — plausible and commonly assumed but not definitively proven
- [speculation] — possible but lacks strong evidence; informed guess
- [contested] — actively debated among experts; significant disagreement exists

Only tag claims of fact. Do not tag opinions, recommendations, or questions.
Example: "[established] The Earth orbits the Sun. [speculation] This approach may improve performance."
`;

/**
 * Wrap a system prompt with epistemic tagging instructions.
 * Applied to the master/synthesis agent's prompt only (not all members).
 */
export function wrapEpistemicSystemPrompt(existingPrompt: string): string {
  return existingPrompt
    ? `${existingPrompt}${EPISTEMIC_SYSTEM_SUFFIX}`
    : EPISTEMIC_SYSTEM_SUFFIX.trim();
}

/**
 * Parse epistemic tags from response text for display purposes.
 * Returns array of { tag, claim } objects.
 */
export interface TaggedClaim {
  tag: EpistemicTag;
  claim: string;
}

export function parseEpistemicTags(text: string): TaggedClaim[] {
  const pattern = /\[(established|working-hypothesis|speculation|contested)\]\s+([^[]+?)(?=\[|$)/gi;
  const results: TaggedClaim[] = [];
  let match;

  while ((match = pattern.exec(text)) !== null) {
    results.push({
      tag: match[1].toLowerCase() as EpistemicTag,
      claim: match[2].trim(),
    });
  }

  return results;
}
