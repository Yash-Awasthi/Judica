/**
 * Phase 8.11 — Council Evals Framework
 *
 * Automated quality testing for council deliberations against labeled datasets.
 * Uses LLM-as-judge scoring pattern.
 *
 * Ref: Onyx EnterpriseRAG-Bench (https://github.com/onyx-dot-app/EnterpriseRAG-Bench)
 *      LLM-as-judge methodology (Zheng et al., 2023 — MT-Bench paper)
 *
 * Architecture:
 *   1. EvalDataset — a collection of EvalCase (question + expected answer + metadata)
 *   2. EvalRunner — runs a council deliberation for each case and collects responses
 *   3. EvalJudge  — uses an LLM to score each response on multiple dimensions
 *   4. EvalReport — aggregates scores, computes pass rate, surfaces regressions
 *
 * Scoring dimensions (each 1–5):
 *   - Faithfulness:   Does the response stay grounded in provided context? (no hallucination)
 *   - Relevance:      Does it answer the actual question asked?
 *   - Completeness:   Does it cover all required aspects?
 *   - Correctness:    For factual questions: is the answer factually accurate?
 *   - Conciseness:    Is it appropriately concise without missing substance?
 *
 * Judge model: gpt-4o-mini or claude-3-haiku (fast, cheap, judge-capable)
 * Falls back to keyword-based scoring if no judge LLM is configured.
 */

import { routeAndCollect } from "../router/index.js";
import logger from "../lib/logger.js";

const log = logger.child({ service: "evals" });

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EvalCase {
  id: string;
  question: string;
  /** Expected answer or key points that should appear in the response */
  expectedAnswer: string;
  /** Optional context documents (as would be retrieved by RAG) */
  context?: string[];
  /** Minimum acceptable score (1–5) per dimension. Default: 3 */
  thresholds?: Partial<EvalScores>;
  metadata?: Record<string, string>;
}

export interface EvalScores {
  faithfulness: number;    // 1-5: grounded in context, no hallucination
  relevance: number;       // 1-5: answers the question
  completeness: number;    // 1-5: covers all required aspects
  correctness: number;     // 1-5: factually accurate
  conciseness: number;     // 1-5: appropriately brief
}

export interface EvalResult {
  caseId: string;
  question: string;
  response: string;
  scores: EvalScores;
  overallScore: number;    // weighted average
  passed: boolean;
  failedDimensions: string[];
  reasoning: string;
  durationMs: number;
  tokenCost: { prompt: number; completion: number };
}

export interface EvalReport {
  runId: string;
  timestamp: number;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  passRate: number;         // 0–1
  averageScores: EvalScores;
  worstCases: EvalResult[]; // Bottom 3 by overall score
  results: EvalResult[];
  durationMs: number;
}

export interface EvalRunOptions {
  /** LLM model/provider to use as judge. Defaults to gpt-4o-mini. */
  judgeModel?: string;
  judgeProvider?: string;
  /** Score weights (must sum to 1.0). Default: equal weights. */
  weights?: Partial<EvalScores>;
  /** Default pass threshold for all dimensions. Default: 3 */
  defaultThreshold?: number;
  /** Max parallel eval cases */
  concurrency?: number;
}

// ─── Score Weights ────────────────────────────────────────────────────────────

const DEFAULT_WEIGHTS: EvalScores = {
  faithfulness: 0.30,
  relevance:    0.25,
  completeness: 0.20,
  correctness:  0.15,
  conciseness:  0.10,
};

// ─── LLM Judge ────────────────────────────────────────────────────────────────

const JUDGE_SYSTEM_PROMPT = `You are an expert evaluator for AI assistant responses.
Score the response on the following dimensions, each on a scale of 1 to 5:
  - faithfulness (1-5): Is the response grounded in the provided context? No hallucination?
  - relevance    (1-5): Does it directly answer the question asked?
  - completeness (1-5): Does it cover all required aspects from the expected answer?
  - correctness  (1-5): Is the factual content accurate?
  - conciseness  (1-5): Is it appropriately concise without losing substance?

Respond ONLY with valid JSON in this exact format:
{"faithfulness": N, "relevance": N, "completeness": N, "correctness": N, "conciseness": N, "reasoning": "brief justification"}`;

async function judgeWithLLM(
  evalCase: EvalCase,
  response: string,
  judgeModel: string,
  judgeProvider: string
): Promise<{ scores: EvalScores; reasoning: string; tokenCost: { prompt: number; completion: number } }> {
  const userPrompt = [
    `QUESTION: ${evalCase.question}`,
    evalCase.context ? `CONTEXT:\n${evalCase.context.join("\n---\n")}` : "",
    `EXPECTED KEY POINTS: ${evalCase.expectedAnswer}`,
    `ACTUAL RESPONSE: ${response}`,
    ``,
    `Score the actual response on all five dimensions.`,
  ].filter(Boolean).join("\n\n");

  const result = await routeAndCollect(
    {
      messages: [{ role: "user", content: userPrompt }],
      model: judgeModel,
      system_prompt: JUDGE_SYSTEM_PROMPT,
      temperature: 0.0,
      max_tokens: 300,
    },
    { preferredProvider: judgeProvider }
  );

  try {
    const parsed = JSON.parse(result.text ?? "{}") as EvalScores & { reasoning?: string };
    const scores: EvalScores = {
      faithfulness: clampScore(parsed.faithfulness ?? 3),
      relevance:    clampScore(parsed.relevance    ?? 3),
      completeness: clampScore(parsed.completeness ?? 3),
      correctness:  clampScore(parsed.correctness  ?? 3),
      conciseness:  clampScore(parsed.conciseness  ?? 3),
    };
    return {
      scores,
      reasoning: parsed.reasoning ?? "",
      tokenCost: {
        prompt: result.usage?.prompt_tokens ?? 0,
        completion: result.usage?.completion_tokens ?? 0,
      },
    };
  } catch {
    // Fallback: keyword-based scoring when JSON parse fails
    return {
      scores: keywordScores(evalCase, response),
      reasoning: "JSON parse failed — fell back to keyword scoring",
      tokenCost: { prompt: 0, completion: 0 },
    };
  }
}

function clampScore(n: unknown): number {
  const v = typeof n === "number" ? n : parseFloat(String(n));
  return Math.min(5, Math.max(1, isNaN(v) ? 3 : Math.round(v)));
}

/** Keyword-based fallback scorer for when no judge LLM is available */
function keywordScores(evalCase: EvalCase, response: string): EvalScores {
  const responseL = response.toLowerCase();
  const expectedWords = evalCase.expectedAnswer.toLowerCase().split(/\s+/).filter(w => w.length > 4);
  const matched = expectedWords.filter(w => responseL.includes(w)).length;
  const coverage = expectedWords.length > 0 ? matched / expectedWords.length : 0.5;
  const score = Math.round(1 + coverage * 4);
  return {
    faithfulness: score,
    relevance:    score,
    completeness: score,
    correctness:  score,
    conciseness:  response.length < 2000 ? 4 : 2,
  };
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

function computeOverallScore(scores: EvalScores, weights: EvalScores): number {
  return (
    scores.faithfulness * weights.faithfulness +
    scores.relevance    * weights.relevance    +
    scores.completeness * weights.completeness +
    scores.correctness  * weights.correctness  +
    scores.conciseness  * weights.conciseness
  );
}

function checkThresholds(
  scores: EvalScores,
  thresholds: Partial<EvalScores>,
  defaultThreshold: number
): string[] {
  const failed: string[] = [];
  for (const dim of Object.keys(scores) as (keyof EvalScores)[]) {
    const threshold = thresholds[dim] ?? defaultThreshold;
    if (scores[dim] < threshold) failed.push(dim);
  }
  return failed;
}

function averageScores(results: EvalResult[]): EvalScores {
  if (results.length === 0) {
    return { faithfulness: 0, relevance: 0, completeness: 0, correctness: 0, conciseness: 0 };
  }
  const sum = results.reduce(
    (acc, r) => ({
      faithfulness: acc.faithfulness + r.scores.faithfulness,
      relevance:    acc.relevance    + r.scores.relevance,
      completeness: acc.completeness + r.scores.completeness,
      correctness:  acc.correctness  + r.scores.correctness,
      conciseness:  acc.conciseness  + r.scores.conciseness,
    }),
    { faithfulness: 0, relevance: 0, completeness: 0, correctness: 0, conciseness: 0 }
  );
  const n = results.length;
  return {
    faithfulness: sum.faithfulness / n,
    relevance:    sum.relevance    / n,
    completeness: sum.completeness / n,
    correctness:  sum.correctness  / n,
    conciseness:  sum.conciseness  / n,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Run an eval suite against a set of labeled cases.
 *
 * @param cases       - Eval cases to evaluate
 * @param getResponse - Function that returns the council response for a given query
 *                      (caller wires this to the orchestrator or a mock)
 * @param opts        - Judge configuration
 */
export async function runEvalSuite(
  cases: EvalCase[],
  getResponse: (question: string, context?: string[]) => Promise<string>,
  opts: EvalRunOptions = {}
): Promise<EvalReport> {
  const runId = `eval-${Date.now()}`;
  const t0 = Date.now();

  const judgeModel    = opts.judgeModel    ?? "gpt-4o-mini";
  const judgeProvider = opts.judgeProvider ?? "openai";
  const weights       = { ...DEFAULT_WEIGHTS, ...opts.weights };
  const defaultThreshold = opts.defaultThreshold ?? 3;
  const concurrency = opts.concurrency ?? 3;

  log.info({ runId, caseCount: cases.length, judgeModel }, "Eval suite starting");

  const results: EvalResult[] = [];

  // Process in batches of `concurrency`
  for (let i = 0; i < cases.length; i += concurrency) {
    const batch = cases.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(
      batch.map(async (evalCase) => {
        const t1 = Date.now();
        let response: string;
        try {
          response = await getResponse(evalCase.question, evalCase.context);
        } catch (err) {
          response = `[Error generating response: ${(err as Error).message}]`;
        }

        const { scores, reasoning, tokenCost } = await judgeWithLLM(
          evalCase,
          response,
          judgeModel,
          judgeProvider
        ).catch(() => ({
          scores: keywordScores(evalCase, response),
          reasoning: "judge failed — keyword fallback",
          tokenCost: { prompt: 0, completion: 0 },
        }));

        const overallScore = computeOverallScore(scores, weights);
        const failedDimensions = checkThresholds(
          scores,
          evalCase.thresholds ?? {},
          defaultThreshold
        );

        return {
          caseId: evalCase.id,
          question: evalCase.question,
          response,
          scores,
          overallScore,
          passed: failedDimensions.length === 0,
          failedDimensions,
          reasoning,
          durationMs: Date.now() - t1,
          tokenCost,
        } satisfies EvalResult;
      })
    );

    for (const r of batchResults) {
      if (r.status === "fulfilled") {
        results.push(r.value);
      } else {
        log.warn({ err: r.reason }, "Eval case failed");
      }
    }
  }

  const passed = results.filter(r => r.passed);
  const worst3 = [...results].sort((a, b) => a.overallScore - b.overallScore).slice(0, 3);

  const report: EvalReport = {
    runId,
    timestamp: t0,
    totalCases: cases.length,
    passedCases: passed.length,
    failedCases: results.length - passed.length,
    passRate: results.length > 0 ? passed.length / results.length : 0,
    averageScores: averageScores(results),
    worstCases: worst3,
    results,
    durationMs: Date.now() - t0,
  };

  log.info({
    runId,
    passRate: report.passRate.toFixed(2),
    durationMs: report.durationMs,
  }, "Eval suite complete");

  return report;
}
