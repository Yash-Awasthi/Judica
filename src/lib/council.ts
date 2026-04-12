import { ARCHETYPES, SUMMONS, UNIVERSAL_PROMPT } from "../config/archetypes.js";
import { db } from "./drizzle.js";
import { councilConfigs } from "../db/schema/auth.js";
import { eq } from "drizzle-orm";
import { mapProviderError } from "./errorMapper.js";
import { Message, Provider } from "./providers.js";
import logger from "./logger.js";
import { formatAgentOutput, ScoredOpinion } from "./schemas.js";
import { filterAndRank } from "./scoring.js";
import { gatherOpinions, conductPeerReview, evaluateConsensus, synthesizeVerdict, conductDebateRound, OpinionResult } from "./deliberationPhases.js";
import { PeerReview, ValidatorResult } from "./schemas.js";
import { createController } from "./controller.js";
import { calculateCost } from "./cost.js";
import { updateReliability, getReliabilityScores } from "../services/reliability.service.js";

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

  const userArchetypes: Record<string, any> = {};
  if (userId) {
    const [config] = await db.select().from(councilConfigs).where(eq(councilConfigs.userId, userId)).limit(1);
    if (config) {
      const customs = (config.config as any).customArchetypes || [];
      customs.forEach((a: any) => { userArchetypes[a.id] = a; });
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
  onMemberChunk?: (name: string, chunk: string) => void
): AsyncGenerator<DeliberationEvent> {
  const controller = createController();
  const currentMessages = [...messages];
  let finalOpinions: { name: string; opinion: string }[] = [];
  let totalTokens = 0;

  for (let r = 1; r <= rounds; r++) {
    const roundLabel = r === 1 ? "R1 - Initial Responses" :
                       r === 2 ? "R2 - Critique & Ranking" :
                       `R${r} - Refinement Round`;
    
    yield { type: "status", round: r, message: `${roundLabel}: Gathering agent responses...` };

    let { opinions, totalTokens: opinionTokens } = await gatherOpinions({
      members,
      currentMessages,
      round: r,
      abortSignal,
      maxTokens,
      onMemberChunk
    });
    totalTokens += opinionTokens;

    const minRequired = Math.max(2, Math.ceil(members.length * 0.5));
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

      const { refinedOpinions, totalTokens: debateTokens } = await conductDebateRound({
        members,
        opinions,
        abortSignal,
        maxTokens,
        onMemberChunk
      });
      totalTokens += debateTokens;

      opinions = refinedOpinions.map((refined: { name: string; opinion: string }) => {
        const original = opinions.find((o: OpinionResult) => o.name === refined.name);
        return {
          name: refined.name,
          opinion: refined.opinion,
          structured: original?.structured || null
        } as OpinionResult;
      });
      finalOpinions = opinions;

      for (const op of refinedOpinions) {
        yield { type: "opinion", name: op.name + " (Refined)", text: op.opinion, round: 1.5 };
      }
    }

    let reviews: PeerReview[] = [];
    let currentScored: ScoredOpinion[] = [];
    if (opinions.length >= 2) {
      yield { type: "status", round: r, message: `Peer review phase for Round ${r}...` };

      const lastConsensus = r > 1 ? (controller as any)['previousMaxScore'] : 0; 
      const skipAdversarial = lastConsensus > 0.92;
      const skipGrounding = lastConsensus > 0.95;

      const reviewRes = await conductPeerReview({
        members,
        opinions,
        currentMessages,
        round: r,
        validatorProvider: master,
        skipAdversarial,
        skipGrounding,
        abortSignal,
        maxTokens
      });
      reviews = reviewRes.reviews;
      currentScored = reviewRes.scored;
      totalTokens += reviewRes.totalTokens;

      if (r > 1) {
        const accepted = controller.shouldAcceptRound(currentScored);
        if (!accepted) {
          yield { type: "status", round: r, message: "Round discarded: No improvement in quality/consensus. Reverting to previous best." };
        }
      } else {
        controller.shouldAcceptRound(currentScored);
      }

      if (reviews.length > 0) {
        yield { type: "peer_review", round: r, reviews };

        // ── Reliability tracking: update model scores based on peer review ──
        const memberModels = new Map<string, string>();
        for (const m of members as any[]) {
          if (m.name && m.model) memberModels.set(m.name, m.model);
        }
        const conflicts: Array<{ agentA: string; agentB: string }> = [];
        const concessions: string[] = [];
        for (const review of reviews) {
          for (const flaw of review.identified_flaws) {
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

    const roundContext = opinions.map(o => `${o.name}: ${o.opinion}`).join("\n\n");

    if (r < rounds) {
      const {
        criticEval,
        scorerEval,
        consensusScore,
        totalTokens: consensusTokens
      } = await evaluateConsensus({
        master,
        opinions: opinions.map((o: any) => o as OpinionResult),
        currentMessages,
        round: r,
        abortSignal,
        maxTokens
      });
      totalTokens += consensusTokens;

      yield { type: "opinion", name: "Qualitative Critic", text: criticEval, round: r };
      yield { type: "opinion", name: "Quantitative Scorer", text: scorerEval, round: r };

      yield { 
        type: "metrics", 
        metrics: { 
          totalTokens, 
          totalCost: 0, // Simplified cost tracking for now
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
  let reliabilityContext = "";
  try {
    const modelNames = (members as any[]).map((m) => m.model).filter(Boolean);
    const scores = await getReliabilityScores(modelNames);
    if (scores.size > 0) {
      const memberScores = (members as any[]).map((m) => {
        const score = scores.get(m.model);
        return score
          ? `${m.name} (${m.model}): reliability ${(score.avgConfidence * 100).toFixed(1)}% (${score.totalResponses} responses)`
          : null;
      }).filter(Boolean);
      if (memberScores.length > 0) {
        reliabilityContext = `\n\n[MODEL RELIABILITY SCORES - weight responses accordingly]\n${memberScores.join("\n")}\n[/MODEL RELIABILITY SCORES]`;
        // Inject into the last message for synthesis context
        if (currentMessages.length > 0) {
          const lastMsg = currentMessages[currentMessages.length - 1];
          currentMessages[currentMessages.length - 1] = {
            ...lastMsg,
            content: lastMsg.content + reliabilityContext,
          };
        }
      }
    }
  } catch (err) {
    logger.warn({ err }, "Failed to load reliability scores for synthesis");
  }

  const { verdict, validatorResult, totalTokens: verdictTokens } = await synthesizeVerdict({
    master,
    currentMessages,
    abortSignal,
    maxTokens,
    onVerdictChunk
  });
  totalTokens += verdictTokens;

  yield { type: "validator_result", result: validatorResult };
  yield { 
    type: "done", 
    verdict, 
    opinions: finalOpinions, 
    metrics: { 
      totalTokens, 
      totalCost: 0, // Actual cost is calculated by providers layer or service layer
      hallucinationCount: 0 // Aggregate from validator result if needed
    } 
  } as any;
}

export async function askCouncil(
  members: Provider[],
  master: Provider,
  messages: Message[],
  maxTokens: number = 4096,
  rounds: number = 1
) {
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

  return { verdict, opinions, metrics };
}

export async function streamCouncil(
  members: Provider[],
  master: Provider,
  messages: Message[],
  onEvent: (event: string, data: any) => void,
  maxTokens: number = 4096,
  rounds: number = 1,
  abortSignal?: AbortSignal
) {
  let verdict = "";
  const archetypeMap: Record<string, string> = {};
  for (const m of (members as any[])) {
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
