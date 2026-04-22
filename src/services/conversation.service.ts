import { db } from "../lib/drizzle.js";
import { conversations, chats } from "../db/schema/conversations.js";
import { eq, and, desc, asc, sql, or, ilike } from "drizzle-orm";
import { askProvider, type Provider } from "../lib/providers.js";
import type { Message } from "../lib/providers.js";
import { selectProvider, FREE_TIER_CHAIN } from "../router/providerChain.js";
import logger from "../lib/logger.js";
import { getEmbeddingWithLock } from "../lib/cache.js";
import { AppError } from "../middleware/errorHandler.js";
import { safeVectorLiteral } from "./vectorStore.service.js";

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
  opinions: Record<string, unknown>;
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
  opinions: Record<string, unknown>;
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
        userId: input.userId!,
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
      const vectorStr = safeVectorLiteral(embeddingVector);
      const result = await db.execute(sql`
        INSERT INTO "Chat" ("userId", "conversationId", question, verdict, opinions, "durationMs", "tokensUsed", "cacheHit", embedding, "createdAt")
        VALUES (${input.userId ?? null}, ${input.conversationId ?? null}, ${input.question}, ${input.verdict}, ${JSON.stringify(input.opinions)}::jsonb, ${input.durationMs ?? null}, ${input.tokensUsed ?? null}, ${input.cacheHit ?? false}, ${vectorStr}::vector, NOW())
        RETURNING *
      `);

      return (result as unknown as { rows: Chat[] }).rows[0] as Chat;
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

// R4-05: Accept optional userId so callers can scope history to the authenticated user.
// lib/history.ts has the same function with optional userId — keep both in sync.
export async function getRecentHistory(conversationId: string, userId?: number): Promise<Message[]> {
  try {
    const whereClause = userId
      ? and(eq(chats.conversationId, conversationId), eq(chats.userId, userId))
      : eq(chats.conversationId, conversationId);

    const result = await db
      .select()
      .from(chats)
      .where(whereClause)
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

export async function getConversationList(userId: number, limit: number = 50, offset: number = 0, filters?: { projectId?: string; after?: Date; before?: Date }): Promise<{ data: Conversation[]; total: number }> {
  try {
    const whereConditions = [eq(conversations.userId, userId)];
    if (filters?.projectId) whereConditions.push(eq(conversations.projectId, filters.projectId));
    if (filters?.after) whereConditions.push(sql`${conversations.updatedAt} >= ${filters.after}`);
    if (filters?.before) whereConditions.push(sql`${conversations.updatedAt} <= ${filters.before}`);

    const [data, totalResult] = await Promise.all([
      db.select()
        .from(conversations)
        .where(and(...whereConditions))
        .orderBy(desc(conversations.updatedAt))
        .offset(offset)
        .limit(limit),
      db.select({ count: sql<number>`count(*)` })
        .from(conversations)
        .where(and(...whereConditions))
    ]);

    const total = Number(totalResult[0]?.count ?? 0);
    return { data: data as Conversation[], total };
  } catch (err) {
    logger.error({ err, userId }, "Failed to get conversation list");
    throw err;
  }
}

export async function searchChats(userId: number, q: string, limit: number = 10, filters?: { projectId?: string; after?: Date; before?: Date }): Promise<Chat[]> {
  try {
    // P41-09: Cap search term to prevent oversized LIKE queries
    const searchTerm = q.trim().slice(0, 1000);
    const escapedTerm = searchTerm
      .replace(/\\/g, "\\\\")
      .replace(/%/g, "\\%")
      .replace(/_/g, "\\_");

    const whereConditions = [
      eq(chats.userId, userId),
      or(
        ilike(chats.question, `%${escapedTerm}%`),
        ilike(chats.verdict, `%${escapedTerm}%`)
      )
    ];

    if (filters?.after) whereConditions.push(sql`${chats.createdAt} >= ${filters.after}`);
    if (filters?.before) whereConditions.push(sql`${chats.createdAt} <= ${filters.before}`);

    const results = await db
      .select({
        id: chats.id,
        conversationId: chats.conversationId,
        question: chats.question,
        verdict: chats.verdict,
        createdAt: chats.createdAt,
      })
      .from(chats)
      .where(and(...whereConditions))
      .orderBy(desc(chats.createdAt))
      .limit(limit);

    return results as unknown as Chat[];
  } catch (err) {
    logger.error({ err, userId, q }, "Failed to search chats");
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
        const vectorStr = safeVectorLiteral(queryEmbedding);
        const result = await db.execute(sql`
          SELECT id, question, verdict,
                 embedding <-> ${vectorStr}::vector as distance
          FROM "Chat"
          WHERE "conversationId" = ${conversationId}
            AND embedding IS NOT NULL
          ORDER BY embedding <-> ${vectorStr}::vector
          LIMIT ${maxResults}
        `);

        const rows = (result as unknown as { rows: Array<{ question: string; verdict: string; distance?: number }> }).rows;
        if (rows && rows.length > 0) {
          const contexts: RelevantContext[] = rows.map((row) => ({
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

export async function generateConversationSummary(conversationId: string, userId: number) {
  try {
    const history = await getRecentHistory(conversationId, userId); // R4-05: pass userId for ownership scoping
    if (history.length === 0) {
      throw new AppError(400, "No history found to summarize");
    }

    const prompt = `You are a professional executive assistant. Summarize the following AI council deliberation into a structured JSON format.
Focus on:
1. Key Decisions: Major conclusions or consensus points reached.
2. Action Items: Specific tasks or steps identified.
3. Follow-Ups: Questions that remain or areas needing further research.

Conversation History:
${history.map(m => `${m.role.toUpperCase()}: ${m.content}`).join("\n")}

Respond ONLY with a JSON object in this format:
{
  "keyDecisions": ["string"],
  "actionItems": ["string"],
  "followUps": ["string"]
}`;

    // Use the smart router to select the best available provider
    const selected = selectProvider(2000, FREE_TIER_CHAIN);
    if (!selected) {
      throw new AppError(503, "No AI provider available for summary generation");
    }

    const providerConfig = {
      type: selected.provider,
      model: selected.model,
      apiKey: "", // Adapter handles credentials
      name: "Internal Summarizer",
    };

    const response = await askProvider(providerConfig as Provider, prompt);
    const content = response.text;

    // P41-08: Use non-greedy regex to avoid ReDoS on large AI responses
    const jsonMatch = content.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) {
      throw new Error("Failed to extract JSON from AI response");
    }

    const summaryData = JSON.parse(jsonMatch[0]);
    summaryData.lastUpdated = new Date().toISOString();

    const [updated] = await db
      .update(conversations)
      .set({ summaryData })
      .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)))
      .returning();

    return updated.summaryData;
  } catch (err) {
    logger.error({ err, conversationId }, "Failed to generate conversation summary");
    throw err;
  }
}
