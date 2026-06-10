/**
 * STM (Short-Term Modifier) Modules
 *
 * Prompt-level modifiers applied to every council member's system prompt.
 * They reshape AI behavior without changing the council configuration.
 *
 * Modules:
 *   hedge_reducer  — Strips hedging language ("it depends", "I think", "arguably")
 *   direct_mode    — Forces blunt, numbered, no-padding answers
 *   curiosity_bias — Pushes toward exploratory, hypothetical, counter-intuitive angles
 */

export type STMModuleId = "hedge_reducer" | "direct_mode" | "curiosity_bias";

export interface STMModule {
  id:          STMModuleId;
  label:       string;
  description: string;
  icon:        string;
  injection:   string;   // appended to system prompt
  conflictsWith?: STMModuleId[];
}

export const STM_MODULES: STMModule[] = [
  {
    id:          "hedge_reducer",
    label:       "Hedge Reducer",
    description: "Eliminates hedging, caveats, and wishy-washy qualifications.",
    icon:        "✂",
    conflictsWith: ["curiosity_bias"],
    injection: `
MODIFIER — HEDGE REDUCER (active):
- NEVER use: "it depends", "there are many perspectives", "arguably", "some might say", "I think", "in my opinion", "it's hard to say", "this is complex"
- NEVER add unnecessary caveats or disclaimers
- State conclusions directly: "X is better because Y" not "X might be better in some cases"
- If you genuinely don't know, say "I don't know" — not a paragraph of hedging
- One clear answer per question unless the answer is genuinely binary
`.trim(),
  },
  {
    id:          "direct_mode",
    label:       "Direct Mode",
    description: "Forces blunt, numbered answers. No padding, no preamble.",
    icon:        "⚡",
    injection: `
MODIFIER — DIRECT MODE (active):
- NEVER restate the question or say "great question"
- NEVER write a warm opener or closer
- Lead with the answer immediately
- Use numbered lists for multi-part answers
- Remove all padding phrases ("In conclusion", "To summarize", "As mentioned")
- Maximum information density — no filler sentences
- If the answer is one word or one sentence, keep it that way
`.trim(),
  },
  {
    id:          "curiosity_bias",
    label:       "Curiosity Bias",
    description: "Biases toward exploratory, counter-intuitive, and unexpected angles.",
    icon:        "🔭",
    conflictsWith: ["hedge_reducer"],
    injection: `
MODIFIER — CURIOSITY BIAS (active):
- Actively seek non-obvious angles and unexpected implications
- Ask "what if the conventional wisdom is wrong here?" before answering
- Surface surprising connections to other domains
- Propose at least one counter-intuitive hypothesis per response
- Favor depth and originality over safe, expected answers
- It's okay to speculate — label speculation explicitly as "Hypothesis:"
- End with one open question that would change your answer if resolved differently
`.trim(),
  },
];

/**
 * Apply active STM modules to a system prompt.
 * Returns the original if no modules are active.
 */
export function applySTMModules(
  systemPrompt: string,
  activeModuleIds: STMModuleId[],
): string {
  if (!activeModuleIds.length) return systemPrompt;

  const injections = activeModuleIds
    .map((id) => STM_MODULES.find((m) => m.id === id))
    .filter(Boolean)
    .map((m) => m!.injection);

  if (!injections.length) return systemPrompt;

  return `${systemPrompt.trim()}\n\n${injections.join("\n\n")}`;
}

/**
 * Validate STM combination — returns conflicts if any.
 */
export function validateSTMCombination(activeIds: STMModuleId[]): string[] {
  const errors: string[] = [];
  for (const id of activeIds) {
    const mod = STM_MODULES.find((m) => m.id === id);
    if (!mod) continue;
    for (const conflict of mod.conflictsWith ?? []) {
      if (activeIds.includes(conflict)) {
        const conflictMod = STM_MODULES.find((m) => m.id === conflict);
        errors.push(`"${mod.label}" conflicts with "${conflictMod?.label ?? conflict}"`);
      }
    }
  }
  return [...new Set(errors)];
}
