/**
 * Enterprise RAG Benchmark — Scoring
 *
 * Checklist scoring, holistic scoring, and pairwise comparison
 * using LLM-as-judge. Modeled after Onyx's EnterpriseRAG-Bench scoring.
 */

import type { BenchmarkQuestion, RetrievalResult } from "./models.js";

// ─── Retrieval Scoring ─────────────────────────────────────────────

export function scoreRetrieval(
  question: BenchmarkQuestion,
  retrievals: RetrievalResult[],
  topK: number,
): { recall: number; precision: number; mrr: number } {
  const retrievedIds = retrievals.slice(0, topK).map((r) => r.documentId);
  const relevantSet = new Set(question.sourceDocIds);

  // Recall: fraction of relevant docs found
  const found = retrievedIds.filter((id) => relevantSet.has(id));
  const recall = relevantSet.size > 0 ? found.length / relevantSet.size : 0;

  // Precision: fraction of retrieved docs that are relevant
  const precision = retrievedIds.length > 0 ? found.length / retrievedIds.length : 0;

  // MRR: reciprocal rank of first relevant doc
  let mrr = 0;
  for (let i = 0; i < retrievedIds.length; i++) {
    if (relevantSet.has(retrievedIds[i])) {
      mrr = 1 / (i + 1);
      break;
    }
  }

  return { recall, precision, mrr };
}

// ─── Checklist Scoring ─────────────────────────────────────────────

export function buildChecklistPrompt(
  question: string,
  answer: string,
  checklist: string[],
): { system: string; user: string } {
  const system = `You are an evaluation judge. Given a question, an answer, and a checklist of required facts, determine which checklist items are present in the answer.

For each checklist item, respond with ONLY "YES" or "NO" on a separate line, in the same order as the checklist items. Do not include any other text.`;

  const checklistText = checklist
    .map((item, i) => `${i + 1}. ${item}`)
    .join("\n");

  const user = `Question: ${question}

Answer: ${answer}

Checklist items (respond YES or NO for each):
${checklistText}`;

  return { system, user };
}

export function parseChecklistResponse(
  response: string,
  checklistLength: number,
): number {
  const lines = response
    .split("\n")
    .map((l) => l.trim().toUpperCase())
    .filter((l) => l === "YES" || l === "NO");

  if (lines.length === 0) return 0;

  const yesCount = lines.slice(0, checklistLength).filter((l) => l === "YES").length;
  return yesCount / checklistLength;
}

// ─── Holistic Scoring ──────────────────────────────────────────────

export function buildHolisticPrompt(
  question: string,
  answer: string,
  expectedAnswer: string,
): { system: string; user: string } {
  const system = `You are an evaluation judge. Rate the quality of an AI-generated answer compared to the expected answer.

Score on a scale of 1-5:
1 = Completely wrong or irrelevant
2 = Partially addresses the question but mostly incorrect
3 = Addresses the question but misses key details
4 = Good answer with minor omissions
5 = Excellent, comprehensive answer

Respond with ONLY a single number (1-5). Do not include any other text.`;

  const user = `Question: ${question}

Expected Answer: ${expectedAnswer}

AI Answer: ${answer}

Score (1-5):`;

  return { system, user };
}

export function parseHolisticResponse(response: string): number {
  const match = response.trim().match(/^([1-5])/);
  return match ? parseInt(match[1], 10) : 3; // Default to 3 if unparseable
}

// ─── Faithfulness Scoring ──────────────────────────────────────────

export function buildFaithfulnessPrompt(
  answer: string,
  sources: string[],
): { system: string; user: string } {
  const system = `You are an evaluation judge. Rate how faithful the answer is to the provided source documents.

Score on a scale of 1-5:
1 = Answer contains significant claims not supported by sources (hallucination)
2 = Answer has several unsupported claims
3 = Answer is mostly faithful but includes some unsupported details
4 = Answer is faithful with only minor extrapolations
5 = Answer is completely faithful to the sources

Respond with ONLY a single number (1-5). Do not include any other text.`;

  const sourcesText = sources
    .map((s, i) => `[Source ${i + 1}]: ${s}`)
    .join("\n\n");

  const user = `Answer: ${answer}

Sources:
${sourcesText}

Faithfulness Score (1-5):`;

  return { system, user };
}

export function parseFaithfulnessResponse(response: string): number {
  const match = response.trim().match(/^([1-5])/);
  return match ? parseInt(match[1], 10) : 3;
}

// ─── Pairwise Comparison ──────────────────────────────────────────

export function buildPairwisePrompt(
  question: string,
  answerA: string,
  answerB: string,
): { system: string; user: string } {
  const system = `You are an evaluation judge. Compare two answers to a question and determine which is better.

Respond with ONLY one of: "A", "B", or "TIE". Do not include any other text.`;

  const user = `Question: ${question}

Answer A: ${answerA}

Answer B: ${answerB}

Which answer is better (A, B, or TIE)?`;

  return { system, user };
}

export function parsePairwiseResponse(response: string): "A" | "B" | "TIE" {
  const upper = response.trim().toUpperCase();
  if (upper.startsWith("A")) return "A";
  if (upper.startsWith("B")) return "B";
  return "TIE";
}

// ─── Aggregate Helpers ─────────────────────────────────────────────

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}
