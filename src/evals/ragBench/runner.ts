/**
 * Enterprise RAG Benchmark — Runner
 *
 * Loads benchmark datasets, executes queries against judica's search API,
 * scores with LLM-as-judge, and aggregates metrics.
 *
 * Modeled after Onyx's EnterpriseRAG-Bench evaluation pipeline.
 */

import type {
  BenchmarkConfig,
  BenchmarkQuestion,
  BenchmarkRun,
  QuestionResult,
  RetrievalResult,
  GenerationResult,
  AggregateMetrics,
} from "./models.js";
import {
  scoreRetrieval,
  buildChecklistPrompt,
  parseChecklistResponse,
  buildHolisticPrompt,
  parseHolisticResponse,
  buildFaithfulnessPrompt,
  parseFaithfulnessResponse,
  mean,
  percentile,
} from "./scoring.js";

type ProgressCallback = (completed: number, total: number, current?: QuestionResult) => void;

// ─── Dataset Loading ───────────────────────────────────────────────

export async function loadBenchmark(datasetPath: string): Promise<BenchmarkQuestion[]> {
  // Support both file paths and URLs
  let text: string;

  if (datasetPath.startsWith("http://") || datasetPath.startsWith("https://")) {
    const res = await fetch(datasetPath, { signal: AbortSignal.timeout(60000) });
    if (!res.ok) throw new Error(`Failed to fetch dataset: HTTP ${res.status}`);
    text = await res.text();
  } else {
    // Node.js file read
    const fs = await import("fs/promises");
    text = await fs.readFile(datasetPath, "utf-8");
  }

  // Parse JSONL
  const questions: BenchmarkQuestion[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      questions.push({
        id: String(parsed.id || questions.length),
        question: String(parsed.question || ""),
        expectedAnswer: String(parsed.expected_answer || parsed.expectedAnswer || ""),
        checklist: Array.isArray(parsed.checklist) ? parsed.checklist.map(String) : [],
        sourceDocIds: Array.isArray(parsed.source_doc_ids || parsed.sourceDocIds)
          ? (parsed.source_doc_ids as string[] || parsed.sourceDocIds as string[]).map(String)
          : [],
        difficulty: (parsed.difficulty as "easy" | "medium" | "hard") || "medium",
        category: String(parsed.category || "general"),
      });
    } catch {
      // Skip malformed lines
    }
  }

  return questions;
}

// ─── Query Execution ───────────────────────────────────────────────

async function executeSearch(
  config: BenchmarkConfig,
  question: string,
): Promise<{ retrievals: RetrievalResult[]; latencyMs: number }> {
  const start = Date.now();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.apiKey) headers["Authorization"] = `Bearer ${config.apiKey}`;

  const body: Record<string, unknown> = {
    query: question,
    topK: config.topK,
  };
  if (config.knowledgeBaseId) body.knowledgeBaseId = config.knowledgeBaseId;

  const res = await fetch(`${config.apiBaseUrl}/api/search`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(config.timeoutMs),
  });

  if (!res.ok) throw new Error(`Search failed: HTTP ${res.status}`);

  const data = (await res.json()) as {
    results?: Array<{ id: string; title: string; score: number; content: string }>;
  };

  const retrievals: RetrievalResult[] = (data.results || []).map((r) => ({
    documentId: r.id,
    title: r.title || "",
    score: r.score || 0,
    content: (r.content || "").slice(0, 2000),
  }));

  return { retrievals, latencyMs: Date.now() - start };
}

async function executeGeneration(
  config: BenchmarkConfig,
  question: string,
): Promise<GenerationResult> {
  const start = Date.now();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.apiKey) headers["Authorization"] = `Bearer ${config.apiKey}`;

  const body: Record<string, unknown> = { query: question };
  if (config.knowledgeBaseId) body.knowledgeBaseId = config.knowledgeBaseId;

  const res = await fetch(`${config.apiBaseUrl}/api/chat`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(config.timeoutMs),
  });

  if (!res.ok) throw new Error(`Chat failed: HTTP ${res.status}`);

  const data = (await res.json()) as {
    answer?: string;
    sources?: Array<{ id: string }>;
  };

  return {
    answer: data.answer || "",
    citedSources: (data.sources || []).map((s) => s.id),
    latencyMs: Date.now() - start,
  };
}

// ─── LLM Judge ─────────────────────────────────────────────────────

async function callJudge(
  config: BenchmarkConfig,
  system: string,
  user: string,
): Promise<string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.apiKey) headers["Authorization"] = `Bearer ${config.apiKey}`;

  const res = await fetch(`${config.apiBaseUrl}/api/chat`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      model: config.judgeModel,
      temperature: 0,
      max_tokens: 256,
    }),
    signal: AbortSignal.timeout(config.timeoutMs),
  });

  if (!res.ok) return "";
  const data = (await res.json()) as { answer?: string };
  return data.answer || "";
}

// ─── Single Question Evaluation ────────────────────────────────────

async function evaluateQuestion(
  config: BenchmarkConfig,
  question: BenchmarkQuestion,
): Promise<QuestionResult> {
  const result: QuestionResult = {
    questionId: question.id,
    question: question.question,
    retrievals: [],
    retrievalScores: { recall: 0, precision: 0, mrr: 0 },
    latencyMs: 0,
  };

  const totalStart = Date.now();

  try {
    // Step 1: Retrieval
    const { retrievals, latencyMs: searchLatency } = await executeSearch(config, question.question);
    result.retrievals = retrievals;
    result.latencyMs = searchLatency;

    // Score retrieval
    result.retrievalScores = scoreRetrieval(question, retrievals, config.topK);

    // Step 2: Generation (optional)
    if (config.evaluateGeneration) {
      const generation = await executeGeneration(config, question.question);
      result.generation = generation;
      result.latencyMs += generation.latencyMs;

      // Score generation with LLM judge
      const scores: { checklistScore: number; holisticScore: number; faithfulness: number } = {
        checklistScore: 0,
        holisticScore: 3,
        faithfulness: 3,
      };

      // Checklist scoring
      if (question.checklist.length > 0) {
        const { system, user } = buildChecklistPrompt(
          question.question,
          generation.answer,
          question.checklist,
        );
        const response = await callJudge(config, system, user);
        scores.checklistScore = parseChecklistResponse(response, question.checklist.length);
      }

      // Holistic scoring
      {
        const { system, user } = buildHolisticPrompt(
          question.question,
          generation.answer,
          question.expectedAnswer,
        );
        const response = await callJudge(config, system, user);
        scores.holisticScore = parseHolisticResponse(response);
      }

      // Faithfulness scoring
      if (retrievals.length > 0) {
        const { system, user } = buildFaithfulnessPrompt(
          generation.answer,
          retrievals.map((r) => r.content),
        );
        const response = await callJudge(config, system, user);
        scores.faithfulness = parseFaithfulnessResponse(response);
      }

      result.generationScores = scores;
    }
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
  }

  result.latencyMs = Date.now() - totalStart;
  return result;
}

// ─── Main Runner ───────────────────────────────────────────────────

export async function runBenchmark(
  config: BenchmarkConfig,
  questions: BenchmarkQuestion[],
  onProgress?: ProgressCallback,
): Promise<BenchmarkRun> {
  const runId = `bench_${Date.now()}`;
  const startTime = Date.now();
  const results: QuestionResult[] = [];

  // Process in batches for concurrency control
  for (let i = 0; i < questions.length; i += config.concurrency) {
    const batch = questions.slice(i, i + config.concurrency);
    const batchResults = await Promise.all(
      batch.map((q) => evaluateQuestion(config, q)),
    );
    results.push(...batchResults);

    for (const r of batchResults) {
      onProgress?.(results.length, questions.length, r);
    }
  }

  const aggregate = computeAggregate(results, config.evaluateGeneration);

  return {
    id: runId,
    timestamp: new Date().toISOString(),
    config,
    results,
    aggregate,
    durationSeconds: (Date.now() - startTime) / 1000,
  };
}

// ─── Aggregation ───────────────────────────────────────────────────

function computeAggregate(
  results: QuestionResult[],
  includeGeneration: boolean,
): AggregateMetrics {
  const successful = results.filter((r) => !r.error);
  const latencies = results.map((r) => r.latencyMs);

  const aggregate: AggregateMetrics = {
    totalQuestions: results.length,
    successCount: successful.length,
    errorCount: results.length - successful.length,
    retrieval: {
      meanRecall: mean(successful.map((r) => r.retrievalScores.recall)),
      meanPrecision: mean(successful.map((r) => r.retrievalScores.precision)),
      meanMRR: mean(successful.map((r) => r.retrievalScores.mrr)),
    },
    latency: {
      meanMs: mean(latencies),
      p50Ms: percentile(latencies, 50),
      p95Ms: percentile(latencies, 95),
      p99Ms: percentile(latencies, 99),
    },
  };

  if (includeGeneration) {
    const withGen = successful.filter((r) => r.generationScores);
    if (withGen.length > 0) {
      aggregate.generation = {
        meanChecklistScore: mean(withGen.map((r) => r.generationScores!.checklistScore)),
        meanHolisticScore: mean(withGen.map((r) => r.generationScores!.holisticScore)),
        meanFaithfulness: mean(withGen.map((r) => r.generationScores!.faithfulness)),
      };
    }
  }

  return aggregate;
}
