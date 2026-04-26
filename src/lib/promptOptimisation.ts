/**
 * DSPy-Inspired Prompt Auto-Optimisation — Phase 2.12
 *
 * Automatically finds better system prompts for each archetype by
 * optimising against the user's personal feedback history.
 *
 * Inspired by:
 * - DSPy (MIT, Stanford, stanfordnlp/dspy, 23k stars) — automatic prompt
 *   optimisation using few-shot examples and a feedback signal
 *
 * Constraints (hard rules):
 * - NEVER runs automatically — only user-triggered
 * - Requires 50+ rated responses before running
 * - Shows token/cost estimate before running
 * - After running, returns a diff so user can review + revert
 * - Stores original prompt before overwriting (for one-click revert)
 *
 * Optimisation strategy:
 * 1. Collect top-rated Q→A pairs for a specific archetype
 * 2. Extract patterns: what makes these responses good?
 * 3. Generate a candidate improved system prompt using those patterns
 * 4. Return diff (old vs new) for user review — no auto-apply
 */

import { db } from "./drizzle.js";
import { chats } from "../db/schema/conversations.js";
import { customPersonas } from "../db/schema/council.js";
import { askProvider } from "./providers.js";
import { eq, gte, and, isNotNull, desc } from "drizzle-orm";

export interface PromptOptimisationResult {
  agentId:         string;
  originalPrompt:  string;
  proposedPrompt:  string;
  diff:            string;
  examplesUsed:    number;
  estimatedTokens: number;
}

const MIN_EXAMPLES = 50;

/** Estimate tokens for the optimisation request (~4 chars per token). */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Build a simple line-level diff string. */
function simpleDiff(before: string, after: string): string {
  const bLines = before.split("\n");
  const aLines = after.split("\n");
  const removed = bLines.filter(l => !aLines.includes(l)).map(l => `- ${l}`);
  const added   = aLines.filter(l => !bLines.includes(l)).map(l => `+ ${l}`);
  return [...removed, ...added].join("\n") || "(no changes)";
}

/**
 * Estimate the cost/tokens of an optimisation run without running it.
 * Returns token estimate and whether there are enough examples.
 */
export async function estimateOptimisationCost(
  userId: number,
  agentId: string,
): Promise<{ tokenEstimate: number; eligible: boolean; exampleCount: number }> {
  const rows = await db
    .select({ question: chats.question, verdict: chats.verdict })
    .from(chats)
    .where(and(
      eq(chats.userId, userId),
      gte((chats as any).rating, 1),
      isNotNull(chats.verdict),
    ))
    .orderBy(desc((chats as any).rating))
    .limit(100);

  const exampleCount = rows.length;
  const sampleText = rows.slice(0, 20).map(r => `Q: ${r.question}\nA: ${r.verdict}`).join("\n\n");
  const tokenEstimate = estimateTokens(sampleText) + 1500; // +1500 for prompt + completion

  return { tokenEstimate, eligible: exampleCount >= MIN_EXAMPLES, exampleCount };
}

/**
 * Run prompt optimisation for a specific archetype.
 * Generates a candidate improved system prompt based on feedback history.
 *
 * @param userId     - User whose feedback history to use
 * @param agentId    - Archetype council member id
 * @param masterProvider - LLM to use for optimisation (defaults to first available)
 */
export async function optimiseAgentPrompt(
  userId: number,
  agentId: string,
): Promise<PromptOptimisationResult | null> {
  // 1. Load current system prompt for this archetype
  const [agentRow] = await db
    .select({ systemPrompt: (customPersonas as any).systemPrompt, name: (customPersonas as any).name })
    .from(customPersonas as any)
    .where(and(
      eq((customPersonas as any).userId, userId),
      eq((customPersonas as any).id, agentId),
    ))
    .limit(1);

  const originalPrompt = agentRow?.systemPrompt ?? "";

  // 2. Load top-rated examples
  const rows = await db
    .select({ question: chats.question, verdict: chats.verdict })
    .from(chats)
    .where(and(
      eq(chats.userId, userId),
      gte((chats as any).rating, 1),
      isNotNull(chats.verdict),
    ))
    .orderBy(desc((chats as any).rating))
    .limit(20);

  if (rows.length < MIN_EXAMPLES) return null;

  const examples = rows.slice(0, 15).map((r, i) =>
    `Example ${i + 1}:\nUser: ${r.question}\nResponse: ${r.verdict}`
  ).join("\n\n---\n\n");

  const optimisationPrompt = `You are a prompt engineering expert. Your task is to improve a system prompt for an AI assistant archetype based on examples of responses the user rated highly.

Current system prompt:
<current_prompt>
${originalPrompt || "(none)"}
</current_prompt>

Here are 15 examples of responses the user rated positively:
<examples>
${examples}
</examples>

Based on these examples, write an improved system prompt that would consistently produce responses like these. The new prompt should:
1. Preserve the archetype's core identity and role
2. Emphasise communication patterns the user clearly prefers
3. Be specific about tone, depth, and format based on the examples
4. Be concise — no longer than 300 words

Return ONLY the new system prompt text, nothing else.`;

  const estimatedTokens = estimateTokens(optimisationPrompt) + 400;

  const result = await askProvider(
    { name: "openai", type: "api", apiKey: process.env.OPENAI_API_KEY ?? "", model: "gpt-4o-mini", systemPrompt: "You are a prompt engineering assistant." },
    [{ role: "user", content: optimisationPrompt }],
    false,
  );

  const proposedPrompt = result.text.trim();
  const diff = simpleDiff(originalPrompt, proposedPrompt);

  return {
    agentId,
    originalPrompt,
    proposedPrompt,
    diff,
    examplesUsed: rows.length,
    estimatedTokens,
  };
}
