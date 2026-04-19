import { db } from "../lib/drizzle.js";
import { memories } from "../db/schema/memory.js";
import { eq, and, lt, inArray, sql } from "drizzle-orm";
import { embed } from "./embeddings.service.js";
import { storeChunk } from "./vectorStore.service.js";
import { routeAndCollect } from "../router/index.js";
import logger from "../lib/logger.js";

export interface CompactionResult {
  originalCount: number;
  compactedCount: number;
  tokensSaved: number;
  expiredCount: number;
}

/**
 * Exponential decay score: returns 0..1 where 1 = just accessed, 0 = stale.
 * halfLifeDays controls how fast memories decay.
 */
function decayScore(lastAccessedAt: Date | null, createdAt: Date, halfLifeDays: number = 14): number {
  const referenceDate = lastAccessedAt || createdAt;
  const ageMs = Date.now() - referenceDate.getTime();
  const ageDays = ageMs / (24 * 60 * 60 * 1000);
  return Math.pow(0.5, ageDays / halfLifeDays);
}

/** One-off facts with no access after 30 days are expired. */
const ONE_OFF_TTL_DAYS = 30;

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB) + 1e-10);
}

interface MemoryChunkWithEmbedding {
  id: string;
  content: string;
  embedding: number[];
  kbId: string | null;
  sourceName: string | null;
}

export async function compact(userId: number): Promise<CompactionResult> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const ttlCutoff = new Date(Date.now() - ONE_OFF_TTL_DAYS * 24 * 60 * 60 * 1000);

  // ── Step 1: Expire one-off memories (>30 days old, never accessed) ──
  const expiredResult = await db.execute(sql`
    DELETE FROM "Memory"
    WHERE "userId" = ${userId}
      AND "createdAt" < ${ttlCutoff}
      AND ("lastAccessedAt" IS NULL)
      AND ("accessCount" IS NULL OR "accessCount" = 0)
    RETURNING "id"
  `);
  const expiredCount = expiredResult.rowCount ?? 0;
  if (expiredCount > 0) {
    logger.info({ userId, expiredCount }, "Expired stale one-off memories");
  }

  // ── Step 2: Get old memories for compaction ──
  const oldMemories = await db
    .select({
      id: memories.id,
      content: memories.content,
      kbId: memories.kbId,
      sourceName: memories.sourceName,
    })
    .from(memories)
    .where(
      and(
        eq(memories.userId, userId),
        lt(memories.createdAt, sevenDaysAgo)
      )
    );

  if (oldMemories.length < 10) {
    return { originalCount: 0, compactedCount: 0, tokensSaved: 0, expiredCount };
  }

  // Embed all chunks
  const chunksWithEmbeddings: MemoryChunkWithEmbedding[] = [];
  for (const mem of oldMemories) {
    const embeddingRaw = (mem as any).embedding as unknown;
    let embedding: number[];
    if (Array.isArray(embeddingRaw)) {
      embedding = embeddingRaw as number[];
    } else {
      // Re-embed if missing
      embedding = await embed(mem.content);
    }
    chunksWithEmbeddings.push({
      id: mem.id,
      content: mem.content,
      embedding,
      kbId: mem.kbId,
      sourceName: mem.sourceName,
    });
  }

  // Cluster by cosine similarity > 0.85
  const visited = new Set<string>();
  const clusters: MemoryChunkWithEmbedding[][] = [];

  for (const chunk of chunksWithEmbeddings) {
    if (visited.has(chunk.id)) continue;
    visited.add(chunk.id);

    const cluster: MemoryChunkWithEmbedding[] = [chunk];

    for (const other of chunksWithEmbeddings) {
      if (visited.has(other.id)) continue;
      const sim = cosineSimilarity(chunk.embedding, other.embedding);
      if (sim > 0.85) {
        cluster.push(other);
        visited.add(other.id);
      }
    }

    if (cluster.length >= 2) {
      clusters.push(cluster);
    }
  }

  let compactedCount = 0;
  let originalTokens = 0;
  let compactedTokens = 0;

  for (const cluster of clusters) {
    const combinedText = cluster.map((c) => c.content).join("\n\n---\n\n");
    originalTokens += combinedText.length / 4; // rough estimate

    // Synthesize cluster into one memory
    const result = await routeAndCollect({
      model: "auto",
      messages: [
        {
          role: "user",
          content: `Synthesize these related memories into one concise paragraph that preserves all key information:\n\n${combinedText.substring(0, 4000)}`,
        },
      ],
      temperature: 0,
    });

    const compactedText = result.text;
    compactedTokens += compactedText.length / 4;

    // Store new compacted memory
    const kbId = cluster[0].kbId;
    await storeChunk(
      userId,
      kbId || null,
      compactedText,
      0,
      `compacted_${Date.now()}`,
      undefined
    );

    // Delete original chunks
    await db
      .delete(memories)
      .where(inArray(memories.id, cluster.map((c) => c.id)));

    compactedCount++;
  }

  const totalOriginal = clusters.reduce((sum, c) => sum + c.length, 0);
  const tokensSaved = Math.round(originalTokens - compactedTokens);

  logger.info(
    { userId, originalCount: totalOriginal, compactedCount, tokensSaved, expiredCount },
    "Memory compaction complete"
  );

  return {
    originalCount: totalOriginal,
    compactedCount,
    tokensSaved: Math.max(0, tokensSaved),
    expiredCount,
  };
}
