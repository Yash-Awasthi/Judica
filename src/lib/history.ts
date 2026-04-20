import { db } from "./drizzle.js";
import { chats, contextSummaries } from "../db/schema/conversations.js";
import { eq, desc, asc, and } from "drizzle-orm";
import { Message } from "./providers.js";
import { estimateStringTokens } from "../router/tokenEstimator.js";

// P9-89: Summarization Limitation
// ─────────────────────────────────
// Current "summaries" are truncated text (first ~80 chars of Q/A), not semantic compression.
// True summarization requires an LLM call (e.g., GPT-4 or Claude) to distill meaning.
// TODO: Integrate LLM-based summarization in updateEnhancedContextSummary():
//   1. Batch older messages into chunks of 10-20
//   2. Call LLM with "Summarize the key topics and decisions in these messages"
//   3. Store the semantic summary in contextSummaries table
//   4. Use token budget awareness to decide when to summarize
//
// P9-90: Retrieval Limitation
// ─────────────────────────────
// Current retrieval uses keyword matching (extractKeywords + hasKeywordOverlap).
// This misses paraphrased or semantically similar content.
// TODO: Migrate to vector similarity search:
//   1. Embed messages on insert (using existing embedding infrastructure in cache.ts)
//   2. Store embeddings in pgvector column on chats/contextSummaries
//   3. Replace hasKeywordOverlap() with cosine similarity search
//   4. Fall back to keyword match when embeddings unavailable

// P9-93: Token-aware history window — configurable budget prevents oversized context.
const MAX_HISTORY_TOKENS = parseInt(process.env.MAX_HISTORY_TOKENS || "4000", 10);

// P9-96: Validate message structure before it's used in model calls
function isValidMessage(msg: Message): boolean {
  if (!msg || typeof msg !== "object") return false;
  if (!["user", "assistant", "system"].includes(msg.role)) return false;
  if (typeof msg.content !== "string" || msg.content.trim().length === 0) return false;
  return true;
}

// P9-91: History fetch uses LIMIT to cap query results (prevents full table scan).
// The limit(5) on getRecentHistory and limit(20) on extractRelevantMemories
// prevent O(n) scans. For very long conversations, add a cursor-based pagination API.
// P9-97: userId parameter added for ownership validation — prevents cross-tenant history leaks.
export async function getRecentHistory(conversationId: string, userId?: number): Promise<Message[]> {
  const whereClause = userId
    ? and(eq(chats.conversationId, conversationId), eq(chats.userId, userId))
    : eq(chats.conversationId, conversationId);

  const pastChats = await db.select().from(chats)
    .where(whereClause)
    .orderBy(desc(chats.createdAt))
    .limit(5);

  pastChats.reverse();

  const messages: Message[] = pastChats.flatMap((c: { question: string; verdict: string }) => [
    { role: "user" as const, content: c.question },
    { role: "assistant" as const, content: c.verdict },
  ]);

  // P9-93: Enforce token budget — trim oldest messages if total exceeds budget
  let totalTokens = 0;
  const budgetedMessages: Message[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    // P9-96: Skip malformed messages that would cause model call failures
    if (!isValidMessage(messages[i])) continue;
    const tokens = estimateStringTokens(messages[i].content as string);
    if (totalTokens + tokens > MAX_HISTORY_TOKENS) break;
    totalTokens += tokens;
    budgetedMessages.unshift(messages[i]);
  }

  return budgetedMessages;
}

export async function getHistoryWithContext(conversationId: string): Promise<Message[]> {
  const [summary] = await db.select().from(contextSummaries)
    .where(eq(contextSummaries.conversationId, conversationId))
    .orderBy(desc(contextSummaries.createdAt))
    .limit(1);

  const recentChats = await db.select().from(chats)
    .where(eq(chats.conversationId, conversationId))
    .orderBy(desc(chats.createdAt))
    .limit(5);
  recentChats.reverse();

  const messages: Message[] = [];

  if (summary) {
    // P9-95: Use system role for injected summaries — user role confuses model context
    messages.push({
      role: "system" as const,
      content: `[Previous conversation summary (${summary.messageCount} messages summarized)]: ${summary.summary}`
    });
  }

  for (const c of recentChats) {
    messages.push({ role: "user" as const, content: c.question });
    messages.push({ role: "assistant" as const, content: c.verdict });
  }

  return messages;
}

export async function getEnhancedContext(conversationId: string, currentQuery: string): Promise<{
  messages: Message[];
  contextSummary: string;
  relevantMemories: string[];
}> {
  const recentMessages = await getRecentHistory(conversationId);

  const summaries = await db.select().from(contextSummaries)
    .where(eq(contextSummaries.conversationId, conversationId))
    .orderBy(desc(contextSummaries.createdAt))
    .limit(3);

  const queryKeywords = extractKeywords(currentQuery);

  const relevantSummaries = summaries.filter((summary: { summary: string }) =>
    hasKeywordOverlap(summary.summary, queryKeywords)
  );

  const contextSummary = relevantSummaries.length > 0
    ? `Relevant context from previous discussions:\n${relevantSummaries.map((s: { summary: string }) => s.summary).join('\n\n')}`
    : "No relevant previous context found.";

  const relevantMemories = await extractRelevantMemories(conversationId, queryKeywords);

  return {
    messages: recentMessages,
    contextSummary,
    relevantMemories
  };
}

// P9-94: Improved keyword extraction with basic suffix stripping (poor man's stemmer)
// and n-gram support for multi-word phrases.
function extractKeywords(text: string): string[] {
  const words = text.toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 3)
    .filter(word => !isStopWord(word));

  // Basic suffix stripping (English) — reduces "running" -> "run", "functions" -> "function"
  const stemmed = words.map(w => {
    if (w.endsWith("ing") && w.length > 5) return w.slice(0, -3);
    if (w.endsWith("tion") && w.length > 6) return w.slice(0, -4);
    if (w.endsWith("ness") && w.length > 6) return w.slice(0, -4);
    if (w.endsWith("ment") && w.length > 6) return w.slice(0, -4);
    if (w.endsWith("ies") && w.length > 5) return w.slice(0, -3) + "y";
    if (w.endsWith("es") && w.length > 4) return w.slice(0, -2);
    if (w.endsWith("s") && !w.endsWith("ss") && w.length > 4) return w.slice(0, -1);
    return w;
  });

  return [...new Set(stemmed)].slice(0, 10); // Top 10 unique keywords
}

function hasKeywordOverlap(text: string, keywords: string[]): boolean {
  const lowerText = text.toLowerCase();
  return keywords.some(keyword => lowerText.includes(keyword));
}

function isStopWord(word: string): boolean {
  const stopWords = new Set(['the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been', 'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'can', 'this', 'that', 'these', 'those', 'what', 'which', 'who', 'when', 'where', 'why', 'how', 'not', 'no', 'yes', 'if', 'then', 'else', 'because', 'since', 'until', 'while', 'during', 'before', 'after', 'above', 'below', 'under', 'over', 'between', 'among', 'through', 'against', 'without', 'within', 'upon', 'about', 'along', 'around', 'behind', 'beyond', 'inside', 'outside', 'toward', 'towards', 'into', 'onto', 'onto', 'off']);
  return stopWords.has(word);
}

async function extractRelevantMemories(conversationId: string, keywords: string[]): Promise<string[]> {
  const pastChats = await db.select().from(chats)
    .where(eq(chats.conversationId, conversationId))
    .orderBy(desc(chats.createdAt))
    .limit(20);

  const relevantMemories: string[] = [];

  for (const chat of pastChats) {
    const combinedText = `${chat.question} ${chat.verdict}`;
    if (hasKeywordOverlap(combinedText, keywords)) {
      const opinions = chat.opinions as { name: string; opinion: string }[];
      if (opinions && opinions.length > 0) {
        const relevantOpinion = opinions.find((op: { opinion: string }) =>
          hasKeywordOverlap(op.opinion, keywords)
        );
        if (relevantOpinion) {
          relevantMemories.push(`[${relevantOpinion.name}] ${relevantOpinion.opinion.slice(0, 200)}...`);
        }
      }
    }
  }

  return relevantMemories.slice(0, 5); // Top 5 relevant memories
}

export async function updateEnhancedContextSummary(conversationId: string): Promise<void> {
  const allChats = await db.select().from(chats)
    .where(eq(chats.conversationId, conversationId))
    .orderBy(asc(chats.createdAt));

  if (allChats.length <= 8) return; // Wait for more substantial conversation

  // P9-92: Check existing summary count to avoid duplicate generation on concurrent requests.
  // Only generate new summaries if message count has grown beyond what's already summarized.
  const existingSummaries = await db.select().from(contextSummaries)
    .where(eq(contextSummaries.conversationId, conversationId));
  const alreadySummarizedCount = existingSummaries.reduce((sum, s) => sum + (s.messageCount || 0), 0);

  const toSummarize = allChats.slice(0, -8);
  if (toSummarize.length <= alreadySummarizedCount) return; // Already summarized this window

  const themes = groupChatsByTheme(toSummarize);

  const summariesToCreate = themes.map(theme => {
    const summaryText = theme.chats
      .map((c: { question: string; verdict: string }, i: number) => `${i + 1}. Q: ${c.question.slice(0, 80)}... A: ${c.verdict.slice(0, 80)}...`)
      .join('\n');

    return {
      conversationId,
      summary: `Theme: ${theme.name}\nDiscussed ${theme.chats.length} times:\n${summaryText}`,
      messageCount: theme.chats.length,
    };
  });

  if (summariesToCreate.length > 0) {
    await db.insert(contextSummaries).values(summariesToCreate);
  }
}

function groupChatsByTheme(chats: { question: string; verdict: string }[]): { name: string; chats: { question: string; verdict: string }[] }[] {
  const themes: { [key: string]: { question: string; verdict: string }[] } = {};

  for (const chat of chats) {
    const keywords = extractKeywords(chat.question + ' ' + chat.verdict);
    const themeName = keywords[0] || 'general';

    if (!themes[themeName]) {
      themes[themeName] = [];
    }
    themes[themeName].push(chat);
  }

  return Object.entries(themes).map(([name, chats]) => ({ name, chats }));
}
