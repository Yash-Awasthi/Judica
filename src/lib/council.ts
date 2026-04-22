// P2-23: Council logic is scattered across 7+ files in lib/ and services/:
// lib/council.ts (this file), lib/deliberationPhases.ts, lib/evaluation.ts,
// lib/grounding.ts, lib/reasoningModes.ts, services/councilService.ts,
// services/contradictionResolution.service.ts
// Future: consolidate into a council/ directory to avoid circular import risk.
import { ARCHETYPES, SUMMONS, UNIVERSAL_PROMPT } from "../config/archetypes.js";
import type { Archetype } from "../config/archetypes.js";
import { db } from "./drizzle.js";
import { councilConfigs } from "../db/schema/auth.js";
import { eq } from "drizzle-orm";
import { decrypt } from "./crypto.js";
import { mapProviderError } from "./errorMapper.js";
import type { Message, Provider } from "./providers.js";
import logger from "./logger.js";
import type { ScoredOpinion } from "./schemas.js";
import { gatherOpinions, conductPeerReview, evaluateConsensus, synthesizeVerdict, conductDebateRound } from "./deliberationPhases.js";
import type { OpinionResult } from "./deliberationPhases.js";
import type { PeerReview, ValidatorResult } from "./schemas.js";
import { createController } from "./controller.js";
import { updateReliability, getReliabilityScores } from "../services/reliability.service.js";
import { createHash } from "crypto";

// P10-128: Per-session prompt deduplication cache to avoid regenerating identical sub-prompts
const promptCache = new Map<string, string>();
const MAX_PROMPT_CACHE = 200;

/** P10-128: Hash-and-cache for repeated sub-prompt evaluations within a deliberation */
export function getCachedPromptResult(key: string): string | undefined {
  return promptCache.get(key);
}
export function setCachedPromptResult(key: string, result: string): void {
  if (promptCache.size >= MAX_PROMPT_CACHE) {
    // Evict oldest entry
    const firstKey = promptCache.keys().next().value;
    if (firstKey) promptCache.delete(firstKey);
  }
  promptCache.set(key, result);
}

// P10-46: Simple in-memory deliberation result cache with configurable TTL
const CACHE_TTL_MS = parseInt(process.env.COUNCIL_CACHE_TTL_MS || "300000", 10); // 5 min default
const MAX_CACHE_ENTRIES = parseInt(process.env.COUNCIL_CACHE_MAX || "50", 10);
const deliberationCache = new Map<string, { result: { verdict: string; opinions: { name: string; opinion: string }[]; metrics: { totalTokens: number; totalCost: number; hallucinationCount: number } }; expiresAt: number }>();

function getCacheKey(messages: Message[], memberNames: string[]): string {
  const content = messages.map(m => m.content).join("|") + "||" + memberNames.sort().join(",");
  return createHash("sha256").update(content).digest("hex").slice(0, 32);
}

export type { PeerReview, ValidatorResult };

export interface CouncilMemberInput {
  name?: string;
  type: "api" | "local" | "rpa";
  apiKey: string;
  model: string;
  baseUrl?: string;
  systemPrompt?: string;
  maxTokens?: number;
  tools?: string[];

  [key: string]: unknown;
}

const TOOL_DECISION_LOGIC = `
Before answering, decide if external data is needed:
- factual verification → use web_search
- recent/current info → use web_search
- source-specific query → use web_search
- reasoning/opinion → answer directly

If using tools:
- generate 1–3 precise queries
- avoid vague queries
- prefer specific keywords

If tool results are empty or weak, proceed with reasoning instead of retrying repeatedly.
`;

const MEMORY_INSTRUCTION = `
Relevant past context may be provided above.

Use it to:
- reference prior discussion explicitly
- build upon previous points (do not repeat)
- challenge it if new reasoning contradicts it
`;

const ANALYST_ARCHETYPES = new Set(["architect", "empiricist", "historian", "strategist"]);

export async function prepareCouncilMembers(members: CouncilMemberInput[], summon?: string, userId?: number) {
  if (!members || members.length === 0) return [];

  if (members.length === 1) {
    return [{
      ...members[0],
      name: members[0].name || "Council Member",
      systemPrompt: UNIVERSAL_PROMPT
    }];
  }

  const summonKey = (summon && SUMMONS[summon]) ? summon : "default";
  const archetypeOrder = SUMMONS[summonKey];

  const userArchetypes: Record<string, Archetype> = Object.create(null);
  if (userId) {
    const [config] = await db.select().from(councilConfigs).where(eq(councilConfigs.userId, userId)).limit(1);
    if (config) {
      // P2-30: Config is stored encrypted — decrypt before use
      let configData: { customArchetypes?: Archetype[] };
      try {
        configData = JSON.parse(decrypt(config.config as string));
      } catch {
        // Fallback: if stored as plaintext (legacy), use directly
        configData = config.config as { customArchetypes?: Archetype[] };
      }
      const customs = configData.customArchetypes || [];
      customs.forEach((a) => {
        // P10-25: Comprehensive prototype pollution guard — block all dangerous property keys
        const BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype', 'toString', 'valueOf', '__defineGetter__', '__defineSetter__']);
        if (typeof a?.id === 'string' && !BLOCKED_KEYS.has(a.id)) {
          userArchetypes[a.id] = a;
        }
      });
    }
  }

  const allArchetypes = { ...ARCHETYPES, ...userArchetypes };

  return members.map((member, index) => {
    const archetypeId = archetypeOrder[index % archetypeOrder.length];
    const archetype = allArchetypes[archetypeId] || ARCHETYPES.architect;

    let tools = archetype.tools || [];
    if (archetypeId === "researcher") tools = ["web_search"];

    const basePrompt = member.systemPrompt || archetype.systemPrompt;
    const toolLogic = tools.length > 0 ? TOOL_DECISION_LOGIC : "";
    const memoryInstruction = ANALYST_ARCHETYPES.has(archetypeId) ? MEMORY_INSTRUCTION : "";
    const diversityPrompt = index > 0
      ? "\n\nIMPORTANT: Provide a distinct perspective. Avoid repeating obvious or generic points."
      : "";
    const jsonInstruction = `\n\nCRITICAL: You MUST respond with a valid JSON object containing these exact fields:
{
  "answer": "Your main response text (10-1000 characters)",
  "reasoning": "Your step-by-step reasoning (10-1500 characters)", 
  "key_points": ["point 1 (5-200 chars)", "point 2 (5-200 chars)"],
  "assumptions": ["assumption 1 (5-200 chars)"],
  "confidence": 0.85
}

REQUIREMENTS:
- answer: Main response, 10-1000 characters
- reasoning: Detailed reasoning, 10-1500 characters  
- key_points: Array of 1-5 key points, each 5-200 characters
- assumptions: Array of 0-5 assumptions, each 5-200 characters
- confidence: Number between 0.1 and 1.0

IMPORTANT: Respond with ONLY the JSON object. No markdown, no explanations, no code blocks, just the raw JSON.`;

    return {
      ...member,
      name: archetype.name,
      archetype: archetypeId,
      systemPrompt: basePrompt + toolLogic + memoryInstruction + diversityPrompt + jsonInstruction,
      tools
    };
  });
}

export type DeliberationEvent =
  | { type: "status"; round: number; message: string }
  | { type: "opinion"; name: string; text: string; round: number }
  | { type: "member_chunk"; name: string; chunk: string }
  | { type: "peer_review"; round: number; reviews: PeerReview[] }
  | { type: "scored"; round: number; scored: ScoredOpinion[] }
  | { type: "validator_result"; result: ValidatorResult }
  | { type: "metrics"; metrics: { totalTokens: number; totalCost: number; hallucinationCount: number; consensusScore: number } }
  | { type: "done"; verdict: string; opinions: { name: string; opinion: string }[]; metrics?: { totalTokens: number; totalCost: number; hallucinationCount: number } };

export async function* deliberate(
  members: Provider[],
  master: Provider,
  messages: Message[],
  rounds: number = 1,
  abortSignal?: AbortSignal,
  maxTokens: number = 4096,
  onVerdictChunk?: (chunk: string) => void,
  onMemberChunk?: (name: string, chunk: string) => void,
  // P10-130: Optional seed for deterministic reproducibility
  seed?: number
): AsyncGenerator<DeliberationEvent> {
  // P10-130: Log seed for reproducibility tracking
  const effectiveSeed = seed ?? Math.floor(Math.random() * 2147483647);
  logger.info({ seed: effectiveSeed, members: members.length, rounds }, "Deliberation starting");

  const controller = createController();
  // P10-129: Deep copy messages to prevent cross-phase mutation via shared references
  const currentMessages = messages.map(m => ({ ...m }));
  let finalOpinions: { name: string; opinion: string }[] = [];
  let bestOpinions: { name: string; opinion: string }[] = []; // P10-29: Track best scoring round
  let bestRoundScore = -1; // P10-29: Track best round's max score
  let lastConsensusScore = 0; // P10-32: Track actual consensus score for skip logic
  let totalTokens = 0;
  let totalCost = 0; // P10-26: Aggregate real cost from provider responses
  // P10-127: Per-query cost limit enforcement
  // P34-01: NaN-safe parseFloat — NaN bypasses cost limit comparison
  const _parsedCost = parseFloat(process.env.MAX_DELIBERATION_COST || "0");
  const MAX_DELIBERATION_COST = Number.isFinite(_parsedCost) && _parsedCost > 0 ? _parsedCost : Infinity;

  for (let r = 1; r <= rounds; r++) {
    // P10-34: Check for cancellation between rounds
    if (abortSignal?.aborted) {
      yield { type: "status", round: r, message: "Deliberation cancelled by caller." };
      break;
    }

    // P10-127: Enforce per-query cost limit
    if (totalCost >= MAX_DELIBERATION_COST) {
      logger.warn({ totalCost, limit: MAX_DELIBERATION_COST }, "Deliberation cost limit reached — terminating early");
      yield { type: "status", round: r, message: `Cost limit reached ($${totalCost.toFixed(4)} >= $${MAX_DELIBERATION_COST}). Ending deliberation.` };
      break;
    }

    const roundLabel = r === 1 ? "R1 - Initial Responses" :
                       r === 2 ? "R2 - Critique & Ranking" :
                       `R${r} - Refinement Round`;
    
    yield { type: "status", round: r, message: `${roundLabel}: Gathering agent responses...` };

    const { opinions: _gatherOpinions, totalTokens: opinionTokens, cost: opinionCost } = await gatherOpinions({
      members,
      currentMessages,
      round: r,
      abortSignal,
      maxTokens,
      onMemberChunk
    });
    let opinions = _gatherOpinions;
    totalTokens += opinionTokens;
    totalCost += opinionCost; // P10-26: accumulate real cost

    // P10-28: Single-member fast path — skip quorum check for single-member councils
    const minRequired = members.length === 1 ? 1 : Math.max(2, Math.ceil(members.length * 0.5));
    if (opinions.length < minRequired) {
      yield { type: "status", round: r, message: `Quorum not met (${opinions.length}/${members.length} responses). Aborting.` };
      break;
    }
    
    yield { type: "status", round: r, message: `Quorum met: ${opinions.length} responses received.` };

    for (const op of opinions) {
      yield { type: "opinion", name: op.name, text: op.opinion, round: r };
    }

    if (r === 1 && rounds >= 2 && opinions.length >= 2) {
      yield { type: "status", round: r, message: "Debate round: Agents refining answers..." };

      const { refinedOpinions, totalTokens: debateTokens, cost: debateCost } = await conductDebateRound({
        members,
        opinions,
        abortSignal,
        maxTokens,
        onMemberChunk
      });
      totalTokens += debateTokens;
      totalCost += debateCost; // P10-26: accumulate debate cost

      opinions = refinedOpinions.map((refined: { name: string; opinion: string }) => {
        const original = opinions.find((o: OpinionResult) => o.name === refined.name);
        return {
          name: refined.name,
          opinion: refined.opinion,
          structured: original?.structured || null
        } as OpinionResult;
      });

      for (const op of refinedOpinions) {
        yield { type: "opinion", name: op.name + " (Refined)", text: op.opinion, round: r }; // P10-30: Use integer round index
      }
    }

    let reviews: PeerReview[] = [];
    let currentScored: ScoredOpinion[] = [];
    if (opinions.length >= 2) {
      yield { type: "status", round: r, message: `Peer review phase for Round ${r}...` };

      // P10-31: Use public API instead of accessing private state
      // P10-32: Use actual consensus score (not raw peak score) for skip decisions
      const skipAdversarial = lastConsensusScore > 0.92;
      const skipGrounding = lastConsensusScore > 0.95;

      const reviewRes = await conductPeerReview({
        members,
        opinions,
        currentMessages,
        round: r,
        // P10-125: Use a different provider for validation to prevent systematic model bias.
        // If members have multiple distinct models, pick one that differs from the generation model.
        validatorProvider: members.find(m => m.model !== master.model) || master,
        skipAdversarial,
        skipGrounding,
        abortSignal,
        maxTokens
      });
      reviews = reviewRes.reviews;
      currentScored = reviewRes.scored;
      totalTokens += reviewRes.totalTokens;
      totalCost += reviewRes.cost; // P10-26: accumulate peer review cost

      if (r > 1) {
        const accepted = controller.shouldAcceptRound(currentScored);
        if (!accepted) {
          yield { type: "status", round: r, message: "Round discarded: No improvement in quality/consensus. Reverting to previous best." };
        } else {
          // P10-29: Update best opinions when round is accepted
          // P34-02: NaN-safe Math.max — filter NaN scores before comparison
          const finalScores = currentScored.map(s => s.scores.final).filter(Number.isFinite);
          const roundMaxScore = finalScores.length > 0 ? Math.max(...finalScores) : 0;
          if (roundMaxScore > bestRoundScore) {
            bestRoundScore = roundMaxScore;
            bestOpinions = [...opinions];
          }
        }
      } else {
        controller.shouldAcceptRound(currentScored);
        // P10-29: First round is always the initial best
        const roundMaxScore = Math.max(...currentScored.map(s => s.scores.final), 0);
        bestRoundScore = roundMaxScore;
        bestOpinions = [...opinions];
      }

      if (reviews.length > 0) {
        yield { type: "peer_review", round: r, reviews };

        // ── Reliability tracking: update model scores based on peer review ──
        const memberModels = new Map<string, string>();
        for (const m of members) {
          if (m.name && m.model) memberModels.set(m.name, m.model);
        }
        const conflicts: Array<{ agentA: string; agentB: string }> = [];
        const concessions: string[] = [];
        // P34-03: Cap conflicts/concessions arrays to prevent unbounded growth
        const MAX_CONFLICTS = 500;
        for (const review of reviews) {
          for (const flaw of review.identified_flaws) {
            if (conflicts.length >= MAX_CONFLICTS) break;
            conflicts.push({ agentA: review.reviewer, agentB: flaw.target });
          }
          if (review.identified_flaws.length === 0) {
            concessions.push(review.reviewer);
          }
        }
        updateReliability(conflicts, concessions, memberModels).catch((err) =>
          logger.warn({ err }, "Failed to update reliability scores")
        );
      }
      yield { type: "scored", round: r, scored: currentScored };
    }

    finalOpinions = opinions;
    // P10-29: If no peer review happened (single member), still track as best
    if (bestOpinions.length === 0) {
      bestOpinions = [...opinions];
    }

    if (r < rounds) {
      const {
        criticEval,
        scorerEval,
        consensusScore,
        totalTokens: consensusTokens,
        cost: consensusCost
      } = await evaluateConsensus({
        master,
        opinions,
        currentMessages,
        round: r,
        abortSignal,
        maxTokens
      });
      totalTokens += consensusTokens;
      totalCost += consensusCost; // P10-26: accumulate consensus cost
      lastConsensusScore = consensusScore; // P10-32: Track for next round's skip logic

      yield { type: "opinion", name: "Qualitative Critic", text: criticEval, round: r };
      yield { type: "opinion", name: "Quantitative Scorer", text: scorerEval, round: r };

      yield {
        type: "metrics",
        metrics: {
          totalTokens,
          totalCost, // P10-26: Real cost from provider responses
          hallucinationCount: currentScored.reduce((sum, s) => sum + (s.grounding?.unsupported_claims.length || 0), 0),
          consensusScore
        }
      };

      const decision = controller.decide(r, rounds, consensusScore);
      if (decision.shouldHalt) {
        yield { type: "status", round: r, message: `Controller: ${decision.reason} Halting.` };
        break;
      }

      const peerFlaws = reviews.map(rev => {
        const flaws = rev.identified_flaws.map(f => 
          `- [${f.target}]: "${f.claim}" is incorrect because ${f.issue}. Correction: ${f.correction}`
        ).join("\n");
        return `[Reviewer ${rev.reviewer}'s audit]:\n${flaws || "No specific flaws identified."}`;
      }).join("\n\n");

      const refinementFeedback = `ROUND ${r} CRITICAL FEEDBACK:\n\n${criticEval}\n\nMATHEMATICAL AUDIT FINDINGS:\n${peerFlaws || "No significant flaws identified."}`;
      
      currentMessages.push({ role: "user", content: refinementFeedback });
      yield { type: "status", round: r, message: `Controller: Consensus score ${(consensusScore * 100).toFixed(1)}%. Triggering refinement...` };
    }
  }

  yield { type: "status", round: rounds, message: "Master synthesis started" };

  // ── Reliability-weighted synthesis: inject model reliability scores ──
  try {
    const modelNames = members.map((m) => m.model).filter(Boolean);
    const scores = await getReliabilityScores(modelNames);
    if (scores.size > 0) {
      const memberScores = members.map((m) => {
        const score = scores.get(m.model);
        return score
          ? `${m.name} (${m.model}): reliability ${(score.avgConfidence * 100).toFixed(1)}% (${score.totalResponses} responses)`
          : null;
      }).filter(Boolean);
      if (memberScores.length > 0) {
        const reliabilityContext = `\n\n[MODEL RELIABILITY SCORES - weight responses accordingly]\n${memberScores.join("\n")}\n[/MODEL RELIABILITY SCORES]`;
        // P10-33: Clone message before mutation to avoid polluting shared reference
        if (currentMessages.length > 0) {
          const lastMsg = { ...currentMessages[currentMessages.length - 1] };
          lastMsg.content = lastMsg.content + reliabilityContext;
          currentMessages[currentMessages.length - 1] = lastMsg;
        }
      }
    }
  } catch (err) {
    logger.warn({ err }, "Failed to load reliability scores for synthesis");
  }

  const { verdict, validatorResult, totalTokens: verdictTokens, cost: verdictCost } = await synthesizeVerdict({
    master,
    currentMessages,
    abortSignal,
    maxTokens,
    onVerdictChunk
  });
  totalTokens += verdictTokens;
  totalCost += verdictCost; // P10-26: accumulate verdict cost

  // P10-27: Aggregate hallucinationCount from validator result
  const hallucinationCount = validatorResult.issues
    ? validatorResult.issues.filter(i => i.toLowerCase().includes('hallucin') || i.toLowerCase().includes('unsupported')).length
    : 0;

  yield { type: "validator_result", result: validatorResult };
  yield {
    type: "done",
    verdict,
    opinions: bestOpinions.length > 0 ? bestOpinions : finalOpinions, // P10-29: Use best-scoring round
    metrics: {
      totalTokens,
      totalCost, // P10-26: Real aggregated cost
      hallucinationCount // P10-27: Real hallucination count from validator
    }
  } as DeliberationEvent;
}

export async function askCouncil(
  members: Provider[],
  master: Provider,
  messages: Message[],
  maxTokens: number = 4096,
  rounds: number = 1
) {
  // P10-46: Check cache for identical deliberation
  const cacheKey = getCacheKey(messages, members.map(m => m.name));
  const cached = deliberationCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    logger.debug({ cacheKey }, "Council cache hit — returning cached result");
    return cached.result;
  }

  let verdict = "";
  let opinions: { name: string; opinion: string }[] = [];
  let metrics = { totalTokens: 0, totalCost: 0, hallucinationCount: 0 };

  for await (const event of deliberate(members, master, messages, rounds, undefined, maxTokens)) {
    if (event.type === "done") {
      verdict = event.verdict;
      opinions = event.opinions;
      if (event.metrics) {
        metrics = event.metrics;
      }
    }
  }

  const result = { verdict, opinions, metrics };

  // P10-46: Store in cache (evict oldest if full)
  if (deliberationCache.size >= MAX_CACHE_ENTRIES) {
    const firstKey = deliberationCache.keys().next().value;
    if (firstKey) deliberationCache.delete(firstKey);
  }
  deliberationCache.set(cacheKey, { result, expiresAt: Date.now() + CACHE_TTL_MS });

  return result;
}

export async function streamCouncil(
  members: Provider[],
  master: Provider,
  messages: Message[],
  onEvent: (event: string, data: Record<string, unknown>) => void,
  maxTokens: number = 4096,
  rounds: number = 1,
  abortSignal?: AbortSignal
) {
  let verdict = "";
  const archetypeMap: Record<string, string> = {};
  for (const m of (members as (Provider & { archetype?: string })[]) ) {
    if (m.name && m.archetype) archetypeMap[m.name] = m.archetype;
  }

  try {
    for await (const event of deliberate(
      members, master, messages, rounds, abortSignal, maxTokens,
      (chunk) => { onEvent("verdict_chunk", { chunk }); },
      (name, chunk) => { onEvent("member_chunk", { name, chunk }); }
    )) {
      if (event.type === "status") {
        onEvent("status", { message: event.message });
      } else if (event.type === "opinion") {
        const archetype = archetypeMap[event.name] || "";
        onEvent("opinion", { name: event.name, archetype, opinion: event.text });
      } else if (event.type === "peer_review") {
        onEvent("peer_review", { round: event.round, reviews: event.reviews });
      } else if (event.type === "scored") {
        onEvent("scored", { round: event.round, scored: event.scored });
      } else if (event.type === "validator_result") {
        onEvent("validator_result", { result: event.result });
      } else if (event.type === "done") {
        verdict = event.verdict;
        onEvent("done", event);
      }
    }
  } catch (err) {
    logger.error({ err }, "Stream failed");
    onEvent("error", { message: mapProviderError(err) });
  }

  return verdict;
}
