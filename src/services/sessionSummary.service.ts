import prisma from "../lib/db.js";
import { routeAndCollect } from "../router/index.js";
import logger from "../lib/logger.js";

export async function summarizeSession(
  conversationId: string,
  userId: number
): Promise<string> {
  // Get last 20 messages
  const messages = await (prisma as any).message.findMany({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { role: true, content: true },
  });

  if (messages.length < 5) return "";

  const transcript = messages
    .reverse()
    .map((m: any) => `${m.role}: ${typeof m.content === "string" ? m.content.substring(0, 500) : JSON.stringify(m.content).substring(0, 500)}`)
    .join("\n");

  const result = await routeAndCollect({
    model: "auto",
    messages: [
      {
        role: "user",
        content: `Summarize this conversation into 3-5 bullet points capturing key decisions, facts, and conclusions. Be concise.\n\nConversation:\n${transcript}`,
      },
    ],
    temperature: 0,
  });

  const summary = result.text;

  // Store summary in conversation
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { sessionSummary: summary },
  });

  logger.info({ conversationId }, "Session summary generated");
  return summary;
}

export async function autoSummarize(conversationId: string, userId: number): Promise<void> {
  const count = await (prisma as any).message.count({ where: { conversationId } });

  if (count > 30) {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { sessionSummary: true, updatedAt: true },
    });

    // Only summarize if no summary or summary is older than 1 hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    if (!conversation?.sessionSummary || conversation.updatedAt < oneHourAgo) {
      await summarizeSession(conversationId, userId);
    }
  }
}

export function buildLayeredContext(
  sessionSummary: string | null,
  recentMessages: Array<{ role: string; content: string }>,
  ragChunks: string[]
): string {
  const parts: string[] = [];

  // Layer 1: Session summary (compressed older context)
  if (sessionSummary) {
    parts.push(`[SESSION SUMMARY]\n${sessionSummary}\n[/SESSION SUMMARY]`);
  }

  // Layer 2: Recent messages are handled by the caller (they go as message array)
  // This function just provides the context preamble

  // Layer 3: Retrieved memory chunks
  if (ragChunks.length > 0) {
    parts.push(`[RETRIEVED MEMORY]\n${ragChunks.join("\n\n")}\n[/RETRIEVED MEMORY]`);
  }

  return parts.join("\n\n");
}
