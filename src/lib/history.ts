import prisma from "./db.js";
import { Message } from "./providers.js";

export async function getRecentHistory(conversationId: string): Promise<Message[]> {
  const pastChats = await prisma.chat.findMany({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  pastChats.reverse();

  const messages: Message[] = pastChats.flatMap((c: { question: string; verdict: string }) => [
    { role: "user" as const, content: c.question },
    { role: "assistant" as const, content: c.verdict },
  ]);

  return messages;
}

export async function getHistoryWithContext(conversationId: string): Promise<Message[]> {
  const summary = await prisma.contextSummary.findFirst({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
  });

  const recentChats = await prisma.chat.findMany({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  recentChats.reverse();

  const messages: Message[] = [];

  if (summary) {
    messages.push({
      role: "user" as const,
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

  const summaries = await prisma.contextSummary.findMany({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
    take: 3,
  });

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

function extractKeywords(text: string): string[] {
  const words = text.toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 3)
    .filter(word => !isStopWord(word));

  return [...new Set(words)].slice(0, 10); // Top 10 unique keywords
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
  const pastChats = await prisma.chat.findMany({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
    take: 20, // Look at last 20 exchanges
  });

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
  const allChats = await prisma.chat.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
  });

  if (allChats.length <= 8) return; // Wait for more substantial conversation

  const toSummarize = allChats.slice(0, -8);

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
    await prisma.contextSummary.createMany({
      data: summariesToCreate,
    });
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
