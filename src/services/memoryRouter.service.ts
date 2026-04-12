import prisma from "../lib/db.js";
import { storeChunk, searchSimilar } from "./vectorStore.service.js";
import { embed } from "./embeddings.service.js";
import logger from "../lib/logger.js";
import crypto from "crypto";

// AES-256-GCM encryption for config storage
const ENCRYPTION_KEY = process.env.MEMORY_ENCRYPTION_KEY || crypto.randomBytes(32).toString("hex");
const KEY_BUFFER = Buffer.from(ENCRYPTION_KEY.substring(0, 64), "hex");

export function encryptConfig(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", KEY_BUFFER, iv);
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const tag = cipher.getAuthTag().toString("hex");
  return `${iv.toString("hex")}:${tag}:${encrypted}`;
}

export function decryptConfig(ciphertext: string): string {
  const [ivHex, tagHex, encrypted] = ciphertext.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const decipher = crypto.createDecipheriv("aes-256-gcm", KEY_BUFFER, iv);
  decipher.setAuthTag(tag);
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

export interface MemoryBackendConfig {
  type: "local" | "qdrant" | "getzep" | "google_drive";
  url?: string;
  apiKey?: string;
  collectionName?: string;
  sessionId?: string;
}

export async function getBackend(userId: number): Promise<MemoryBackendConfig | null> {
  const backend = await prisma.memoryBackend.findUnique({
    where: { userId },
  });

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

  await prisma.memoryBackend.upsert({
    where: { userId },
    create: { userId, type, config: encrypted, active: true },
    update: { type, config: encrypted, active: true },
  });
}

export async function removeBackend(userId: number): Promise<void> {
  await prisma.memoryBackend.deleteMany({ where: { userId } });
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
