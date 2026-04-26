/**
 * Quality & Honesty — Phase 7.8: Hallucination Scoring
 *
 * Inspired by:
 * - Vectara HHEM (huggingface.co/vectara/hallucination_evaluation_model, Apache 2.0)
 *   — hallucination evaluation model, fine-tuned cross-encoder.
 * - TruLens (truera/trulens, MIT, 2.5k stars) — groundedness and hallucination
 *   scoring for RAG pipelines.
 * - RAGAS (explodinggradients/ragas, Apache 2.0, 8k stars) — RAG evaluation
 *   framework with faithfulness scoring.
 *
 * Every council response gets a hallucination risk score based on:
 * - Source availability (does the claim have grounding?)
 * - Model confidence (was it stated with appropriate uncertainty?)
 * - Cross-agent agreement (do multiple agents agree?)
 * - Claim verifiability (can it be checked?)
 * - Factual specificity (specific claims are riskier than general ones)
 *
 * High-risk responses are flagged before delivery.
 */

import type { FastifyInstance } from "fastify";
import { askProvider } from "../lib/providers.js";
import { env } from "../config/env.js";
import { z } from "zod";

// ─── LLM helper ──────────────────────────────────────────────────────────────

const llmProvider = () => ({
  name: "openai" as const,
  type: "api" as const,
  apiKey: env.OPENAI_API_KEY ?? env.ANTHROPIC_API_KEY ?? "",
  model: env.OPENAI_API_KEY ? "gpt-4o-mini" : "claude-3-haiku-20240307",
});

// ─── Schema ───────────────────────────────────────────────────────────────────

const scoreSchema = z.object({
  query:    z.string().min(1).max(2000),
  response: z.string().min(1).max(8000),
  /** Supporting documents/context the response should be grounded in */
  context:  z.array(z.string().max(2000)).max(10).optional(),
  /** Other agent responses for cross-agent agreement check */
  agentResponses: z.array(z.object({
    agent:    z.string().max(100),
    response: z.string().max(2000),
  })).max(8).optional(),
});

const batchScoreSchema = z.object({
  query: z.string().min(1).max(2000),
  responses: z.array(z.object({
    agent:    z.string().max(100),
    response: z.string().max(4000),
  })).min(1).max(10),
  context: z.array(z.string().max(2000)).max(10).optional(),
});

// ─── Hallucination scoring logic ──────────────────────────────────────────────

async function scoreHallucination(
  query: string,
  response: string,
  context: string[],
  agentResponses: Array<{ agent: string; response: string }>,
): Promise<{
  score: number;
  risk: "low" | "medium" | "high" | "critical";
  dimensions: Record<string, number>;
  flaggedClaims: string[];
  recommendation: string;
}> {
  const contextSection = context.length > 0
    ? `\n\nGROUNDING CONTEXT:\n${context.map((c, i) => `[${i + 1}] ${c.slice(0, 400)}`).join("\n\n")}`
    : "\n\n(No grounding context provided)";

  const agentSection = agentResponses.length > 0
    ? `\n\nOTHER AGENT RESPONSES:\n${agentResponses.map(a => `${a.agent}: ${a.response.slice(0, 300)}`).join("\n")}`
    : "";

  const prompt = `You are a hallucination risk evaluator. Score this AI response.

QUERY: ${query}
${contextSection}
${agentSection}

AI RESPONSE TO EVALUATE:
${response.slice(0, 4000)}

Score hallucination risk on these dimensions (0-100, where 100 = highest hallucination risk):
1. sourceAvailability: Are claims grounded in provided context? (low score = well grounded)
2. specificityRisk: How many specific facts/numbers/names that could be wrong?
3. confidenceCalibration: Is uncertainty properly expressed?
4. crossAgentAgreement: Do other agents (if provided) agree with this response?
5. verifiability: Can major claims be independently verified?

Return JSON:
{
  "overallRisk": 0-100,
  "dimensions": {
    "sourceAvailability": 0-100,
    "specificityRisk": 0-100,
    "confidenceCalibration": 0-100,
    "crossAgentAgreement": 0-100,
    "verifiability": 0-100
  },
  "flaggedClaims": ["specific claims most at risk of being hallucinated"],
  "recommendation": "what to do about high-risk claims"
}`;

  const llmResponse = await askProvider(
    { ...llmProvider(), systemPrompt: "You are a precise hallucination risk evaluator. Be calibrated — don't flag everything." },
    [{ role: "user", content: prompt }],
  );
  const text = typeof llmResponse === "string" ? llmResponse : (llmResponse as any)?.content ?? "";

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const overallRisk = parsed.overallRisk ?? 50;
      const risk: "low" | "medium" | "high" | "critical" =
        overallRisk < 25 ? "low" :
        overallRisk < 50 ? "medium" :
        overallRisk < 75 ? "high" : "critical";

      return {
        score: overallRisk,
        risk,
        dimensions: parsed.dimensions ?? {},
        flaggedClaims: parsed.flaggedClaims ?? [],
        recommendation: parsed.recommendation ?? "",
      };
    }
  } catch { /* fall through */ }

  return {
    score: 50,
    risk: "medium",
    dimensions: {},
    flaggedClaims: [],
    recommendation: text.slice(0, 200),
  };
}

// ─── Routes ──────────────────────────────────────────────────────────────────

export async function hallucinationScorerPlugin(app: FastifyInstance) {

  /**
   * POST /hallucination/score
   * Score a single response for hallucination risk.
   */
  app.post("/hallucination/score", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = scoreSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { query, response, context = [], agentResponses = [] } = parsed.data;

    const result = await scoreHallucination(query, response, context, agentResponses);

    const shouldFlag = result.score >= 60;

    return reply.send({
      success: true,
      query: query.slice(0, 100) + "...",
      ...result,
      shouldFlag,
      flagReason: shouldFlag ? `Hallucination risk score: ${result.score}/100 (${result.risk})` : null,
    });
  });

  /**
   * POST /hallucination/batch-score
   * Score multiple agent responses at once.
   * Returns per-agent scores + identifies the most reliable response.
   */
  app.post("/hallucination/batch-score", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = batchScoreSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { query, responses, context = [] } = parsed.data;

    const results = await Promise.all(
      responses.map(async ({ agent, response }) => {
        const otherAgents = responses
          .filter(r => r.agent !== agent)
          .map(r => ({ agent: r.agent, response: r.response }));

        const result = await scoreHallucination(query, response, context, otherAgents);
        return { agent, ...result };
      }),
    );

    // Find most reliable (lowest score)
    const mostReliable = results.reduce((a, b) => a.score < b.score ? a : b);
    const avgScore = results.reduce((sum, r) => sum + r.score, 0) / results.length;

    return reply.send({
      success: true,
      query: query.slice(0, 100) + "...",
      results,
      mostReliableAgent: mostReliable.agent,
      mostReliableScore: mostReliable.score,
      averageRiskScore: Math.round(avgScore),
      shouldReviewManually: avgScore >= 60,
    });
  });

  /**
   * POST /hallucination/groundedness
   * Check how well a response is grounded in provided context.
   * Equivalent to RAGAS faithfulness metric.
   */
  app.post("/hallucination/groundedness", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { response: aiResponse, context } = req.body as {
      response?: string;
      context?: string[];
    };

    if (!aiResponse) return reply.status(400).send({ error: "response required" });
    if (!context?.length) return reply.status(400).send({ error: "context array required" });

    const prompt = `Measure how well this AI response is grounded in the provided context.
This is the RAGAS faithfulness metric.

CONTEXT DOCUMENTS:
${context.slice(0, 5).map((c, i) => `[${i + 1}] ${c.slice(0, 400)}`).join("\n\n")}

AI RESPONSE:
${aiResponse.slice(0, 3000)}

For each claim in the response:
1. Does it appear in the context? (grounded)
2. Does it contradict the context? (hallucination)
3. Is it neither supported nor contradicted? (neutral/inferred)

Return JSON:
{
  "faithfulnessScore": 0.0-1.0,
  "groundedClaims": number,
  "hallucinatedClaims": number,
  "neutralClaims": number,
  "examples": [
    { "claim": "...", "status": "grounded|hallucinated|neutral", "evidence": "relevant context quote or null" }
  ]
}`;

    const llmResponse = await askProvider(
      { ...llmProvider(), systemPrompt: "You are a groundedness evaluator. Be precise and objective." },
      [{ role: "user", content: prompt }],
    );
    const text = typeof llmResponse === "string" ? llmResponse : (llmResponse as any)?.content ?? "";

    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return reply.send({ success: true, ...JSON.parse(jsonMatch[0]) });
      }
    } catch { /* fall through */ }

    return reply.send({ success: true, faithfulnessScore: 0.5, raw: text });
  });

  /**
   * GET /hallucination/thresholds
   * Get recommended action thresholds by risk level.
   */
  app.get("/hallucination/thresholds", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    return reply.send({
      success: true,
      thresholds: {
        low:      { range: "0-24",  action: "deliver",        description: "Well-grounded, low hallucination risk" },
        medium:   { range: "25-49", action: "deliver_with_caveat", description: "Some risk — add uncertainty note" },
        high:     { range: "50-74", action: "flag_to_user",   description: "Notable risk — flag before delivery" },
        critical: { range: "75-100", action: "withhold_or_revise", description: "High risk — do not deliver without revision" },
      },
    });
  });
}
