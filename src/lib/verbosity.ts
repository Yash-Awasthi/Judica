/**
 * Response Verbosity Control — Phase 1.24
 *
 * Adjusts the depth and length of AI responses via a per-request verbosity level.
 * Injected as a system prompt suffix to guide the model's output style.
 *
 * Inspired by:
 * - Open WebUI (MIT, open-webui/open-webui) — per-chat response style override
 *   where users can set verbosity in the chat header
 *
 * Levels:
 * - concise    — max 2–3 sentences, no elaboration
 * - standard   — balanced response (default behavior)
 * - detailed   — structured with headers/lists, full reasoning shown
 * - exhaustive — comprehensive, cite sources, show all steps and alternatives
 */

export type VerbosityLevel = "concise" | "standard" | "detailed" | "exhaustive";

const VERBOSITY_SYSTEM_SUFFIXES: Record<VerbosityLevel, string> = {
  concise: `\n\n[VERBOSITY: CONCISE] Respond in 2–3 sentences maximum. Be direct. No preamble, no elaboration. If a list is needed, use at most 3 items.`,
  standard: ``, // default — no override
  detailed: `\n\n[VERBOSITY: DETAILED] Provide a well-structured response. Use headers or numbered sections where appropriate. Show your reasoning and explain key concepts clearly.`,
  exhaustive: `\n\n[VERBOSITY: EXHAUSTIVE] Provide an in-depth, comprehensive response. Cover all relevant aspects, edge cases, and alternatives. Use structured sections with headers. Cite sources or examples where available. Leave nothing important unexplored.`,
};

/**
 * Apply verbosity level to a master system prompt.
 * If level is "standard" or undefined, the prompt is unchanged.
 */
export function applyVerbosity(systemPrompt: string, level?: VerbosityLevel): string {
  if (!level || level === "standard") return systemPrompt;
  const suffix = VERBOSITY_SYSTEM_SUFFIXES[level];
  return systemPrompt ? `${systemPrompt}${suffix}` : suffix.trim();
}

/**
 * Adjust maxTokens based on verbosity level.
 * Concise responses need fewer tokens; exhaustive need more.
 */
export function adjustMaxTokensForVerbosity(maxTokens: number, level?: VerbosityLevel): number {
  if (!level) return maxTokens;
  const multipliers: Record<VerbosityLevel, number> = {
    concise: 0.3,
    standard: 1.0,
    detailed: 1.5,
    exhaustive: 2.0,
  };
  return Math.round(maxTokens * (multipliers[level] ?? 1.0));
}
