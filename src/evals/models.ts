/**
 * Evaluation Framework Models — types for measuring retrieval + generation quality.
 * Modeled after Onyx evals/ subsystem with pluggable providers.
 */

// ─── Eval Config ─────────────────────────────────────────────────────────────

export interface EvalConfig {
  /** Evaluation name/label. */
  name: string;
  /** Dataset of eval inputs. */
  dataset: EvalInput[];
  /** Which provider to use for scoring. */
  provider: "local" | "braintrust";
  /** Model for LLM-as-judge scoring. */
  judgeModel?: string;
  /** Per-input overrides. */
  overrides?: Partial<EvalInputOverrides>;
  /** Max concurrent evaluations. */
  concurrency: number;
}

export const DEFAULT_EVAL_CONFIG: Partial<EvalConfig> = {
  provider: "local",
  concurrency: 5,
};

// ─── Eval Input ──────────────────────────────────────────────────────────────

export interface EvalInput {
  id: string;
  /** The query/question to evaluate. */
  query: string;
  /** Expected answer (ground truth). */
  expectedAnswer?: string;
  /** Expected sources/documents that should be retrieved. */
  expectedSources?: string[];
  /** Context documents to provide (for retrieval eval). */
  context?: string[];
  /** Tags for filtering/grouping results. */
  tags?: string[];
  /** Per-input config overrides. */
  overrides?: EvalInputOverrides;
}

export interface EvalInputOverrides {
  model?: string;
  temperature?: number;
  /** Force specific tools to be called. */
  forcedTools?: string[];
}

// ─── Eval Result ─────────────────────────────────────────────────────────────

export interface EvalResult {
  inputId: string;
  query: string;
  /** The system's actual answer. */
  actualAnswer: string;
  /** Retrieved sources. */
  retrievedSources: string[];
  /** Individual metric scores. */
  scores: EvalScores;
  /** LLM judge reasoning. */
  judgeReasoning?: string;
  /** Tool assertions — which tools were called. */
  toolsCalled?: string[];
  /** Latency in ms. */
  latencyMs: number;
  /** Tokens consumed. */
  tokensUsed: number;
}

export interface EvalScores {
  /** Overall quality score 0-1. */
  quality: number;
  /** Faithfulness: does the answer stay grounded in context? 0-1 */
  faithfulness: number;
  /** Relevance: does the answer address the query? 0-1 */
  relevance: number;
  /** Correctness: does it match expected answer? 0-1 (only if expectedAnswer provided) */
  correctness?: number;
  /** Retrieval precision: relevant docs in retrieved set. 0-1 */
  retrievalPrecision?: number;
  /** Retrieval recall: expected docs found. 0-1 */
  retrievalRecall?: number;
}

// ─── Eval Run ────────────────────────────────────────────────────────────────

export interface EvalRun {
  id: string;
  name: string;
  config: EvalConfig;
  results: EvalResult[];
  /** Aggregate metrics across all inputs. */
  aggregateScores: EvalScores;
  /** Start/end timestamps. */
  startedAt: Date;
  completedAt?: Date;
  /** Total tokens consumed. */
  totalTokens: number;
  /** Total evaluation cost estimate. */
  totalCostEstimate?: number;
}

// ─── Eval Assertion ──────────────────────────────────────────────────────────

export interface EvalAssertion {
  type: "contains" | "not_contains" | "regex" | "tool_called" | "score_above";
  value: string | number;
  /** Field to check (default: actualAnswer). */
  field?: string;
}

// ─── Eval Provider Interface ─────────────────────────────────────────────────

export interface EvalProvider {
  name: string;
  /** Score a single evaluation result. */
  score(input: EvalInput, result: Omit<EvalResult, "scores" | "judgeReasoning">): Promise<{
    scores: EvalScores;
    reasoning: string;
  }>;
  /** Report/upload results to external service. */
  report?(run: EvalRun): Promise<void>;
}
