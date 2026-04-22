/**
 * Advanced Reasoning Modes — Phase 13
 *
 * Pluggable deliberation strategies that wrap the base council loop.
 * Each mode exports a `run()` generator compatible with the SSE streaming pipeline.
 */

import { routeAndCollect } from "../router/index.js";
import logger from "./logger.js";
import type { Provider } from "./providers.js";

// P10-75: Configurable max reasoning output length
const MAX_REASONING_LENGTH = parseInt(process.env.MAX_REASONING_OUTPUT_CHARS || "10000", 10);

// P10-78: Track reasoning mode costs for billing
let _lastReasoningUsage = { promptTokens: 0, completionTokens: 0 };

/** P10-78: Get accumulated usage from last reasoning mode run for billing */
export function getLastReasoningUsage() {
  return { ..._lastReasoningUsage };
}

function _trackUsage(usage: { prompt_tokens: number; completion_tokens: number }) {
  _lastReasoningUsage.promptTokens += usage.prompt_tokens;
  _lastReasoningUsage.completionTokens += usage.completion_tokens;
}

function resetUsageTracking() {
  _lastReasoningUsage = { promptTokens: 0, completionTokens: 0 };
}

// P10-75: Truncate with warning indicator
function safeTruncate(text: string, label: string): string {
  if (text.length <= MAX_REASONING_LENGTH) return text;
  logger.warn({ label, originalLength: text.length, maxLength: MAX_REASONING_LENGTH }, "Reasoning output truncated");
  return text.slice(0, MAX_REASONING_LENGTH) + "\n\n[⚠️ OUTPUT TRUNCATED — original was " + text.length + " chars]";
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type ReasoningMode =
  | "standard"
  | "socratic"
  | "red_blue"
  | "hypothesis"
  | "confidence";

export interface ModeEvent {
  type: "mode_phase" | "mode_data" | "mode_complete";
  phase?: string;
  data?: unknown;
}

// ─── Socratic Dialogue ────────────────────────────────────────────────────────

/**
 * Step 1: Each agent generates clarifying questions.
 * Step 2: Questions are auto-answered by a resolver LLM.
 * Returns augmented context to prepend to the main debate.
 */
export async function runSocraticPrelude(
  question: string,
  members: Provider[],
  abortSignal?: AbortSignal // P10-76: Accept abort signal
): Promise<{ augmentedContext: string; qa: { q: string; a: string }[] }> {
  resetUsageTracking(); // P10-78: Reset usage tracking for this run
  logger.info({ memberCount: members.length }, "Socratic prelude: collecting clarifying questions");

  // Each agent generates up to 2 clarifying questions
  const questionPromises = members.slice(0, 6).map(async (m) => {
    try {
      // P10-76: Check abort before each call
      if (abortSignal?.aborted) return [];

      const res = await routeAndCollect({
        model: m.model || "auto", // P10-72: Respect provider model config
        messages: [
          {
            role: "system",
            content: `${m.systemPrompt}\n\nBefore forming your opinion, identify up to 2 clarifying questions whose answers would most improve your analysis. Return ONLY a JSON array of strings: ["question1", "question2"]`,
          },
          { role: "user", content: `Topic: ${question}` },
        ],
        temperature: 0.3,
      });
      // P10-73: Use JSON.parse with proper error handling instead of fragile string splitting
      const match = res.text.match(/\[[\s\S]*?\]/);
      if (!match) return [];
      try {
        const parsed = JSON.parse(match[0]);
        if (!Array.isArray(parsed)) return [];
        return (parsed as string[]).filter(q => typeof q === 'string' && q.length > 0).slice(0, 2);
      } catch {
        return [];
      }
    } catch {
      return [];
    }
  });

  // P39-09: Cap questions before deduplication to prevent unbounded intermediate array
  const allQuestions = (await Promise.all(questionPromises)).flat().slice(0, 50);
  // Deduplicate similar questions
  const uniqueQ = [...new Set(allQuestions)].slice(0, 8);

  if (uniqueQ.length === 0) {
    return { augmentedContext: "", qa: [] };
  }

  // Auto-resolve questions using a neutral LLM
  const resolveRes = await routeAndCollect({
    model: "auto",
    messages: [
      {
        role: "system",
        content: "You are a neutral knowledge resolver. Answer each question concisely and factually.",
      },
      {
        role: "user",
        content: `Original topic: "${question}"\n\nPlease answer each question:\n${uniqueQ.map((q, i) => `${i + 1}. ${q}`).join("\n")}`,
      },
    ],
    temperature: 0,
  });

  const lines = resolveRes.text.split("\n").filter((l) => l.trim());
  const qa = uniqueQ.map((q, i) => ({ q, a: lines[i] || "No answer available." }));

  const augmentedContext =
    "CLARIFYING Q&A (established before debate):\n" +
    qa.map(({ q, a }) => `Q: ${q}\nA: ${a}`).join("\n\n") +
    "\n\n---\n";

  logger.info({ qCount: qa.length }, "Socratic prelude complete");
  return { augmentedContext, qa };
}

// ─── Red Team / Blue Team ─────────────────────────────────────────────────────

export interface RedBlueResult {
  redArguments: string;
  blueArguments: string;
  judgeVerdict: string;
}

/**
 * Split members into Red (FOR) and Blue (AGAINST) factions.
 * A neutral judge synthesizes the final verdict.
 */
export async function runRedBlueDebate(
  question: string,
  members: Provider[],
  abortSignal?: AbortSignal // P10-76: Accept abort signal
): Promise<RedBlueResult> {
  // P10-74: Reject debate mode for single-archetype councils
  if (members.length < 2) {
    logger.warn("Red/Blue debate requires at least 2 members — falling back to single-agent response");
    const res = await routeAndCollect({
      model: members[0]?.model || "auto",
      messages: [
        { role: "system", content: members[0]?.systemPrompt || "Provide a balanced analysis of both sides." },
        { role: "user", content: question },
      ],
      temperature: 0.5,
    });
    return { redArguments: "", blueArguments: "", judgeVerdict: res.text };
  }

  const mid = Math.floor(members.length / 2);
  const redTeam = members.slice(0, Math.max(1, mid));
  const blueTeam = members.slice(mid);

  logger.info({ red: redTeam.length, blue: blueTeam.length }, "Red/Blue debate starting");

  // P10-76: Check abort signal
  if (abortSignal?.aborted) {
    return { redArguments: "", blueArguments: "", judgeVerdict: "Debate cancelled." };
  }

  const [redRes, blueRes] = await Promise.all([
    routeAndCollect({
      model: redTeam[0]?.model || "auto", // P10-72: Use provider model
      messages: [
        {
          role: "system",
          content:
            `RED TEAM — You collectively argue IN FAVOUR of the following position. ` +
            `Build the strongest possible case. Present 3–5 concrete arguments.\n` +
            `Members: ${redTeam.map((m) => m.name).join(", ")}`,
        },
        { role: "user", content: question },
      ],
      temperature: 0.6,
    }),
    routeAndCollect({
      model: blueTeam[0]?.model || "auto", // P10-72: Use provider model
      messages: [
        {
          role: "system",
          content:
            `BLUE TEAM — You collectively argue AGAINST the following position. ` +
            `Build the strongest possible case. Present 3–5 concrete arguments.\n` +
            `Members: ${blueTeam.map((m) => m.name).join(", ")}`,
        },
        { role: "user", content: question },
      ],
      temperature: 0.6,
    }),
  ]);

  const judgeRes = await routeAndCollect({
    model: "auto",
    messages: [
      {
        role: "system",
        content:
          "You are a neutral judge in a structured debate. Evaluate both sides objectively. " +
          "Declare which side made the stronger case and explain why. " +
          "Then give a balanced synthesis that captures truth from both positions.",
      },
      {
        role: "user",
        content:
          `Debate topic: "${question}"\n\n` +
          `RED TEAM (FOR):\n${redRes.text}\n\n` +
          `BLUE TEAM (AGAINST):\n${blueRes.text}`,
      },
    ],
    temperature: 0.3,
  });

  logger.info("Red/Blue debate complete");

  return {
    redArguments: safeTruncate(redRes.text, "red_team"),
    blueArguments: safeTruncate(blueRes.text, "blue_team"),
    judgeVerdict: safeTruncate(judgeRes.text, "judge_verdict"),
  };
}

// ─── Iterative Hypothesis Refinement ─────────────────────────────────────────

export interface HypothesisRound {
  round: number;
  phase: "propose" | "falsify" | "revise";
  hypotheses: { agent: string; text: string }[];
}

export interface HypothesisResult {
  rounds: HypothesisRound[];
  finalSynthesis: string;
}

/**
 * Three-phase hypothesis refinement:
 * 1. Propose — each agent proposes a hypothesis
 * 2. Falsify — each agent attacks the others' hypotheses
 * 3. Revise — each agent revises their hypothesis given the attacks
 * Final: synthesize refined hypotheses
 */
export async function runHypothesisRefinement(
  question: string,
  members: Provider[], _abortSignal?: AbortSignal
): Promise<HypothesisResult> {
  const agents = members.slice(0, 5); // cap for token budget
  const rounds: HypothesisRound[] = [];

  // Round 1: Propose
  const proposeResults = await Promise.all(
    agents.map(async (m) => {
      const res = await routeAndCollect({
        model: "auto",
        messages: [
          { role: "system", content: `${m.systemPrompt}\n\nPropose a single clear hypothesis that answers the question below. Be specific and falsifiable. 2–3 sentences max.` },
          { role: "user", content: question },
        ],
        temperature: 0.6,
      });
      return { agent: m.name, text: res.text };
    })
  );
  rounds.push({ round: 1, phase: "propose", hypotheses: proposeResults });

  const allHypotheses = proposeResults
    .map((h) => `[${h.agent}]: ${h.text}`)
    .join("\n\n");

  // Round 2: Falsify
  const falsifyResults = await Promise.all(
    agents.map(async (m) => {
      const res = await routeAndCollect({
        model: "auto",
        messages: [
          { role: "system", content: `${m.systemPrompt}\n\nYour role is now adversarial. Identify the weakest point in each hypothesis below and explain why it fails or is incomplete. Be specific.` },
          { role: "user", content: `Question: ${question}\n\nHypotheses:\n${allHypotheses}` },
        ],
        temperature: 0.5,
      });
      return { agent: m.name, text: res.text };
    })
  );
  rounds.push({ round: 2, phase: "falsify", hypotheses: falsifyResults });

  const allCritiques = falsifyResults
    .map((c) => `[${c.agent}]: ${c.text}`)
    .join("\n\n");

  // Round 3: Revise
  const reviseResults = await Promise.all(
    agents.map(async (m) => {
      const original = proposeResults.find((h) => h.agent === m.name)?.text || "";
      const res = await routeAndCollect({
        model: "auto",
        messages: [
          { role: "system", content: `${m.systemPrompt}\n\nRevise your original hypothesis in light of the critiques. Your revised hypothesis should be stronger and address the weaknesses identified.` },
          {
            role: "user",
            content:
              `Original hypothesis: ${original}\n\nCritiques received:\n${allCritiques}\n\nProvide your revised hypothesis.`,
          },
        ],
        temperature: 0.4,
      });
      return { agent: m.name, text: res.text };
    })
  );
  rounds.push({ round: 3, phase: "revise", hypotheses: reviseResults });

  const revisedHypotheses = reviseResults
    .map((h) => `[${h.agent}]: ${h.text}`)
    .join("\n\n");

  // Final synthesis
  const synthRes = await routeAndCollect({
    model: "auto",
    messages: [
      {
        role: "system",
        content:
          "You are a scientific synthesizer. Combine the strongest elements from all revised hypotheses into a single, well-supported answer. Acknowledge remaining uncertainties.",
      },
      {
        role: "user",
        content: `Question: "${question}"\n\nRefined hypotheses:\n${revisedHypotheses}`,
      },
    ],
    temperature: 0.2,
  });

  logger.info({ rounds: rounds.length }, "Hypothesis refinement complete");

  return { rounds, finalSynthesis: safeTruncate(synthRes.text, "hypothesis_synthesis") };
}

// ─── Confidence Calibration ───────────────────────────────────────────────────

export interface CalibratedOpinion {
  agent: string;
  opinion: string;
  confidence: number; // 0–1
  reasoning: string;
}

export interface ConfidenceResult {
  opinions: CalibratedOpinion[];
  weightedSynthesis: string;
}

/**
 * Each agent provides an opinion AND a calibrated confidence score (0–100).
 * The synthesizer weights each contribution by confidence.
 */
export async function runConfidenceCalibration(
  question: string,
  members: Provider[]
): Promise<ConfidenceResult> {
  logger.info({ memberCount: members.length }, "Confidence calibration starting");

  const opinionResults = await Promise.all(
    members.map(async (m) => {
      try {
        const res = await routeAndCollect({
          model: "auto",
          messages: [
            {
              role: "system",
              content:
                `${m.systemPrompt}\n\n` +
                `Answer the question below. Then provide a calibrated confidence score (0–100) for your answer. ` +
                `Be honest: 50 = uncertain, 80 = fairly confident, 95 = near-certain with strong evidence. ` +
                `Return JSON: {"opinion": "...", "confidence": 75, "reasoning": "why this confidence level"}`,
            },
            { role: "user", content: question },
          ],
          temperature: 0.5,
        });
        // P39-03: Use non-greedy match to avoid spanning multiple JSON objects
        const match = res.text.match(/\{[\s\S]*?\}/);
        if (!match) throw new Error("no JSON");
        const parsed = JSON.parse(match[0]) as {
          opinion: string;
          confidence: number;
          reasoning: string;
        };
        // P39-02: NaN-safe confidence normalization
        const confValue = Number(parsed.confidence);
        const safeConfidence = Number.isFinite(confValue) ? confValue : 50;
        return {
          agent: m.name,
          opinion: parsed.opinion || res.text,
          confidence: Math.max(0, Math.min(100, safeConfidence)) / 100,
          reasoning: parsed.reasoning || "",
        };
      } catch {
        return {
          agent: m.name,
          opinion: "Unable to generate calibrated opinion.",
          confidence: 0.5,
          reasoning: "Fallback due to parse error",
        };
      }
    })
  );

  // Build weighted context for synthesis
  const totalWeight = opinionResults.reduce((s, o) => s + o.confidence, 0);
  const weightedContext = opinionResults
    .sort((a, b) => b.confidence - a.confidence)
    .map(
      (o) =>
        `[${o.agent} — confidence: ${(o.confidence * 100).toFixed(0)}%, weight: ${
          totalWeight > 0 ? ((o.confidence / totalWeight) * 100).toFixed(1) : "0"
        }%]\n${o.opinion}`
    )
    .join("\n\n");

  const synthRes = await routeAndCollect({
    model: "auto",
    messages: [
      {
        role: "system",
        content:
          "You are synthesizing opinions weighted by the agents' own declared confidence. " +
          "Give proportionally more weight to high-confidence opinions. " +
          "Clearly indicate where consensus is strong vs. uncertain.",
      },
      {
        role: "user",
        content: `Question: "${question}"\n\nWeighted opinions:\n${weightedContext}`,
      },
    ],
    temperature: 0.2,
  });

  logger.info({ agents: opinionResults.length }, "Confidence calibration complete");

  return { opinions: opinionResults, weightedSynthesis: safeTruncate(synthRes.text, "confidence_synthesis") };
}
