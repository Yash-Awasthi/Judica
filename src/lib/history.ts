import prisma from "./db.js";
import { Message } from "./providers.js";

/**
 * Standardized utility to fetch and window conversation history.
 * Preserves the last 10 messages (5 deliberation rounds) for context safety.
 */
export async function getRecentHistory(conversationId: string): Promise<Message[]> {
  const pastChats = await prisma.chat.findMany({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  pastChats.reverse();

  // Each Chat record stores a User question and an Assistant verdict.
  // We map these to the standard Message format for LLM context.
  const messages: Message[] = pastChats.flatMap((c: { question: string; verdict: string }) => [
    { role: "user" as const, content: c.question },
    { role: "assistant" as const, content: c.verdict },
  ]);

  return messages;
}

/**
 * Fetch conversation history with context summary for long-term memory.
 * Includes a summarized version of older messages if available.
 */
export async function getHistoryWithContext(conversationId: string): Promise<Message[]> {
  // Get the latest context summary
  const summary = await prisma.contextSummary.findFirst({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
  });

  // Get recent messages (last 5 chats = 10 messages)
  const recentChats = await prisma.chat.findMany({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  recentChats.reverse();

  const messages: Message[] = [];

  // Prepend summary as system context if available
  if (summary) {
    messages.push({
      role: "user" as const,
      content: `[Previous conversation summary (${summary.messageCount} messages summarized)]: ${summary.summary}`
    });
  }

  // Add recent messages
  for (const c of recentChats) {
    messages.push({ role: "user" as const, content: c.question });
    messages.push({ role: "assistant" as const, content: c.verdict });
  }

  return messages;
}

/**
 * Enhanced memory system with semantic context and long-term memory.
 * Implements stateful multi-turn interaction with smart context management.
 */
export async function getEnhancedContext(conversationId: string, currentQuery: string): Promise<{
  messages: Message[];
  contextSummary: string;
  relevantMemories: string[];
}> {
  // Get recent messages for immediate context
  const recentMessages = await getRecentHistory(conversationId);
  
  // Get context summaries
  const summaries = await prisma.contextSummary.findMany({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
    take: 3,
  });
  
  // Extract key themes and entities from current query
  const queryKeywords = extractKeywords(currentQuery);
  
  // Find relevant past summaries based on keyword overlap
  const relevantSummaries = summaries.filter((summary: { summary: string }) => 
    hasKeywordOverlap(summary.summary, queryKeywords)
  );
  
  // Build context summary
  const contextSummary = relevantSummaries.length > 0
    ? `Relevant context from previous discussions:\n${relevantSummaries.map((s: { summary: string }) => s.summary).join('\n\n')}`
    : "No relevant previous context found.";
  
  // Extract relevant memories (opinions, verdicts) related to current query
  const relevantMemories = await extractRelevantMemories(conversationId, queryKeywords);
  
  return {
    messages: recentMessages,
    contextSummary,
    relevantMemories
  };
}

/**
 * Extract keywords from text for semantic matching.
 */
function extractKeywords(text: string): string[] {
  const words = text.toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 3)
    .filter(word => !isStopWord(word));
  
  return [...new Set(words)].slice(0, 10); // Top 10 unique keywords
}

/**
 * Check if text contains any of the keywords.
 */
function hasKeywordOverlap(text: string, keywords: string[]): boolean {
  const lowerText = text.toLowerCase();
  return keywords.some(keyword => lowerText.includes(keyword));
}

/**
 * Basic stop word list for keyword filtering.
 */
function isStopWord(word: string): boolean {
  const stopWords = new Set(['the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been', 'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'can', 'this', 'that', 'these', 'those', 'what', 'which', 'who', 'when', 'where', 'why', 'how', 'not', 'no', 'yes', 'if', 'then', 'else', 'because', 'since', 'until', 'while', 'during', 'before', 'after', 'above', 'below', 'under', 'over', 'between', 'among', 'through', 'against', 'without', 'within', 'upon', 'about', 'along', 'around', 'behind', 'beyond', 'inside', 'outside', 'toward', 'towards', 'into', 'onto', 'onto', 'off']);
  return stopWords.has(word);
}

/**
 * Extract relevant memories from past conversations.
 */
async function extractRelevantMemories(conversationId: string, keywords: string[]): Promise<string[]> {
  const pastChats = await prisma.chat.findMany({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
    take: 20, // Look at last 20 exchanges
  });
  
  const relevantMemories: string[] = [];
  
  for (const chat of pastChats) {
    const combinedText = `${chat.question} ${chat.verdict}`;
    if (hasKeywordOverlap(combinedText, keywords)) {
      // Extract the most relevant opinion from this chat
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

/**
 * Update context summary with intelligent chunking.
 */
export async function updateEnhancedContextSummary(conversationId: string): Promise<void> {
  const allChats = await prisma.chat.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
  });

  if (allChats.length <= 8) return; // Wait for more substantial conversation

  // Keep last 8 chats in immediate memory, summarize the rest
  const toSummarize = allChats.slice(0, -8);
  
  // Group by themes/topics for better organization
  const themes = groupChatsByTheme(toSummarize);
  
  // Prepare all summaries for batch insertion
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
  
  // Batch insert all summaries at once
  if (summariesToCreate.length > 0) {
    await prisma.contextSummary.createMany({
      data: summariesToCreate,
    });
  }
}

/**
 * Group chats by thematic similarity.
 */
function groupChatsByTheme(chats: { question: string; verdict: string }[]): { name: string; chats: { question: string; verdict: string }[] }[] {
  // Simple theme grouping based on keyword clustering
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
