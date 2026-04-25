/**
 * Session Naming — auto-generate concise names for chat sessions.
 *
 * Modeled after Onyx secondary_llm_flows/chat_session_naming.py.
 * Uses a lightweight LLM call to produce a 3-6 word title from the
 * first few messages of a conversation.
 */

import { routeAndCollect } from "../../router/smartRouter.js";
import type { AdapterMessage } from "../../adapters/types.js";
import logger from "../logger.js";

const NAMING_PROMPT = `Generate a concise title (3-6 words) for this conversation based on the messages below.
The title should capture the main topic or intent.
Return ONLY the title text, nothing else. No quotes, no punctuation at the end.`;

/**
 * Generate a session name from the first few messages.
 * Runs as a fire-and-forget secondary flow alongside the main response.
 */
export async function generateSessionName(
  messages: AdapterMessage[],
  options: { model?: string } = {},
): Promise<string> {
  // Use first 3-5 messages for naming (skip system messages)
  const relevant = messages
    .filter((m) => m.role !== "system")
    .slice(0, 5);

  if (relevant.length === 0) {
    return "New Conversation";
  }

  const formatted = relevant
    .map((m) => {
      const content = typeof m.content === "string"
        ? m.content
        : (m.content ?? []).map((b) => b.text || "").join("");
      return `${m.role}: ${content.slice(0, 200)}`;
    })
    .join("\n");

  try {
    const result = await routeAndCollect(
      {
        model: options.model ?? "auto",
        messages: [
          { role: "system", content: NAMING_PROMPT },
          { role: "user", content: formatted },
        ],
        max_tokens: 30,
        temperature: 0.5,
      },
      { tags: ["fast", "cheap"] },
    );

    const name = result.text.trim().replace(/^["']|["']$/g, "").slice(0, 80);
    return name || "New Conversation";
  } catch (err) {
    logger.warn({ err }, "Session naming failed");
    return "New Conversation";
  }
}
