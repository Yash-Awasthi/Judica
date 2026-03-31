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
  const messages: Message[] = pastChats.flatMap((c: any) => [
    { role: "user" as const, content: c.question },
    { role: "assistant" as const, content: c.verdict },
  ]);

  return messages;
}
