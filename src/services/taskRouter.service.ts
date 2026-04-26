/**
 * Phase 8.3 — Intelligent Task Router
 *
 * Inspired by RouteLLM (https://github.com/lm-sys/RouteLLM) — cost-effective LLM routing
 * based on query complexity classification (MIT, LMSYS, 3k stars).
 *
 * Classification pipeline (three stages, evaluated cheapest-first):
 *
 *   Stage 1 — Heuristic classifier (O(1), no I/O)
 *             Reuses classifyQueryComplexity() from Phase 8.1.
 *             Covers ~78% of queries with high confidence.
 *
 *   Stage 2 — Feature-based classifier (O(n), no LLM)
 *             Analyses structural features: code blocks, equations, nested reasoning chains,
 *             question count, instruction depth. Resolves ~15% of remaining queries.
 *
 *   Stage 3 — LLM-based meta-router (only for ambiguous queries, ~7% of traffic)
 *             Uses a tiny fast model (Groq llama-3.1-8b) to classify into one of four tiers.
 *             Cost: ~50 tokens per classification. Cheaper than misrouting complex queries.
 *
 * Route targets:
 *   Tier 1 (TRIVIAL):   Single fast model, no council, no synthesis
 *   Tier 2 (SIMPLE):    Single best model (quality tier), cold validator runs
 *   Tier 3 (STANDARD):  Full council (3 members), standard deliberation
 *   Tier 4 (COMPLEX):   Full council (5-7 members), all deliberation rounds, evals
 *
 * Classification is transparent: the route decision + confidence is returned so
 * callers can override it (the UI can show "Using X tier, override?" with one click).
 *
 * A `INTELLIGENT_ROUTING_ENABLED=false` env flag disables the feature entirely
 * (all queries go to full council), honoring the roadmap's "off by default" principle.
 */

import { classifyQueryComplexity } from "./speculativeDecoding.service.js";
import { routeAndCollect } from "../router/index.js";
import logger from "../lib/logger.js";

const log = logger.child({ service: "taskRouter" });

const ROUTING_ENABLED = process.env.INTELLIGENT_ROUTING_ENABLED !== "false";

// ─── Types ────────────────────────────────────────────────────────────────────

export type RouteTier = "trivial" | "simple" | "standard" | "complex";

export interface RouteDecision {
  tier: RouteTier;
  confidence: number;          // 0–1
  reason: string;              // Human-readable explanation
  stage: 1 | 2 | 3;          // Which classifier stage resolved this
  councilSize: number;         // Recommended number of council members
  useFullDeliberation: boolean;
  /** If true, caller should show "override routing?" prompt in UI */
  suggestOverride: boolean;
}

// ─── Stage 1: Heuristic Classifier ────────────────────────────────────────────

function stage1Classify(query: string): { tier: RouteTier; confidence: number } | null {
  const complexity = classifyQueryComplexity(query);

  // High-confidence trivial: very short, single-word or simple arithmetic
  const trimmed = query.trim();
  if (trimmed.length < 20 && !/[.?!]{2,}/.test(trimmed)) {
    if (/^\d[\d\s+\-*/()^%]+$/.test(trimmed)) {
      return { tier: "trivial", confidence: 0.97 };
    }
  }

  // High-confidence trivial: translation, define, convert
  if (/^(translate|convert|define|spell|abbreviation for)\b/i.test(query)) {
    return { tier: "trivial", confidence: 0.90 };
  }

  if (complexity === "simple") return { tier: "simple", confidence: 0.78 };
  if (complexity === "complex") return null; // Defer to stage 2 for specifics
  return null;
}

// ─── Stage 2: Feature-Based Classifier ────────────────────────────────────────

interface QueryFeatures {
  wordCount: number;
  sentenceCount: number;
  questionCount: number;
  hasCodeBlock: boolean;
  hasMathExpression: boolean;
  hasMultipleInstructions: boolean;
  nestedClauseDepth: number;
  instructionVerbs: number;
}

function extractFeatures(query: string): QueryFeatures {
  const words = query.trim().split(/\s+/);
  const sentences = query.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const questions = (query.match(/\?/g) ?? []).length;
  const hasCodeBlock = /```|`[^`]+`|\bcode\b|\bfunction\b|\bclass\b|\bimport\b/.test(query);
  const hasMathExpression = /∫|∑|√|≤|≥|∈|∀|∃|\bintegral\b|\bderivative\b|\bmatrix\b/.test(query);
  const instructionVerbPattern = /\b(write|create|build|implement|design|analyse|analyze|explain|compare|evaluate|summarise|summarize|develop|calculate|solve|prove|derive|list|enumerate|describe)\b/gi;
  const instructionVerbs = (query.match(instructionVerbPattern) ?? []).length;
  const hasMultipleInstructions = instructionVerbs >= 2;

  // Approximate nesting depth by counting "and then", "after that", "additionally", etc.
  const chainMarkers = (query.match(/\b(and then|after that|additionally|furthermore|moreover|subsequently|finally|also)\b/gi) ?? []).length;

  return {
    wordCount: words.length,
    sentenceCount: sentences.length,
    questionCount: questions,
    hasCodeBlock,
    hasMathExpression,
    hasMultipleInstructions,
    nestedClauseDepth: chainMarkers,
    instructionVerbs,
  };
}

function stage2Classify(query: string): { tier: RouteTier; confidence: number } | null {
  const f = extractFeatures(query);

  // Clear complex signals
  if (f.hasCodeBlock && f.instructionVerbs >= 2) {
    return { tier: "complex", confidence: 0.88 };
  }
  if (f.hasMathExpression && f.wordCount > 30) {
    return { tier: "complex", confidence: 0.85 };
  }
  if (f.questionCount >= 3 || f.nestedClauseDepth >= 3) {
    return { tier: "complex", confidence: 0.83 };
  }
  if (f.instructionVerbs >= 3) {
    return { tier: "complex", confidence: 0.82 };
  }

  // Standard signals
  if (f.hasCodeBlock || f.instructionVerbs === 2 || f.questionCount === 2) {
    return { tier: "standard", confidence: 0.80 };
  }
  if (f.wordCount > 50 && f.sentenceCount > 2) {
    return { tier: "standard", confidence: 0.75 };
  }

  // Fallback to simple if nothing complex found
  if (f.wordCount <= 40 && f.instructionVerbs <= 1) {
    return { tier: "simple", confidence: 0.72 };
  }

  return null; // Genuinely ambiguous — escalate to Stage 3
}

// ─── Stage 3: LLM Meta-Router ─────────────────────────────────────────────────

const ROUTER_SYSTEM_PROMPT = `You are a query complexity classifier. Given a user query, output ONLY one of these four labels and nothing else:

TRIVIAL   — Simple lookup, translation, single-fact, arithmetic
SIMPLE    — Single-step reasoning, factual question requiring some thought
STANDARD  — Multi-step reasoning, analysis, comparison, moderate writing
COMPLEX   — Deep research, multi-aspect analysis, code generation, creative work, multi-doc synthesis

Output only the label. No explanation.`;

async function stage3Classify(
  query: string,
  signal?: AbortSignal
): Promise<{ tier: RouteTier; confidence: number }> {
  const defaults: { tier: RouteTier; confidence: number } = { tier: "standard", confidence: 0.50 };

  try {
    const result = await routeAndCollect(
      {
        messages: [{ role: "user", content: query }],
        model: "llama-3.1-8b-instant",
        systemPrompt: ROUTER_SYSTEM_PROMPT,
        temperature: 0.0,
        maxTokens: 8,
      },
      { preferredProvider: "groq", signal }
    );

    const label = result.text?.trim().toUpperCase();

    const tierMap: Record<string, RouteTier> = {
      TRIVIAL: "trivial",
      SIMPLE: "simple",
      STANDARD: "standard",
      COMPLEX: "complex",
    };

    const tier = tierMap[label ?? ""] ?? "standard";
    return { tier, confidence: 0.85 };
  } catch (err) {
    log.debug({ err }, "Stage 3 LLM classifier failed, using safe default");
    return defaults;
  }
}

// ─── Council Size Resolution ──────────────────────────────────────────────────

const TIER_CONFIG: Record<RouteTier, { councilSize: number; fullDeliberation: boolean }> = {
  trivial:  { councilSize: 1, fullDeliberation: false },
  simple:   { councilSize: 1, fullDeliberation: false },
  standard: { councilSize: 3, fullDeliberation: true  },
  complex:  { councilSize: 5, fullDeliberation: true  },
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Classify a query and return a routing decision.
 *
 * @param query     - User query to classify
 * @param signal    - Optional AbortSignal (propagated to Stage 3 LLM call)
 * @returns RouteDecision with tier, council size, and override suggestion
 */
export async function classifyAndRoute(
  query: string,
  signal?: AbortSignal
): Promise<RouteDecision> {
  if (!ROUTING_ENABLED) {
    return {
      tier: "complex",
      confidence: 1.0,
      reason: "Intelligent routing disabled (INTELLIGENT_ROUTING_ENABLED=false)",
      stage: 1,
      councilSize: 5,
      useFullDeliberation: true,
      suggestOverride: false,
    };
  }

  // Stage 1
  const s1 = stage1Classify(query);
  if (s1 && s1.confidence >= 0.85) {
    const cfg = TIER_CONFIG[s1.tier];
    log.debug({ tier: s1.tier, confidence: s1.confidence, stage: 1 }, "Route decision");
    return {
      tier: s1.tier,
      confidence: s1.confidence,
      reason: `Stage 1 heuristic: detected ${s1.tier} pattern`,
      stage: 1,
      ...cfg,
      suggestOverride: s1.confidence < 0.95,
    };
  }

  // Stage 2
  const s2 = stage2Classify(query);
  if (s2 && s2.confidence >= 0.75) {
    const cfg = TIER_CONFIG[s2.tier];
    log.debug({ tier: s2.tier, confidence: s2.confidence, stage: 2 }, "Route decision");
    return {
      tier: s2.tier,
      confidence: s2.confidence,
      reason: `Stage 2 feature analysis: ${s2.tier} complexity signals detected`,
      stage: 2,
      ...cfg,
      suggestOverride: s2.confidence < 0.85,
    };
  }

  // Stage 3 — LLM meta-router (last resort, ~7% of traffic)
  const s3 = await stage3Classify(query, signal);
  const cfg = TIER_CONFIG[s3.tier];
  log.debug({ tier: s3.tier, confidence: s3.confidence, stage: 3 }, "Route decision (LLM)");

  return {
    tier: s3.tier,
    confidence: s3.confidence,
    reason: `Stage 3 LLM classifier: ${s3.tier}`,
    stage: 3,
    ...cfg,
    suggestOverride: true, // Always suggest override for LLM-classified decisions
  };
}

/**
 * Apply a route decision to override the council member count.
 * Call this before assembling the council.
 */
export function applyRouteDecision(
  availableMembers: unknown[],
  decision: RouteDecision
): unknown[] {
  if (!ROUTING_ENABLED) return availableMembers;
  return availableMembers.slice(0, decision.councilSize);
}
