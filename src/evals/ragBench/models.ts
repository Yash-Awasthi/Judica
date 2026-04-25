/**
 * Enterprise RAG Benchmark — Models
 *
 * Types for running Onyx's EnterpriseRAG-Bench (500K-doc benchmark)
 * against aibyai's retrieval and generation pipeline.
 */

export interface BenchmarkConfig {
  /** Path or URL to benchmark dataset (JSONL). */
  datasetPath: string;
  /** aibyai API base URL. */
  apiBaseUrl: string;
  /** API key for authentication. */
  apiKey?: string;
  /** Knowledge base ID to search against. */
  knowledgeBaseId?: string;
  /** Max concurrent requests. */
  concurrency: number;
  /** Timeout per query in ms. */
  timeoutMs: number;
  /** Number of documents to retrieve per query. */
  topK: number;
  /** Whether to run generation evaluation (slower). */
  evaluateGeneration: boolean;
  /** LLM model for judge scoring. */
  judgeModel: string;
  /** Output path for results. */
  outputPath?: string;
}

export const DEFAULT_BENCHMARK_CONFIG: BenchmarkConfig = {
  datasetPath: "",
  apiBaseUrl: "",
  concurrency: 5,
  timeoutMs: 30000,
  topK: 10,
  evaluateGeneration: true,
  judgeModel: "auto",
};

export interface BenchmarkQuestion {
  /** Unique question ID. */
  id: string;
  /** The question text. */
  question: string;
  /** Expected answer (ground truth). */
  expectedAnswer: string;
  /** Checklist items for scoring (each is a required fact). */
  checklist: string[];
  /** Source document IDs that contain the answer. */
  sourceDocIds: string[];
  /** Difficulty level. */
  difficulty: "easy" | "medium" | "hard";
  /** Category/domain. */
  category: string;
}

export interface RetrievalResult {
  /** Document ID returned by search. */
  documentId: string;
  /** Document title. */
  title: string;
  /** Relevance score from search. */
  score: number;
  /** Text excerpt. */
  content: string;
}

export interface GenerationResult {
  /** Generated answer text. */
  answer: string;
  /** Sources cited in the answer. */
  citedSources: string[];
  /** Latency in ms. */
  latencyMs: number;
}

export interface QuestionResult {
  /** Question ID. */
  questionId: string;
  /** The question text. */
  question: string;
  /** Retrieved documents. */
  retrievals: RetrievalResult[];
  /** Generated answer (if evaluateGeneration=true). */
  generation?: GenerationResult;
  /** Retrieval scores. */
  retrievalScores: {
    /** Fraction of source docs found in top-K. */
    recall: number;
    /** Fraction of top-K docs that are relevant. */
    precision: number;
    /** Mean reciprocal rank of first relevant doc. */
    mrr: number;
  };
  /** Generation scores (if evaluated). */
  generationScores?: {
    /** Checklist score: fraction of checklist items present. */
    checklistScore: number;
    /** Holistic quality 1-5. */
    holisticScore: number;
    /** Faithfulness to retrieved sources 1-5. */
    faithfulness: number;
  };
  /** Total latency in ms. */
  latencyMs: number;
  /** Error if query failed. */
  error?: string;
}

export interface BenchmarkRun {
  /** Run ID. */
  id: string;
  /** Timestamp. */
  timestamp: string;
  /** Config used. */
  config: BenchmarkConfig;
  /** Per-question results. */
  results: QuestionResult[];
  /** Aggregate metrics. */
  aggregate: AggregateMetrics;
  /** Runtime in seconds. */
  durationSeconds: number;
}

export interface AggregateMetrics {
  totalQuestions: number;
  successCount: number;
  errorCount: number;
  retrieval: {
    meanRecall: number;
    meanPrecision: number;
    meanMRR: number;
  };
  generation?: {
    meanChecklistScore: number;
    meanHolisticScore: number;
    meanFaithfulness: number;
  };
  latency: {
    meanMs: number;
    p50Ms: number;
    p95Ms: number;
    p99Ms: number;
  };
}

export interface LeaderboardEntry {
  /** System name. */
  system: string;
  /** Run ID. */
  runId: string;
  /** Timestamp. */
  timestamp: string;
  /** Key metrics. */
  metrics: {
    recall: number;
    precision: number;
    mrr: number;
    checklistScore?: number;
    holisticScore?: number;
    meanLatencyMs: number;
  };
}
