/**
 * Braintrust Eval Provider — integrates with Braintrust for eval tracking.
 */

import logger from "../../lib/logger.js";
import type { EvalProvider, EvalInput, EvalResult, EvalScores, EvalRun } from "../models.js";
import { LocalEvalProvider } from "./local.js";

/**
 * Braintrust provider — uses local LLM-as-judge for scoring,
 * then reports results to Braintrust for tracking and dashboards.
 *
 * Requires BRAINTRUST_API_KEY environment variable.
 */
export class BraintrustEvalProvider implements EvalProvider {
  name = "braintrust";
  private localProvider: LocalEvalProvider;
  private apiKey: string | undefined;

  constructor(judgeModel?: string) {
    this.localProvider = new LocalEvalProvider(judgeModel);
    this.apiKey = process.env.BRAINTRUST_API_KEY;
  }

  async score(
    input: EvalInput,
    result: Omit<EvalResult, "scores" | "judgeReasoning">,
  ): Promise<{ scores: EvalScores; reasoning: string }> {
    // Use local LLM-as-judge for actual scoring
    return this.localProvider.score(input, result);
  }

  async report(run: EvalRun): Promise<void> {
    if (!this.apiKey) {
      logger.warn("BRAINTRUST_API_KEY not set — skipping Braintrust report");
      return;
    }

    try {
      // Create experiment in Braintrust
      const response = await fetch("https://api.braintrust.dev/v1/experiment", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          project_name: "judica-evals",
          experiment_name: run.name,
          metadata: {
            startedAt: run.startedAt.toISOString(),
            completedAt: run.completedAt?.toISOString(),
            totalTokens: run.totalTokens,
          },
        }),
        signal: AbortSignal.timeout(30_000),
      });

      if (!response.ok) {
        logger.warn({ status: response.status }, "Braintrust experiment creation failed");
        return;
      }

      const experiment = (await response.json()) as { id: string };

      // Log individual results
      for (const result of run.results) {
        await fetch(`https://api.braintrust.dev/v1/experiment/${experiment.id}/insert`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            events: [
              {
                input: { query: result.query },
                output: result.actualAnswer,
                expected: run.config.dataset.find((d) => d.id === result.inputId)?.expectedAnswer,
                scores: result.scores,
                metadata: {
                  latencyMs: result.latencyMs,
                  tokensUsed: result.tokensUsed,
                  toolsCalled: result.toolsCalled,
                },
              },
            ],
          }),
          signal: AbortSignal.timeout(10_000),
        });
      }

      logger.info(
        { experimentId: experiment.id, resultCount: run.results.length },
        "Results reported to Braintrust",
      );
    } catch (err) {
      logger.warn({ err }, "Braintrust reporting failed");
    }
  }
}
