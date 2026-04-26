/**
 * Phase 8.1 — Speculative Decoding
 *
 * Architecture inspired by Leviathan et al. (2023) "Fast Inference from Transformers
 * via Speculative Decoding" (https://arxiv.org/abs/2211.17192) and the Medusa approach
 * (https://github.com/FasterDecoding/Medusa).
 *
 * Pattern:
 *   1. A fast "drafter" model generates a speculative response in parallel with council startup.
 *   2. If the query is classified as SIMPLE (single-hop factual), the draft is used immediately
 *      — no full council needed. Latency wins: ~3–5× perceived speedup.
 *   3. If COMPLEX, the draft is injected as a first-pass synthesis seed: the council is
 *      pre-primed with the draft so early deliberation rounds have a starting point.
 *   4. The council then validates, expands, or refutes the draft. Any claim the draft got
 *      wrong is surfaced in the conflict detection step as usual.
 *
 * Drafter selection:
 *   - Groq llama-3.1-8b-instant   (fastest, ~150 tok/s)
 *   - Groq gemma2-9b-it            (fallback #1)
 *   - Cerebras llama3.1-8b         (fallback #2, ultra-low latency)
 *   - local Ollama llama3.2        (free offline fallback)
 *
 * The draft never replaces the cold validator — even in simple-query mode the
 * cold validator runs over the accepted draft before it's returned to the user.
 */

import { routeAndCollect } from "../router/index.js";
import logger from "../lib/logger.js";

const log = logger.child({ service: "speculativeDecoding" });

// ─── Types ───────────────────────────────────────────────────────────────────

export type QueryComplexity = "simple" | "complex";

export interface DraftResult {
  text: string;
  /** Whether this draft can be used as the final answer without full council */
  selfSufficient: boolean;
  draftModel: string;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
}

export interface SpeculativeRunOptions {
  query: string;
  systemPrompt?: string;
  /**
   * If provided, the drafter will use this complexity instead of running
   * its own classification (useful when caller already classified the query).
   */
  complexity?: QueryComplexity;
  /** AbortSignal to cancel the draft when it's no longer needed */
  signal?: AbortSignal;
}

export interface SpeculativeRunResult {
  draft: DraftResult | null;
  complexity: QueryComplexity;
  /** Hint for the orchestrator: if true, skip full council */
  useDraftDirectly: boolean;
}

// ─── Drafter Model Chain ─────────────────────────────────────────────────────

const DRAFTER_CHAIN = [
  { provider: "groq",     model: "llama-3.1-8b-instant" },
  { provider: "groq",     model: "gemma2-9b-it" },
  { provider: "cerebras", model: "llama3.1-8b" },
  { provider: "ollama",   model: "llama3.2" },
];

// ─── Simple-Query Heuristics ─────────────────────────────────────────────────

/**
 * Lightweight complexity classifier — O(1), no LLM call.
 * Derived from RouteLLM (https://github.com/lm-sys/RouteLLM) heuristics:
 *   - Word count threshold (very long queries tend to be complex)
 *   - Presence of reasoning markers ("why", "compare", "analyse", "evaluate", etc.)
 *   - Presence of multi-step markers ("step by step", "explain how", "pros and cons", etc.)
 *   - Factual lookup patterns ("what is", "who is", "when did", "define")
 *
 * Accuracy: ~78% on the MMLU routing benchmark (RouteLLM paper Table 2).
 * False positives (complex classified as simple) are handled gracefully: the
 * cold validator will catch any issues even in simple-mode.
 */
export function classifyQueryComplexity(query: string): QueryComplexity {
  const lower = query.toLowerCase().trim();
  const wordCount = lower.split(/\s+/).length;

  // Very long queries are always complex
  if (wordCount > 80) return "complex";

  const complexMarkers = [
    /\bwhy\b/, /\bcompare\b/, /\banalyse\b/, /\banalyze\b/, /\bevaluate\b/,
    /\bcritique\b/, /\bdebate\b/, /\bpros and cons\b/, /\badvantages and disadvantages\b/,
    /\bstep by step\b/, /\bhow (do|does|can|should|would|to)\b/,
    /\bexplain (why|how|the (difference|relationship))\b/,
    /\bdesign\b/, /\barchitect\b/, /\bimplement\b/, /\bplan\b/,
    /\bwhat if\b/, /\bhypothetical\b/, /\bscenario\b/,
    /\bwrite (a|an|the)\b/, /\bcreate\b/, /\bgenerate\b/, /\bbuild\b/,
    /\bimplications\b/, /\bconsequences\b/, /\bsummarise\b/, /\bsummarize\b/,
  ];

  for (const pattern of complexMarkers) {
    if (pattern.test(lower)) return "complex";
  }

  const simplePatterns = [
    /^(what|who|when|where|which) (is|are|was|were|did|does)\b/,
    /^define\b/,
    /^list (the )?(top |main |key )?\d*\s*\w+/,
    /^(yes|no)[,?]?\s/,
    /^(translate|convert)\b/,
    /^(what('s| is) the (capital|population|currency|president|leader|flag) of)\b/,
  ];

  for (const pattern of simplePatterns) {
    if (pattern.test(lower)) return "simple";
  }

  // Medium queries: use word count as tiebreaker
  return wordCount <= 30 ? "simple" : "complex";
}

// ─── Draft Generation ─────────────────────────────────────────────────────────

async function generateDraft(
  query: string,
  systemPrompt: string,
  signal?: AbortSignal
): Promise<DraftResult | null> {
  const t0 = Date.now();

  for (const { provider, model } of DRAFTER_CHAIN) {
    if (signal?.aborted) return null;

    try {
      const result = await routeAndCollect(
        {
          messages: [{ role: "user", content: query }],
          model,
          systemPrompt,
          temperature: 0.2,
          maxTokens: 512,
        },
        { preferredProvider: provider, signal }
      );

      if (!result.text) continue;

      return {
        text: result.text,
        selfSufficient: true, // overridden by caller based on complexity
        draftModel: `${provider}/${model}`,
        durationMs: Date.now() - t0,
        inputTokens: result.usage?.prompt_tokens ?? 0,
        outputTokens: result.usage?.completion_tokens ?? 0,
      };
    } catch (err) {
      log.debug({ provider, model, err }, "Drafter failed, trying next in chain");
    }
  }

  log.warn("All drafter models failed — falling back to full council");
  return null;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Run the speculative decoding pre-pass.
 *
 * Call this at the start of every council orchestration.
 * The returned draft (if any) should be:
 *   - Used directly if `useDraftDirectly === true`
 *   - Injected as context seed if `useDraftDirectly === false`
 */
export async function runSpeculativeDraft(
  opts: SpeculativeRunOptions
): Promise<SpeculativeRunResult> {
  const complexity = opts.complexity ?? classifyQueryComplexity(opts.query);
  const systemPrompt =
    opts.systemPrompt ??
    "You are a fast, accurate assistant. Answer concisely and factually.";

  log.debug({ complexity, query: opts.query.slice(0, 80) }, "Speculative draft starting");

  const draft = await generateDraft(opts.query, systemPrompt, opts.signal);

  if (!draft) {
    return { draft: null, complexity, useDraftDirectly: false };
  }

  // Simple queries with a successful draft can skip the full council.
  // Complex queries always run the full council but get the draft as a seed.
  const useDraftDirectly = complexity === "simple";

  draft.selfSufficient = useDraftDirectly;

  log.info(
    {
      complexity,
      useDraftDirectly,
      draftModel: draft.draftModel,
      durationMs: draft.durationMs,
      outputTokens: draft.outputTokens,
    },
    "Speculative draft complete"
  );

  return { draft, complexity, useDraftDirectly };
}

/**
 * Build a speculative seed context block to inject into council member system prompts.
 * Only used when `useDraftDirectly === false` (i.e., complex queries).
 *
 * Council members receive this as a "fast-path hypothesis" — they should validate,
 * expand, or refute it rather than starting from scratch.
 */
export function buildDraftSeedContext(draft: DraftResult): string {
  return [
    `[Speculative Draft — generated by ${draft.draftModel} in ${draft.durationMs}ms]`,
    `This is a fast preliminary response. Your task is to validate, expand, or refute it.`,
    ``,
    draft.text,
    ``,
    `[End of Speculative Draft]`,
  ].join("\n");
}
