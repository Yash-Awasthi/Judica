/**
 * Local Eval Provider — LLM-as-judge without external service.
 */

import { routeAndCollect } from "../../router/smartRouter.js";
import logger from "../../lib/logger.js";
import type { EvalProvider, EvalInput, EvalResult, EvalScores } from "../models.js";

const JUDGE_PROMPT = `You are an evaluation judge. Score the AI system's response on these criteria:

1. **Quality** (0-1): Overall answer quality, coherence, and helpfulness
2. **Faithfulness** (0-1): Does the answer stay grounded in the provided context? (1 = fully grounded, 0 = hallucinated)
3. **Relevance** (0-1): Does the answer directly address the query? (1 = fully relevant, 0 = off-topic)
{correctness_section}
{retrieval_section}

Query: {query}
{context_section}
{expected_section}
Actual Answer: {actual_answer}
{sources_section}

Return ONLY a JSON object:
{
  "quality": 0.0-1.0,
  "faithfulness": 0.0-1.0,
  "relevance": 0.0-1.0,
  {correctness_field}
  {retrieval_fields}
  "reasoning": "brief explanation of scores"
}`;

export class LocalEvalProvider implements EvalProvider {
  name = "local";
  private judgeModel: string;

  constructor(judgeModel?: string) {
    this.judgeModel = judgeModel ?? "auto";
  }

  async score(
    input: EvalInput,
    result: Omit<EvalResult, "scores" | "judgeReasoning">,
  ): Promise<{ scores: EvalScores; reasoning: string }> {
    const hasExpectedAnswer = !!input.expectedAnswer;
    const hasExpectedSources = input.expectedSources && input.expectedSources.length > 0;
    const hasContext = input.context && input.context.length > 0;

    let prompt = JUDGE_PROMPT
      .replace("{query}", input.query)
      .replace("{actual_answer}", result.actualAnswer)
      .replace(
        "{correctness_section}",
        hasExpectedAnswer ? "4. **Correctness** (0-1): Does it match the expected answer?" : "",
      )
      .replace(
        "{retrieval_section}",
        hasExpectedSources ? "5. **Retrieval Precision/Recall** (0-1): Are the right sources retrieved?" : "",
      )
      .replace(
        "{context_section}",
        hasContext ? `Context:\n${input.context!.join("\n---\n")}` : "",
      )
      .replace(
        "{expected_section}",
        hasExpectedAnswer ? `Expected Answer: ${input.expectedAnswer}` : "",
      )
      .replace(
        "{sources_section}",
        result.retrievedSources.length > 0
          ? `Retrieved Sources: ${result.retrievedSources.join(", ")}`
          : "",
      )
      .replace(
        "{correctness_field}",
        hasExpectedAnswer ? '"correctness": 0.0-1.0,' : "",
      )
      .replace(
        "{retrieval_fields}",
        hasExpectedSources
          ? '"retrievalPrecision": 0.0-1.0,\n  "retrievalRecall": 0.0-1.0,'
          : "",
      );

    try {
      const response = await routeAndCollect(
        {
          model: this.judgeModel,
          messages: [
            { role: "system", content: "You are a strict but fair evaluation judge." },
            { role: "user", content: prompt },
          ],
          temperature: 0.2,
          max_tokens: 500,
        },
        { tags: ["quality"] },
      );

      const parsed = JSON.parse(response.text);

      const scores: EvalScores = {
        quality: clampScore(parsed.quality),
        faithfulness: clampScore(parsed.faithfulness),
        relevance: clampScore(parsed.relevance),
        ...(hasExpectedAnswer ? { correctness: clampScore(parsed.correctness) } : {}),
        ...(hasExpectedSources
          ? {
              retrievalPrecision: clampScore(parsed.retrievalPrecision),
              retrievalRecall: clampScore(parsed.retrievalRecall),
            }
          : {}),
      };

      return { scores, reasoning: parsed.reasoning ?? "" };
    } catch (err) {
      logger.warn({ err }, "Local eval scoring failed");
      return {
        scores: { quality: 0, faithfulness: 0, relevance: 0 },
        reasoning: "Scoring failed",
      };
    }
  }
}

function clampScore(value: unknown): number {
  const num = Number(value);
  if (isNaN(num)) return 0;
  return Math.max(0, Math.min(1, num));
}
