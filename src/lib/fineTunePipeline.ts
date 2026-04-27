/**
 * Fine-Tuning Pipeline — Phase 2.11
 *
 * Use highest-rated council responses as training data for fine-tuning.
 * Generates JSONL datasets compatible with OpenAI fine-tune format.
 *
 * Inspired by:
 * - DSPy (MIT, Stanford, stanfordnlp/dspy) — self-improving pipeline concept
 *   where feedback history drives prompt/model optimisation
 *
 * Strategy:
 * 1. Query chats with rating >= threshold
 * 2. Format as {"messages": [{role, content}, ...]} JSONL
 * 3. Export as downloadable file or kick off OpenAI fine-tune job (stub)
 *
 * Fine-tuning jobs never run automatically — always user-initiated.
 * Minimum 50 rated responses required to produce meaningful improvement.
 */

import { db } from "./drizzle.js";
import { chats } from "../db/schema/conversations.js";
import { eq, gte, and, isNotNull, desc } from "drizzle-orm";

export interface FineTuneExample {
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
}

export interface FineTuneDataset {
  examples: FineTuneExample[];
  count: number;
  eligible: boolean; // true if >= MIN_EXAMPLES
}

const MIN_EXAMPLES = 50;
const DEFAULT_SYSTEM = "You are a helpful AI assistant on the judica council.";

/**
 * Build a fine-tuning dataset from rated council responses.
 * Uses thumbs-up (rating >= 1) responses as positive examples.
 */
export async function buildFineTuneDataset(
  userId: number,
  minRating = 1,
  limit = 500,
): Promise<FineTuneDataset> {
  const rows = await db
    .select({
      question: chats.question,
      verdict:  chats.verdict,
    })
    .from(chats)
    .where(and(
      eq(chats.userId, userId),
      gte((chats as any).rating, minRating),
      isNotNull(chats.verdict),
    ))
    .orderBy(desc((chats as any).rating))
    .limit(limit);

  const examples: FineTuneExample[] = rows
    .filter(r => r.question && r.verdict)
    .map(r => ({
      messages: [
        { role: "system"    as const, content: DEFAULT_SYSTEM },
        { role: "user"      as const, content: r.question! },
        { role: "assistant" as const, content: r.verdict! },
      ],
    }));

  return {
    examples,
    count: examples.length,
    eligible: examples.length >= MIN_EXAMPLES,
  };
}

/**
 * Serialize a fine-tune dataset as JSONL string (one JSON object per line).
 * Compatible with OpenAI fine-tuning format.
 */
export function serializeAsJSONL(dataset: FineTuneDataset): string {
  return dataset.examples.map(e => JSON.stringify(e)).join("\n");
}

/**
 * Stub: initiate an OpenAI fine-tune job.
 * Production: upload the JSONL file, then POST /fine_tuning/jobs.
 * Requires OPENAI_API_KEY env var.
 */
export async function initiateFineTuneJob(
  jsonl: string,
  baseModel = "gpt-4o-mini-2024-07-18",
): Promise<{ jobId: string | null; status: string }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { jobId: null, status: "skipped — OPENAI_API_KEY not set" };
  }

  // Upload training file
  const form = new FormData();
  form.append("purpose", "fine-tune");
  form.append("file", new Blob([jsonl], { type: "application/jsonl" }), "training.jsonl");

  const uploadRes = await fetch("https://api.openai.com/v1/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!uploadRes.ok) {
    return { jobId: null, status: `upload failed: ${uploadRes.statusText}` };
  }

  const { id: fileId } = await uploadRes.json() as { id: string };

  // Create fine-tune job
  const jobRes = await fetch("https://api.openai.com/v1/fine_tuning/jobs", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: baseModel, training_file: fileId }),
  });

  if (!jobRes.ok) {
    return { jobId: null, status: `job creation failed: ${jobRes.statusText}` };
  }

  const { id: jobId } = await jobRes.json() as { id: string };
  return { jobId, status: "queued" };
}
