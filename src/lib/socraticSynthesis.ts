/**
 * Socratic Synthesis Rewrite — Phase 1.14
 *
 * Rewrites a direct council verdict into guided Socratic questions
 * that lead the user to discover the answer themselves.
 *
 * Inspired by Khanmigo (Khan Academy) — the AI tutor that uses
 * Socratic questioning rather than giving direct answers, building
 * deeper understanding through guided discovery.
 *
 * Activated when `mode: "socratic_synthesis"` is passed in the ask request,
 * OR when user setting `socraticSynthesis: true` is enabled.
 *
 * The rewrite is applied to the final verdict only — council opinions
 * remain unchanged so the user can still see the raw reasoning.
 */

import { askProvider } from "./providers.js";

const KHANMIGO_SYSTEM_PROMPT = `You are a Socratic tutor in the style of Khanmigo (Khan Academy's AI tutor).

Your task: given an informative answer, rewrite it as a series of guided Socratic questions that lead the student to discover the answer themselves.

Rules:
1. Do NOT state the answer directly — guide through questions.
2. Start with a broad framing question, then progressively narrower questions.
3. Offer hints if the concept is technical (prefix hints with "Hint:").
4. End with an invitation to try: "What do you think the answer is now?"
5. Keep the total response to 150–300 words.
6. Preserve any critical warnings or safety information from the original (state those directly).

Format:
- Use numbered questions (1. 2. 3. ...)
- Each question on its own line
- One optional hint per question in parentheses`;

/**
 * Rewrite a direct verdict as Socratic guided questions.
 * Uses the first available council member's provider for the rewrite call.
 */
export async function socraticRewrite(
  originalVerdict: string,
  question: string,
  provider: { model: string; apiKey?: string; baseUrl?: string; systemPrompt?: string },
): Promise<string> {
  const prompt = `Original question: "${question}"

Direct answer to rewrite:
${originalVerdict}

Rewrite this as Socratic guided questions (do NOT reveal the answer directly):`;

  try {
    const response = await askProvider(
      {
        name: "openai" as const,
        type: "api" as const,
        apiKey: provider.apiKey ?? "",
        model: provider.model,
        baseUrl: provider.baseUrl,
        systemPrompt: KHANMIGO_SYSTEM_PROMPT,
      },
      [{ role: "user", content: prompt }],
    );
    return response.text.trim();
  } catch {
    // Fallback: prepend a single framing question
    return `Rather than giving you the answer directly, let's explore this together:\n\nWhat do you already know about "${question}"?\n\nTake a moment to think through what you know, then I can help guide you further.`;
  }
}

/**
 * Check if socratic synthesis mode is enabled for this request.
 * Checks both the explicit summon field and the user settings.
 */
export function isSocraticSynthesisEnabled(
  deliberationMode: string,
  userSettings?: Record<string, unknown>,
): boolean {
  return (
    deliberationMode === "socratic_synthesis" ||
    !!userSettings?.socraticSynthesis
  );
}
