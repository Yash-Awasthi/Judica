/**
 * Eval Runner — executes evaluation datasets against the aibyai API.
 */

import { randomUUID } from "crypto";
import logger from "../lib/logger.js";
import type {
  EvalConfig,
  EvalInput,
  EvalResult,
  EvalScores,
  EvalRun,
  EvalProvider,
} from "./models.js";
import { LocalEvalProvider } from "./providers/local.js";
import { BraintrustEvalProvider } from "./providers/braintrust.js";

// ─── Provider Factory ────────────────────────────────────────────────────────

function createProvider(config: EvalConfig): EvalProvider {
  switch (config.provider) {
    case "braintrust":
      return new BraintrustEvalProvider(config.judgeModel);
    case "local":
    default:
      return new LocalEvalProvider(config.judgeModel);
  }
}

// ─── Main Runner ─────────────────────────────────────────────────────────────

/**
 * Run a full evaluation: execute each input, score results, aggregate metrics.
 */
export async function runEvaluation(
  config: EvalConfig,
  executeQuery: (query: string, context?: string[]) => Promise<{ answer: string; sources: string[]; tokensUsed: number }>,
  onProgress?: (completed: number, total: number) => void,
): Promise<EvalRun> {
  const provider = createProvider(config);
  const run: EvalRun = {
    id: randomUUID(),
    name: config.name,
    config,
    results: [],
    aggregateScores: { quality: 0, faithfulness: 0, relevance: 0 },
    startedAt: new Date(),
    totalTokens: 0,
  };

  logger.info(
    { name: config.name, datasetSize: config.dataset.length, provider: config.provider },
    "Starting evaluation run",
  );

  // Process in batches for controlled concurrency
  const concurrency = config.concurrency ?? 5;
  const batches = createBatches(config.dataset, concurrency);

  let completed = 0;

  for (const batch of batches) {
    const results = await Promise.allSettled(
      batch.map(async (input): Promise<EvalResult> => {
        const startTime = Date.now();

        // Execute query
        const execution = await executeQuery(input.query, input.context);

        const partialResult = {
          inputId: input.id,
          query: input.query,
          actualAnswer: execution.answer,
          retrievedSources: execution.sources,
          latencyMs: Date.now() - startTime,
          tokensUsed: execution.tokensUsed,
          toolsCalled: [] as string[],
        };

        // Score with provider
        const { scores, reasoning } = await provider.score(input, partialResult);

        return {
          ...partialResult,
          scores,
          judgeReasoning: reasoning,
        };
      }),
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        run.results.push(result.value);
        run.totalTokens += result.value.tokensUsed;
      } else {
        logger.warn({ error: result.reason }, "Eval input failed");
      }
      completed++;
      onProgress?.(completed, config.dataset.length);
    }
  }

  // Aggregate scores
  run.aggregateScores = aggregateScores(run.results);
  run.completedAt = new Date();

  // Report to external provider
  if (provider.report) {
    await provider.report(run);
  }

  logger.info(
    {
      name: config.name,
      results: run.results.length,
      avgQuality: run.aggregateScores.quality.toFixed(3),
      avgRelevance: run.aggregateScores.relevance.toFixed(3),
      totalTokens: run.totalTokens,
    },
    "Evaluation run complete",
  );

  return run;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function aggregateScores(results: EvalResult[]): EvalScores {
  if (results.length === 0) {
    return { quality: 0, faithfulness: 0, relevance: 0 };
  }

  const sum = (key: keyof EvalScores) => {
    const values = results
      .map((r) => r.scores[key])
      .filter((v): v is number => v !== undefined);
    return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  };

  return {
    quality: sum("quality"),
    faithfulness: sum("faithfulness"),
    relevance: sum("relevance"),
    correctness: sum("correctness") || undefined,
    retrievalPrecision: sum("retrievalPrecision") || undefined,
    retrievalRecall: sum("retrievalRecall") || undefined,
  };
}

function createBatches<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}
