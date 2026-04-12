import prisma from "../lib/db.js";
import { pool } from "../lib/db.js";
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
    const conversation = await prisma.conversation.create({
      data: {
        userId: input.userId,
        title: input.title,
        isPublic: input.isPublic ?? false,
      } as any
    });
    return conversation;
  } catch (err) {
    logger.error({ err, input }, "Failed to create conversation");
    throw err;
  }
}

export async function findConversationById(id: string, userId?: number): Promise<Conversation | null> {
  try {
    const conversation = await prisma.conversation.findFirst({
      where: { 
        id,
        ...(userId && { userId })
      }
    });
    return conversation;
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
      const result = await pool.query(`
        INSERT INTO "Chat" ("userId", "conversationId", question, verdict, opinions, "durationMs", "tokensUsed", "cacheHit", embedding, "createdAt")
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::vector, NOW())
        RETURNING *
      `, [
        input.userId ?? null,
        input.conversationId ?? null,
        input.question,
        input.verdict,
        JSON.stringify(input.opinions),
        input.durationMs ?? null,
        input.tokensUsed ?? null,
        input.cacheHit ?? false,
        `[${embeddingVector.join(',')}]`
      ]);
      
      return result.rows[0] as Chat;
    }
    
    const chat = await prisma.chat.create({
      data: {
        userId: input.userId,
        conversationId: input.conversationId,
        question: input.question,
        verdict: input.verdict,
        opinions: input.opinions,
        durationMs: input.durationMs,
        tokensUsed: input.tokensUsed,
        cacheHit: input.cacheHit ?? false,
      }
    });
    return chat;
  } catch (err) {
    logger.error({ err, input }, "Failed to create chat");
    throw err;
  }
}

export async function getRecentHistory(conversationId: string): Promise<Message[]> {
  try {
    const chats = await prisma.chat.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      take: 20 // Limit to prevent context overflow
    });

    const messages: Message[] = [];
    for (const chat of chats) {
      messages.push({ role: "user", content: chat.question });
      messages.push({ role: "assistant", content: chat.verdict });
    }
    return messages;
  } catch (err) {
    logger.error({ err, conversationId }, "Failed to get conversation history");
    throw err;
  }
}

export async function getConversationList(userId: number, limit: number = 50): Promise<Conversation[]> {
  try {
    const conversations = await prisma.conversation.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      take: limit
    });
    return conversations;
  } catch (err) {
    logger.error({ err, userId }, "Failed to get conversation list");
    throw err;
  }
}

export async function deleteConversation(id: string, userId: number): Promise<boolean> {
  try {
    const result = await prisma.conversation.deleteMany({
      where: { 
        id,
        userId // Ensure user can only delete their own conversations
      }
    });
    return result.count > 0;
  } catch (err) {
    logger.error({ err, id, userId }, "Failed to delete conversation");
    throw err;
  }
}

export async function updateConversationTitle(id: string, userId: number, title: string): Promise<Conversation | null> {
  try {
    const conversation = await prisma.conversation.updateMany({
      where: { 
        id,
        userId
      },
      data: { title }
    });
    
    if (conversation.count === 0) {
      return null;
    }
    
    return findConversationById(id, userId);
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
        const result = await pool.query(`
          SELECT id, question, verdict, 
                 embedding <-> $1 as distance
          FROM "Chat"
          WHERE "conversationId" = $2 
            AND embedding IS NOT NULL
          ORDER BY embedding <-> $1
          LIMIT $3
        `, [
          `[${queryEmbedding.join(',')}]`,
          conversationId,
          maxResults
        ]);

        if (result.rows.length > 0) {
          const contexts: RelevantContext[] = result.rows.map((row: any) => ({
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
    
    const chats = await prisma.chat.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take: 50
    });

    if (chats.length === 0) {
      return [];
    }

    const scored: RelevantContext[] = chats.map((chat: Chat) => ({
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
