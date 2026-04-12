import { db } from "../lib/drizzle.js";
import { memoryBackends } from "../db/schema/memory.js";
import { eq } from "drizzle-orm";
import { storeChunk, searchSimilar } from "./vectorStore.service.js";
import { embed } from "./embeddings.service.js";
import logger from "../lib/logger.js";
import { encrypt as cryptoEncrypt, decrypt as cryptoDecrypt } from "../lib/crypto.js";

// Delegate encryption to the shared lib/crypto.ts implementation
// to avoid maintaining two separate AES-256-GCM codepaths
export function encryptConfig(plaintext: string): string {
  return cryptoEncrypt(plaintext);
}

export function decryptConfig(ciphertext: string): string {
  return cryptoDecrypt(ciphertext);
}

export interface MemoryBackendConfig {
  type: "local" | "qdrant" | "getzep" | "google_drive";
  url?: string;
  apiKey?: string;
  collectionName?: string;
  sessionId?: string;
}

export async function getBackend(userId: number): Promise<MemoryBackendConfig | null> {
  const [backend] = await db
    .select()
    .from(memoryBackends)
    .where(eq(memoryBackends.userId, userId))
    .limit(1);

  if (!backend || !backend.active) return null;

  try {
    const config = JSON.parse(decryptConfig(backend.config));
    return { type: backend.type as MemoryBackendConfig["type"], ...config };
  } catch {
    return null;
  }
}

export async function setBackend(
  userId: number,
  type: string,
  config: Record<string, unknown>
): Promise<void> {
  const encrypted = encryptConfig(JSON.stringify(config));

  await db
    .insert(memoryBackends)
    .values({ id: crypto.randomUUID(), userId, type, config: encrypted, active: true })
    .onConflictDoUpdate({
      target: memoryBackends.userId,
      set: { type, config: encrypted, active: true },
    });
}

export async function removeBackend(userId: number): Promise<void> {
  await db.delete(memoryBackends).where(eq(memoryBackends.userId, userId));
}

// Routed store: dispatches to correct backend
export async function routedStoreChunk(
  userId: number,
  kbId: string | undefined,
  content: string,
  chunkIndex: number,
  sourceName?: string,
  sourceUrl?: string
): Promise<string> {
  const backend = await getBackend(userId);

  // Default: local pgvector
  if (!backend || backend.type === "local") {
    return storeChunk(userId, kbId || null, content, chunkIndex, sourceName, sourceUrl);
  }

  if (backend.type === "qdrant") {
    try {
      const { QdrantClient } = await import("@qdrant/js-client-rest");
      const client = new QdrantClient({
        url: backend.url || "http://localhost:6333",
        apiKey: backend.apiKey,
      });

      const vector = await embed(content);
      const id = crypto.randomUUID();
      const collection = backend.collectionName || `user_${userId}`;

      await client.upsert(collection, {
        points: [
          {
            id,
            vector,
            payload: { content, userId, kbId, sourceName, sourceUrl, chunkIndex },
          },
        ],
      });

      return id;
    } catch (err) {
      logger.error({ err, userId }, "Qdrant store failed, falling back to local");
      return storeChunk(userId, kbId || null, content, chunkIndex, sourceName, sourceUrl);
    }
  }

  if (backend.type === "getzep") {
    try {
      const { ZepClient } = await import("@getzep/zep-js");
      const client = await (ZepClient as any).init(backend.url || "", backend.apiKey);
      const sessionId = backend.sessionId || `user_${userId}`;

      await client.memory.add(sessionId, [
        { role: "system", content, metadata: { userId, kbId, sourceName, chunkIndex } } as any,
      ]);

      return `zep_${sessionId}_${Date.now()}`;
    } catch (err) {
      logger.error({ err, userId }, "Zep store failed, falling back to local");
      return storeChunk(userId, kbId || null, content, chunkIndex, sourceName, sourceUrl);
    }
  }

  // Fallback
  return storeChunk(userId, kbId || null, content, chunkIndex, sourceName, sourceUrl);
}

// Routed search: dispatches to correct backend
export async function routedSearch(
  userId: number,
  query: string,
  kbId?: string,
  limit: number = 5
): Promise<Array<{ content: string; score: number; source?: string }>> {
  const backend = await getBackend(userId);

  if (!backend || backend.type === "local") {
    const results = await searchSimilar(userId, query, kbId, limit);
    return results.map((r: any) => ({
      content: r.content,
      score: r.similarity || 0,
      source: r.sourceName,
    }));
  }

  if (backend.type === "qdrant") {
    try {
      const { QdrantClient } = await import("@qdrant/js-client-rest");
      const client = new QdrantClient({
        url: backend.url || "http://localhost:6333",
        apiKey: backend.apiKey,
      });

      const vector = await embed(query);
      const collection = backend.collectionName || `user_${userId}`;

      const results = await client.search(collection, {
        vector,
        limit,
        filter: kbId
          ? { must: [{ key: "kbId", match: { value: kbId } }] }
          : undefined,
      });

      return results.map((r: any) => ({
        content: r.payload?.content || "",
        score: r.score,
        source: r.payload?.sourceName,
      }));
    } catch (err) {
      logger.error({ err, userId }, "Qdrant search failed, falling back to local");
      const results = await searchSimilar(userId, query, kbId, limit);
      return results.map((r: any) => ({ content: r.content, score: r.similarity || 0, source: r.sourceName }));
    }
  }

  // Fallback to local
  const results = await searchSimilar(userId, query, kbId, limit);
  return results.map((r: any) => ({ content: r.content, score: r.similarity || 0, source: r.sourceName }));
}
