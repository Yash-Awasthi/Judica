/**
 * Memory Update — LLM-driven decision on whether to update persistent memory.
 *
 * Modeled after Onyx secondary_llm_flows/memory_update.py.
 * Analyzes conversation to decide: add new memory, update existing, or skip.
 */

import { routeAndCollect } from "../../router/smartRouter.js";
import type { AdapterMessage } from "../../adapters/types.js";
import logger from "../logger.js";

export interface MemoryOperation {
  /** What to do with the memory. */
  action: "add" | "update" | "skip";
  /** Memory ID to update (only for "update" action). */
  memoryId?: string;
  /** Memory text to store (for "add" or "update"). */
  memoryText?: string;
  /** Why this operation was chosen. */
  reasoning: string;
}

const MEMORY_PROMPT = `Analyze this conversation and decide if any important information should be saved to long-term memory.

Existing memories:
{existing_memories}

Current conversation:
{conversation}

Decide ONE of:
1. "add" — new important information not in existing memories
2. "update" — existing memory needs correction/expansion (provide memory_id)
3. "skip" — nothing worth remembering

Only save information that would be useful in future conversations:
- User preferences, goals, or background
- Important decisions or conclusions
- Technical context or project details
- Recurring topics or patterns

Do NOT save:
- Transient small talk
- Information already in existing memories
- Task-specific details that won't matter later

Return JSON:
{
  "action": "add" | "update" | "skip",
  "memory_id": "only for update",
  "memory_text": "concise memory to store",
  "reasoning": "why this decision"
}`;

/**
 * Decide whether to update persistent memory based on conversation content.
 */
export async function decideMemoryOperation(
  messages: AdapterMessage[],
  existingMemories: Array<{ id: string; content: string }>,
  options: { model?: string } = {},
): Promise<MemoryOperation> {
  const memorySummary = existingMemories.length > 0
    ? existingMemories.map((m) => `[${m.id}] ${m.content}`).join("\n")
    : "(no existing memories)";

  const conversation = messages
    .filter((m) => m.role !== "system")
    .slice(-10)
    .map((m) => {
      const content = typeof m.content === "string"
        ? m.content
        : (m.content ?? []).map((b) => b.text || "").join("");
      return `${m.role}: ${content.slice(0, 300)}`;
    })
    .join("\n");

  const prompt = MEMORY_PROMPT
    .replace("{existing_memories}", memorySummary)
    .replace("{conversation}", conversation);

  try {
    const result = await routeAndCollect(
      {
        model: options.model ?? "auto",
        messages: [
          { role: "system", content: prompt },
          { role: "user", content: "Analyze and decide." },
        ],
        max_tokens: 200,
        temperature: 0.3,
      },
      { tags: ["fast", "cheap"] },
    );

    const parsed = JSON.parse(result.text);
    return {
      action: parsed.action ?? "skip",
      memoryId: parsed.memory_id,
      memoryText: parsed.memory_text,
      reasoning: parsed.reasoning ?? "",
    };
  } catch (err) {
    logger.warn({ err }, "Memory update decision failed");
    return { action: "skip", reasoning: "LLM call failed" };
  }
}
