import { Message, Provider, askProvider, askProviderStream } from "./providers.js";
import logger from "./logger.js";
import { parseAgentOutput, AgentOutput, PeerReview, PeerReviewFlaw, ValidatorResult, ScoredOpinion } from "./schemas.js";
import { adversarialModule } from "./adversarial.js";
import { groundingModule } from "./grounding.js";
import { computeConsensus } from "./metrics.js";
import { getFallbackProvider } from "../config/fallbacks.js";

let scoreOpinions: typeof import('./scoring.js').scoreOpinions | null = null;
async function lazyScoreOpinions(...args: Parameters<typeof import('./scoring.js').scoreOpinions>) {
  if (!scoreOpinions) {
    const mod = await import("./scoring.js");
    scoreOpinions = mod.scoreOpinions;
  }
  return scoreOpinions!(...args);
}

export interface OpinionResult {
  name: string;
  opinion: string;
  structured: AgentOutput | null;
  isFallback?: boolean;
}

interface GatherOpinionsOptions {
  members: Provider[];
  currentMessages: Message[];
  round: number;
  abortSignal?: AbortSignal;
  maxTokens?: number;
  onMemberChunk?: (name: string, chunk: string) => void;
}

export async function gatherOpinions(
  options: GatherOpinionsOptions
): Promise<{ opinions: OpinionResult[]; totalTokens: number }> {
  const { members, currentMessages, abortSignal, maxTokens, onMemberChunk } = options;
  
  let totalTokens = 0;
  
  const errors: string[] = [];
  const opinionsRaw = await Promise.all(members.map(async (m): Promise<OpinionResult | null> => {
    const start = Date.now();
    logger.debug({ member: m.name, start }, "Agent call started");
    
    const agentTimeout = AbortSignal.timeout(60000); // Increased timeout to 60 seconds
    const combinedSignal = abortSignal
      ? AbortSignal.any([abortSignal, agentTimeout])
      : agentTimeout;

    try {
      const response = await askProviderStream(
        { ...m, ...(maxTokens ? { maxTokens } : {}) },
        currentMessages,
        (chunk) => {
          if (onMemberChunk) onMemberChunk(m.name, chunk);
        },
        false,
        combinedSignal
      );
      
      const duration = Date.now() - start;
      logger.debug({ member: m.name, duration }, "Agent call finished");
      
      if (response.usage) totalTokens += response.usage.totalTokens;

      const parsed = parseAgentOutput(response.text);
      if (parsed) {
        return { name: m.name, opinion: response.text, structured: parsed };
      }

      logger.warn({ member: m.name }, "Agent returned invalid JSON, retrying once...");
      const retryMessages: Message[] = [
        ...currentMessages,
        { role: "user", content: "Your previous response was not valid JSON. Ensure you return ONLY the JSON object." }
      ];
      const retryRes = await askProviderStream(m, retryMessages, () => {}, false, combinedSignal);
      const rp = parseAgentOutput(retryRes.text);
      if (rp) return { name: m.name, opinion: retryRes.text, structured: rp };

      return { 
        name: m.name, 
        opinion: response.text, 
        structured: { answer: response.text, reasoning: "JSON failed", key_points: [], assumptions: [], confidence: 0.5 } 
      };

    } catch (err) {
      const fallback = getFallbackProvider(m);
      if (fallback) {
        logger.warn({ member: m.name, err: (err as Error).message }, "Agent primary failed, trying fallback...");
        try {
          const fbRes = await askProviderStream(fallback, currentMessages, (c) => onMemberChunk?.(m.name, c), false, combinedSignal);
          const parsed = parseAgentOutput(fbRes.text);
          if (parsed) return { name: m.name, opinion: fbRes.text, structured: parsed, isFallback: true };
        } catch (fbErr) {
          logger.error({ member: m.name, err: (fbErr as Error).message }, "Fallback also failed");
          errors.push(`[${m.name}] fallback failed: ${(fbErr as Error).message}`);
        }
      } else {
        errors.push(`[${m.name}] failed: ${(err as Error).message}`);
      }

      const duration = Date.now() - start;
      logger.error({ member: m.name, duration, err: (err as Error).message }, "Agent failed in round after fallback options");
      return null;
    }
  }));

  const opinions = opinionsRaw.filter((o): o is OpinionResult => o !== null);
  
  if (opinions.length === 0) {
    if (errors.length > 0) {
      throw new Error("No council members provided valid responses. Errors: " + errors.join(", "));
    }
    throw new Error("No council members provided valid responses.");
  }
  
  return { opinions, totalTokens };
}

interface ConductPeerReviewOptions {
  members: Provider[];
  opinions: OpinionResult[];
  currentMessages: Message[];
  round: number;
  validatorProvider: Provider;
  skipAdversarial?: boolean;
  skipGrounding?: boolean;
  abortSignal?: AbortSignal;
  maxTokens?: number;
}

export async function conductPeerReview(
  options: ConductPeerReviewOptions
): Promise<{ reviews: PeerReview[]; scored: ScoredOpinion[]; totalTokens: number; cost: number }> {
  const { members, opinions, currentMessages, validatorProvider, skipAdversarial, skipGrounding, abortSignal, maxTokens } = options;
  
  let totalTokens = 0;

  const labels = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const anonymized = opinions.map((o, i) => ({
    label: `Response ${labels[i]}`,
    originalName: o.name,
    text: o.opinion
  }));

  const anonymizedBlock = anonymized.map(a => `${a.label}:\n${a.text}`).join("\n\n");

  const reviewPromises = members.map(async (m) => {
    const start = Date.now();
    logger.debug({ reviewer: m.name, start }, "Peer review started");

    const reviewPrompt = `You are a professional adversarial auditor.
    Analyze the following anonymized responses to the same question.
    
    ${anonymizedBlock}
    
    GOAL: 
    1. Assume each answer is WRONG. Prove it. Actively search for failure modes, logical gaps, and factual errors.
    2. Rank them by robustness against your adversarial audit.
    
    Return STRICT JSON:
{
  "ranking": ["Response A", "Response B", ...],
  "critique": "Comparison of accuracy and reasoning quality.",
  "identified_flaws": [
    {
      "target": "Response X",
      "claim": "direct quote",
      "issue": "why it fails your adversarial audit",
      "correction": "how to fix it",
      "verifiability": "high | medium | low",
      "type": "factual | logical | speculative"
    }
  ]
}
Rule: Be ruthless. If an answer lacks evidence, call it out.

REQUIREMENTS:
- ranking: Array ordering responses from best (first) to worst (last)
- critique: Detailed comparison of all responses
- identified_flaws [REQUIRED]: Array of structured objects
- Include ALL responses in your ranking
- "target" must be the Label (e.g. "Response A")
- "claim" must be a direct quote from the response
- "issue" must explain the specific reasoning failure
- "correction" must be the logically correct alternative

Do not include any text outside the JSON object.`;

    try {
      const res = await askProvider(
        { ...m, ...(maxTokens ? { maxTokens } : {}) },
        [...currentMessages, { role: "user", content: reviewPrompt }],
        false,
        abortSignal
      );
      
      const duration = Date.now() - start;
      logger.debug({ reviewer: m.name, duration }, "Peer review finished");
      
      if (res.usage) totalTokens += res.usage.totalTokens;

      parseAgentOutput(res.text);
      let reviewData: { ranking: string[]; critique: string; identified_flaws: PeerReviewFlaw[] } | null = null;
      try {
        const jsonMatch = res.text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const raw = JSON.parse(jsonMatch[0]);
          if (raw.ranking && raw.critique) {
            reviewData = { 
              ranking: raw.ranking, 
              critique: raw.critique, 
              identified_flaws: Array.isArray(raw.identified_flaws) ? raw.identified_flaws : [] 
            };
          }
        }
      } catch (e) { logger.error({ err: (e as Error).message }, "Failed to parse peer review"); }

      if (reviewData) {
        return { 
          reviewer: m.name, 
          ranking: reviewData.ranking, 
          critique: reviewData.critique,
          identified_flaws: reviewData.identified_flaws
        };
      }
      return { 
        reviewer: m.name, 
        ranking: anonymized.map(a => a.label), 
        critique: res.text,
        identified_flaws: []
      };
    } catch (err) {
      logger.error({ member: m.name, err: (err as Error).message }, "Peer review failed");
      return null;
    }
  });

  const reviews = (await Promise.all(reviewPromises)).filter((r): r is PeerReview => r !== null);

  const validatedOpinions = await Promise.all(opinions.map(async (op) => {
    if (!op.structured) return { ...op, adversarial: undefined, grounding: undefined };
    
    const [adversarial, grounding] = await Promise.all([
      !skipAdversarial 
        ? adversarialModule.challenge(op.structured, validatorProvider, abortSignal) 
        : Promise.resolve(undefined),
      !skipGrounding 
        ? groundingModule.verify(op.structured, opinions.map(o => o.structured!).filter(Boolean), validatorProvider, abortSignal)
        : Promise.resolve(undefined)
    ]);

    if (skipAdversarial) logger.debug({ name: op.name }, "Adaptive Optimization: Skipping adversarial audit");
    if (skipGrounding) logger.debug({ name: op.name }, "Adaptive Optimization: Skipping grounding audit");

    return {
      ...op,
      adversarial,
      grounding
    };
  }));

  const anonymizedLabels = new Map<string, string>();
  anonymized.forEach(a => anonymizedLabels.set(a.originalName, a.label));

  const scored = await lazyScoreOpinions(
    validatedOpinions.map(o => ({ 
      name: o.name, 
      opinion: o.opinion, 
      structured: o.structured!,
      isFallback: o.isFallback,
      adversarial: (o as unknown as { adversarial?: unknown }).adversarial,
      grounding: (o as unknown as { grounding?: unknown }).grounding
    })),
    reviews,
    anonymizedLabels
  );

  return { reviews, scored, totalTokens, cost: 0 }; // Cost will be calculated by the orchestrator
}

interface EvaluateConsensusOptions {
  master: Provider;
  opinions: OpinionResult[];
  currentMessages: Message[];
  round: number;
  abortSignal?: AbortSignal;
  maxTokens?: number;
}

export async function evaluateConsensus(
  options: EvaluateConsensusOptions
): Promise<{
  criticEval: string;
  scorerEval: string;
  consensusScore: number;
  shouldHalt: boolean;
  haltReason?: string;
  totalTokens: number;
}> {
  const { master, opinions, currentMessages, round, abortSignal } = options;
  
  let totalTokens = 0;

  const criticPrompt = `As a qualitative critic, evaluate the Round ${round} opinions for:
1. Logical contradictions and inconsistencies
2. Flawed assumptions or reasoning gaps
3. Missing evidence or weak arguments
4. Areas needing clarification

Provide constructive feedback and specific directives for improvement in the next round. Do NOT decide whether to stop deliberation.`;
  const criticEvalRes = await askProvider(master, [...currentMessages, { role: "user", content: criticPrompt }], false, abortSignal);
  if (criticEvalRes.usage) totalTokens += criticEvalRes.usage.totalTokens;
  const criticEval = criticEvalRes.text;

  const structuredOutputs = opinions.map(o => o.structured!).filter(Boolean);
  const consensusScore = await computeConsensus(structuredOutputs);

  const scorerPrompt = `As a quantitative scorer, analyze the Round ${round} opinions and provide:
1. Numerical assessment of agreement level (0-1)
2. Identification of outlier positions
3. Confidence metrics across all responses
4. Recommendation on whether additional rounds are needed

Current consensus score: ${(consensusScore * 100).toFixed(1)}%

Note: Your recommendation is advisory. The system will halt based on a deterministic threshold.`;
  
  const scorerEvalRes = await askProvider(master, [...currentMessages, { role: "user", content: scorerPrompt }], false, abortSignal);
  if (scorerEvalRes.usage) totalTokens += scorerEvalRes.usage.totalTokens;
  const scorerEval = scorerEvalRes.text;

  const shouldHalt = consensusScore >= 0.85;
  const haltReason = shouldHalt 
    ? `Consensus score ${(consensusScore * 100).toFixed(1)}% >= 85% threshold`
    : undefined;

  return {
    criticEval,
    scorerEval,
    consensusScore,
    shouldHalt,
    haltReason,
    totalTokens
  };
}

interface SynthesizeVerdictOptions {
  master: Provider;
  currentMessages: Message[];
  abortSignal?: AbortSignal;
  maxTokens?: number;
  onVerdictChunk?: (chunk: string) => void;
}

export async function synthesizeVerdict(
  options: SynthesizeVerdictOptions
): Promise<{
  verdict: string;
  validatorResult: ValidatorResult;
  totalTokens: number;
}> {
  const { master, currentMessages, abortSignal, maxTokens, onVerdictChunk } = options;
  
  let verdict = "";
  let totalTokens = 0;

  const masterRes = await askProviderStream(
    { ...master, ...(maxTokens ? { maxTokens } : {}) },
    [
      ...currentMessages,
      { role: "user", content: `SYNTHESIS INSTRUCTION: 
      1. Prioritize opinions with higher verified scores and better adversarial robustness.
      2. PRESERVE top-ranked reasoning. 
      3. CRITICAL: You MUST NOT introduce new factual claims that weren't present in the verified council responses.
      4. Do NOT override validated mathematical or logical results provided in the audits.
      
      Weight evidence strength over simple agreement.` }
    ],
    (chunk) => {
      verdict += chunk;
      if (onVerdictChunk) onVerdictChunk(chunk);
    },
    false,
    abortSignal
  );

  if (masterRes.usage) totalTokens += masterRes.usage.totalTokens;

  let validatorResult: ValidatorResult = {
    valid: false,
    issues: ["CRITICAL: Validator unavailable - answer quality cannot be verified"],
    confidence: 0.0,
    summary: "Validator failed to run - response may contain errors or hallucinations"
  };

  try {
    const validatorPrompt = `You are an independent validator with ZERO prior context.

Strictly evaluate the following answer:

1. Detect factual inaccuracies or hallucinations
2. Identify unsupported claims (no evidence)
3. Check logical consistency
4. Detect overconfidence or misleading tone
5. Identify missing critical considerations

Be critical, not polite.

ANSWER TO VALIDATE:
${verdict}

Return STRICT JSON:
{
  "valid": boolean,
  "issues": string[],
  "confidence": number,
  "summary": string
}`;

    const validatorRes = await askProvider(
      { ...master, name: "Cold Validator", ...(maxTokens ? { maxTokens } : {}) },
      [{ role: "user", content: validatorPrompt }],
      false,
      abortSignal
    );
    if (validatorRes.usage) totalTokens += validatorRes.usage.totalTokens;

    const { validationModule } = await import("./validation.js");
    const deterministicResults = await validationModule.validateText(verdict);
    const deterministicErrors = deterministicResults.flatMap(r => r.errors);

    try {
      const jsonMatch = validatorRes.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (typeof parsed.valid === "boolean") {
          const finalValid = parsed.valid && deterministicErrors.length === 0;
          const finalIssues = [...(parsed.issues || []), ...deterministicErrors];
          const finalConfidence = Math.max(0.1, parsed.confidence - (deterministicErrors.length * 0.15));
          
          validatorResult = {
            valid: finalValid,
            issues: finalIssues,
            confidence: finalConfidence,
            summary: finalValid ? "Synthesis passed logical & truth audits." : `Synthesis failed truth audit: ${finalIssues.join("; ")}`
          };
        }
      }
    } catch (e) { logger.error({ err: (e as Error).message }, "Failed to parse cold validation result"); }
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "Cold validator failed, proceeding without validation");
  }

  return { verdict, validatorResult, totalTokens };
}

interface DebateRoundOptions {
  members: Provider[];
  opinions: { name: string; opinion: string; structured: AgentOutput | null }[];
  abortSignal?: AbortSignal;
  maxTokens?: number;
  onMemberChunk?: (name: string, chunk: string) => void;
}

export async function conductDebateRound(
  options: DebateRoundOptions
): Promise<{ refinedOpinions: { name: string; opinion: string }[]; totalTokens: number }> {
  const { members, opinions, abortSignal, maxTokens, onMemberChunk } = options;

  let totalTokens = 0;

  const buildOthersSummary = (currentAgentName: string): string => {
    const others = opinions.filter(o => o.name !== currentAgentName);
    return others.map(o => {
      const structured = o.structured;
      if (structured) {
        const summary = structured.answer.slice(0, 120);
        return `[${o.name}]: ${summary}${structured.answer.length > 120 ? '...' : ''} (confidence: ${structured.confidence})`;
      }
      return `[${o.name}]: ${o.opinion.slice(0, 120)}... (confidence: unknown)`;
    }).join('\n');
  };

  const DEBATE_INSTRUCTION = `

DEBATE PHASE:
- Identify flaws or gaps in other responses
- Compare with your own reasoning
- Refine your answer based on critique
- Do NOT repeat blindly
- Be concise and critical

ANTI-CONVERGENCE:
- Do NOT converge unnecessarily
- Maintain your perspective unless strong evidence changes it

CONFIDENCE RULES:
- Increase ONLY if reasoning improved or errors corrected
- Decrease if contradictions found or gaps identified
- Keep same if no significant change

Respond with refined JSON matching the original schema.`;

  const refinedPromises = members.map(async (m) => {
    const agentOpinion = opinions.find(o => o.name === m.name);
    if (!agentOpinion) return { name: m.name, opinion: "[FAILED] No original opinion found" };

    const othersSummary = buildOthersSummary(m.name);
    const originalAnswer = agentOpinion.structured
      ? agentOpinion.structured.answer
      : agentOpinion.opinion;

    const debatePrompt = `YOUR ORIGINAL ANSWER:
${originalAnswer}

OTHER AGENTS' RESPONSES:
${othersSummary}
${DEBATE_INSTRUCTION}`;

    try {
      const agentTimeout = AbortSignal.timeout(60000); // Increased timeout to 60 seconds
      const combinedSignal = abortSignal
        ? AbortSignal.any([abortSignal, agentTimeout])
        : agentTimeout;

      const response = await askProviderStream(
        { ...m, ...(maxTokens ? { maxTokens } : {}) },
        [{ role: "user", content: debatePrompt }],
        (chunk) => {
          if (onMemberChunk) onMemberChunk(m.name, chunk);
        },
        false,
        combinedSignal
      );

      if (response.usage) totalTokens += response.usage.totalTokens;

      const parsed = parseAgentOutput(response.text);
      if (parsed) {
        return { name: m.name, opinion: response.text };
      }

      return { name: m.name, opinion: response.text };
    } catch (err) {
      logger.error({ member: m.name, err: (err as Error).message }, "Debate round failed for agent");
      return { name: m.name, opinion: agentOpinion.opinion };
    }
  });

  const refinedOpinions = await Promise.all(refinedPromises);

  return { refinedOpinions, totalTokens };
}
