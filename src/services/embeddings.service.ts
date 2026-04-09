import crypto from "crypto";
import { LRUCache } from "lru-cache";
import { env } from "../config/env.js";
import logger from "../lib/logger.js";

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
    const data = await res.json() as any;
    embedding = data.data[0].embedding;
  } else if (env.GOOGLE_API_KEY) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${env.GOOGLE_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: { parts: [{ text }] } }),
      }
    );
    if (!res.ok) throw new Error(`Gemini embeddings failed: ${res.status} ${await res.text()}`);
    const data = await res.json() as any;
    embedding = data.embedding.values;
    // Gemini text-embedding-004 is 768-dim, pad to 1536 for consistency
    if (embedding.length < 1536) {
      embedding = [...embedding, ...new Array(1536 - embedding.length).fill(0)];
    }
  } else {
    throw new Error("No embedding provider available. Set OPENAI_API_KEY or GOOGLE_API_KEY.");
  }

  cache.set(key, embedding);
  return embedding;
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  // Simple sequential for now, can batch with OpenAI later
  return Promise.all(texts.map((t) => embed(t)));
}
