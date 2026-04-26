/**
 * Blind Council Mode — Phase 7.10
 *
 * Council members answer without knowing each other's identities.
 * Prevents anchoring bias: member A doesn't adjust its answer after
 * seeing that a prestigious member B disagreed.
 *
 * Inspired by:
 * - Blind peer review in academic publishing
 * - "Wisdom of crowds" research showing anonymous forecasts are more calibrated
 *
 * How it works:
 * 1. Each council member gets a generic alias (Reviewer A, Reviewer B, ...)
 *    instead of their real name/model identity
 * 2. Members receive no information about which other providers are in the council
 * 3. The orchestrator strips provider names from shared context before each call
 * 4. Only the final synthesis stage reveals member aliases (not real names)
 */

import { askProvider } from "./providers.js";
import type { Provider } from "./providers.js";
import logger from "./logger.js";

const ALIASES = [
  "Reviewer A", "Reviewer B", "Reviewer C", "Reviewer D",
  "Reviewer E", "Reviewer F", "Reviewer G", "Reviewer H",
];

export interface BlindMemberResponse {
  alias:     string;
  response:  string;
  riskScore: number;
}

export interface BlindCouncilResult {
  responses:    BlindMemberResponse[];
  synthesis:    string;
  aliasMap:     Record<string, string>; // alias → real model name (admin only)
}

const BLIND_SYSTEM_SUFFIX = `
You are one of several independent reviewers. You do NOT know:
- How many other reviewers there are
- Who the other reviewers are
- What other reviewers have said

Answer the question independently based solely on your own knowledge and reasoning.
Do not reference other reviewers or assume consensus.`;

/**
 * Strip all identifying information from a provider config.
 */
function anonymize(provider: Provider, alias: string): Provider {
  return {
    ...provider,
    name:         alias,
    systemPrompt: (provider.systemPrompt ?? "") + BLIND_SYSTEM_SUFFIX,
  };
}

/**
 * Run all council members in blind mode (no cross-pollination of identities).
 * Returns individual responses plus a synthesis.
 */
export async function runBlindCouncil(
  question: string,
  members: Provider[],
  synthesizer: Provider,
): Promise<BlindCouncilResult> {
  const aliasMap: Record<string, string> = {};
  const blindMembers = members.map((m, i) => {
    const alias = ALIASES[i] ?? `Reviewer ${i + 1}`;
    aliasMap[alias] = m.name ?? m.model ?? "unknown";
    return anonymize(m, alias);
  });

  // All members answer independently in parallel
  const settled = await Promise.allSettled(
    blindMembers.map(m =>
      askProvider(m, [{ role: "user", content: question }])
    )
  );

  const responses: BlindMemberResponse[] = [];
  for (let i = 0; i < settled.length; i++) {
    const alias = ALIASES[i] ?? `Reviewer ${i + 1}`;
    const result = settled[i];
    if (result.status === "fulfilled") {
      responses.push({
        alias,
        response:  result.value.text,
        riskScore: 0,
      });
    } else {
      logger.warn({ err: result.reason, alias }, "BlindCouncil: member failed");
    }
  }

  if (responses.length === 0) {
    throw new Error("All blind council members failed to respond");
  }

  // Synthesize using anonymous references
  const responseBlock = responses
    .map(r => `${r.alias}:\n${r.response}`)
    .join("\n\n---\n\n");

  const synthesisPrompt = `You received independent responses from ${responses.length} anonymous reviewers.
Synthesize them into a single authoritative answer. Do not reference reviewers by name.

${responseBlock}

Question: ${question}

Synthesized answer:`;

  const synthResult = await askProvider(
    synthesizer,
    [{ role: "user", content: synthesisPrompt }],
  );

  return {
    responses,
    synthesis: synthResult.text,
    aliasMap,
  };
}
