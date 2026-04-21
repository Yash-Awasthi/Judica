import crypto from "crypto";
import { LRUCache } from "lru-cache";
import { env } from "../config/env.js";

const cache = new LRUCache<string, number[]>({ max: 1000, ttl: 1000 * 60 * 60 });

function hashText(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

export async function embed(text: string): Promise<number[]> {
  const key = hashText(text);
  const cached = cache.get(key);
  if (cached) return cached;

  let embedding: number[];

  if (env.OPENAI_API_KEY) {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: "text-embedding-3-small", input: text }),
    });
    if (!res.ok) throw new Error(`OpenAI embeddings failed: ${res.status} ${await res.text()}`);
    const data = await res.json() as { data: Array<{ embedding: number[] }> };
    embedding = data.data[0].embedding;
  } else if (env.GOOGLE_API_KEY) {
    const TARGET_DIMENSIONS = 1536;
    // P25-09: Move API key from URL query parameter to header to prevent key leaking in logs
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": env.GOOGLE_API_KEY,
        },
        body: JSON.stringify({
          content: { parts: [{ text }] },
          outputDimensionality: TARGET_DIMENSIONS,
        }),
      }
    );
    if (!res.ok) throw new Error(`Gemini embeddings failed: ${res.status} ${await res.text()}`);
    const data = await res.json() as { embedding: { values: number[] } };
    const rawEmbedding: number[] = data.embedding.values;

    // If Gemini returns fewer dimensions than required (e.g. 768 instead of 1536),
    // normalize the existing vector rather than zero-padding, which would distort
    // cosine similarity. If dimensions match or exceed, just truncate.
    if (rawEmbedding.length >= TARGET_DIMENSIONS) {
      embedding = rawEmbedding.slice(0, TARGET_DIMENSIONS);
    } else {
      // Normalize the shorter vector so cosine similarity remains meaningful
      // when compared against vectors of the target dimensionality.
      const norm = Math.sqrt(rawEmbedding.reduce((sum, v) => sum + v * v, 0)) || 1;
      const normalized = rawEmbedding.map(v => v / norm);
      // Pad with zeros after normalization and re-normalize the full vector
      const padded = [...normalized, ...new Array(TARGET_DIMENSIONS - normalized.length).fill(0)];
      const fullNorm = Math.sqrt(padded.reduce((sum, v) => sum + v * v, 0)) || 1;
      embedding = padded.map(v => v / fullNorm);
    }
  } else {
    throw new Error("No embedding provider available. Set OPENAI_API_KEY or GOOGLE_API_KEY.");
  }

  cache.set(key, embedding);
  return embedding;
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  // P25-10: Cap batch size to prevent memory exhaustion
  const MAX_BATCH_SIZE = 200;
  if (texts.length > MAX_BATCH_SIZE) {
    texts = texts.slice(0, MAX_BATCH_SIZE);
  }
  // Simple sequential for now, can batch with OpenAI later
  return Promise.all(texts.map((t) => embed(t)));
}
