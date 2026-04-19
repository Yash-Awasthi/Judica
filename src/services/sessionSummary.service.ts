import { db } from "../lib/drizzle.js";
import { conversations, chats } from "../db/schema/conversations.js";
import { eq, desc, count } from "drizzle-orm";
import { routeAndCollect } from "../router/index.js";
import logger from "../lib/logger.js";

export async function summarizeSession(
  conversationId: string,
  _userId: number
): Promise<string> {
  // Get last 20 messages (chats)
  const messages = await db
    .select({ question: chats.question, verdict: chats.verdict })
    .from(chats)
    .where(eq(chats.conversationId, conversationId))
    .orderBy(desc(chats.createdAt))
    .limit(20);

  if (messages.length < 5) return "";

  const transcript = messages
    .reverse()
    .map((m) => `user: ${m.question.substring(0, 500)}\nassistant: ${m.verdict.substring(0, 500)}`)
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
  await db
    .update(conversations)
    .set({ sessionSummary: summary })
    .where(eq(conversations.id, conversationId));

  logger.info({ conversationId }, "Session summary generated");
  return summary;
}

export async function autoSummarize(conversationId: string, userId: number): Promise<void> {
  const [result] = await db
    .select({ value: count() })
    .from(chats)
    .where(eq(chats.conversationId, conversationId));

  const chatCount = result?.value ?? 0;

  if (chatCount > 30) {
    const [conversation] = await db
      .select({ sessionSummary: conversations.sessionSummary, updatedAt: conversations.updatedAt })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .limit(1);

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
