import { db } from "../lib/drizzle.js";
import { conversations, chats } from "../db/schema/conversations.js";
import { eq, and, desc, asc, sql } from "drizzle-orm";
import { Message } from "../lib/providers.js";
import logger from "../lib/logger.js";
import { getEmbeddingWithLock } from "../lib/cache.js";

export interface Conversation {
  id: string;
  userId?: number | null;
  title: string;
  isPublic: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Chat {
  id: number;
  userId?: number | null;
  conversationId?: string | null;
  question: string;
  verdict: string;
  opinions: any;
  durationMs?: number | null;
  tokensUsed?: number | null;
  cacheHit: boolean;
  createdAt: Date;
}

export interface CreateConversationInput {
  userId?: number;
  title: string;
  isPublic?: boolean;
}

export interface CreateChatInput {
  userId?: number;
  conversationId?: string;
  question: string;
  verdict: string;
  opinions: any;
  durationMs?: number;
  tokensUsed?: number;
  cacheHit?: boolean;
}

export interface RelevantContext {
  question: string;
  verdict: string;
  relevance: number;
}

export async function createConversation(input: CreateConversationInput): Promise<Conversation> {
  try {
    const now = new Date();
    const [conversation] = await db
      .insert(conversations)
      .values({
        id: crypto.randomUUID(),
        userId: input.userId,
        title: input.title,
        isPublic: input.isPublic ?? false,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return conversation as Conversation;
  } catch (err) {
    logger.error({ err, input }, "Failed to create conversation");
    throw err;
  }
}

export async function findConversationById(id: string, userId?: number): Promise<Conversation | null> {
  try {
    const conditions = userId
      ? and(eq(conversations.id, id), eq(conversations.userId, userId))
      : eq(conversations.id, id);

    const [conversation] = await db
      .select()
      .from(conversations)
      .where(conditions)
      .limit(1);

    return (conversation as Conversation) ?? null;
  } catch (err) {
    logger.error({ err, id, userId }, "Failed to find conversation");
    throw err;
  }
}

export async function createChat(input: CreateChatInput, generateEmbedding: boolean = false): Promise<Chat> {
  try {
    let embeddingVector: number[] | null = null;

    if (generateEmbedding) {
      const chatText = `${input.question} ${input.verdict}`.slice(0, 1000);
      embeddingVector = await getEmbeddingWithLock(chatText);
    }

    if (embeddingVector) {
      const vectorStr = `[${embeddingVector.join(',')}]`;
      const result = await db.execute(sql`
        INSERT INTO "Chat" ("userId", "conversationId", question, verdict, opinions, "durationMs", "tokensUsed", "cacheHit", embedding, "createdAt")
        VALUES (${input.userId ?? null}, ${input.conversationId ?? null}, ${input.question}, ${input.verdict}, ${JSON.stringify(input.opinions)}::jsonb, ${input.durationMs ?? null}, ${input.tokensUsed ?? null}, ${input.cacheHit ?? false}, ${vectorStr}::vector, NOW())
        RETURNING *
      `);

      return (result as any).rows[0] as Chat;
    }

    const [chat] = await db
      .insert(chats)
      .values({
        userId: input.userId,
        conversationId: input.conversationId,
        question: input.question,
        verdict: input.verdict,
        opinions: input.opinions,
        durationMs: input.durationMs,
        tokensUsed: input.tokensUsed,
        cacheHit: input.cacheHit ?? false,
      })
      .returning();
    return chat as Chat;
  } catch (err) {
    logger.error({ err, input }, "Failed to create chat");
    throw err;
  }
}

export async function getRecentHistory(conversationId: string): Promise<Message[]> {
  try {
    const result = await db
      .select()
      .from(chats)
      .where(eq(chats.conversationId, conversationId))
      .orderBy(asc(chats.createdAt))
      .limit(20);

    const messages: Message[] = [];
    for (const chat of result) {
      messages.push({ role: "user", content: chat.question });
      messages.push({ role: "assistant", content: chat.verdict });
    }
    return messages;
  } catch (err) {
    logger.error({ err, conversationId }, "Failed to get conversation history");
    throw err;
  }
}

export async function getConversationList(userId: number, limit: number = 50, offset: number = 0): Promise<Conversation[]> {
  try {
    const result = await db
      .select()
      .from(conversations)
      .where(eq(conversations.userId, userId))
      .orderBy(desc(conversations.updatedAt))
      .offset(offset)
      .limit(limit);
    return result as Conversation[];
  } catch (err) {
    logger.error({ err, userId }, "Failed to get conversation list");
    throw err;
  }
}

export async function deleteConversation(id: string, userId: number): Promise<boolean> {
  try {
    const result = await db
      .delete(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.userId, userId)))
      .returning({ id: conversations.id });
    return result.length > 0;
  } catch (err) {
    logger.error({ err, id, userId }, "Failed to delete conversation");
    throw err;
  }
}

export async function updateConversationTitle(id: string, userId: number, title: string): Promise<Conversation | null> {
  try {
    const result = await db
      .update(conversations)
      .set({ title })
      .where(and(eq(conversations.id, id), eq(conversations.userId, userId)))
      .returning();

    if (result.length === 0) {
      return null;
    }

    return result[0] as Conversation;
  } catch (err) {
    logger.error({ err, id, userId, title }, "Failed to update conversation title");
    throw err;
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) return 0;

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

function extractKeywords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter(w => w.length > 3)
  );
}

function calculateKeywordRelevance(query: string, question: string, verdict: string): number {
  const queryKeywords = extractKeywords(query);
  const contentKeywords = extractKeywords(question + " " + verdict);

  if (queryKeywords.size === 0) return 0;

  let matches = 0;
  for (const kw of queryKeywords) {
    if (contentKeywords.has(kw)) matches++;
  }

  return matches / queryKeywords.size;
}

export async function retrieveRelevantContext(
  conversationId: string,
  query: string,
  maxResults: number = 3
): Promise<RelevantContext[]> {
  try {
    const queryEmbedding = await getEmbeddingWithLock(query);

    if (queryEmbedding) {
      try {
        const vectorStr = `[${queryEmbedding.join(',')}]`;
        const result = await db.execute(sql`
          SELECT id, question, verdict,
                 embedding <-> ${vectorStr}::vector as distance
          FROM "Chat"
          WHERE "conversationId" = ${conversationId}
            AND embedding IS NOT NULL
          ORDER BY embedding <-> ${vectorStr}::vector
          LIMIT ${maxResults}
        `);

        const rows = (result as any).rows;
        if (rows && rows.length > 0) {
          const contexts: RelevantContext[] = rows.map((row: any) => ({
            question: row.question,
            verdict: row.verdict,
            relevance: Math.max(0, 1 - (row.distance || 0)) // Convert distance to similarity
          }));

          logger.debug({
            conversationId,
            query: query.slice(0, 50),
            found: contexts.length,
            method: "semantic-db"
          }, "Retrieved relevant context (DB vector search)");

          return contexts;
        }
      } catch (dbErr) {
        logger.warn({ err: dbErr }, "DB vector search failed, falling back");
      }
    }

    const chatResults = await db
      .select()
      .from(chats)
      .where(eq(chats.conversationId, conversationId))
      .orderBy(desc(chats.createdAt))
      .limit(50);

    if (chatResults.length === 0) {
      return [];
    }

    const scored: RelevantContext[] = chatResults.map((chat) => ({
      question: chat.question,
      verdict: chat.verdict,
      relevance: calculateKeywordRelevance(query, chat.question, chat.verdict)
    }));

    const topResults = scored
      .filter((r: RelevantContext) => r.relevance > 0.1)
      .sort((a: RelevantContext, b: RelevantContext) => b.relevance - a.relevance)
      .slice(0, maxResults);

    logger.debug({
      conversationId,
      query: query.slice(0, 50),
      found: topResults.length,
      method: "keyword"
    }, "Retrieved relevant context (keyword fallback)");

    return topResults;
  } catch (err) {
    logger.error({ err, conversationId }, "Failed to retrieve relevant context");
    return [];
  }
}

export function formatContextForInjection(context: RelevantContext[]): string {
  if (context.length === 0) {
    return "";
  }

  const MAX_CONTEXT_LENGTH = 1500; // Token-safe limit

  const formatted = context
    .map((c, i) => {
      const item = `- Past Q${i + 1}: ${c.question.slice(0, 200)}\n  A: ${c.verdict.slice(0, 300)}`;
      return item;
    })
    .join("\n\n");

  if (formatted.length > MAX_CONTEXT_LENGTH) {
    return formatted.slice(0, MAX_CONTEXT_LENGTH) + "\n... [truncated]";
  }

  return `Relevant past context:\n${formatted}\n\n---\n\n`;
}
