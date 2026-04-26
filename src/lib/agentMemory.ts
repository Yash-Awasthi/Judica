/**
 * Agent-Level Memory — Phase 2.10
 *
 * Per-archetype persistent memory: each council member maintains its own
 * facts about the user, separate from user-level and session-level memory.
 *
 * Inspired by:
 * - mem0 (Apache 2.0, mem0ai/mem0) — agent-level memory scope
 *
 * Scope hierarchy:
 *   user-level    → persists forever across all sessions (memoryFacts, scope=global)
 *   session-level → conversation-scoped, ephemeral (memoryFacts, scope=conversation)
 *   agent-level   → per-archetype, persists per user (agentMemories table)
 */

import { db } from "./drizzle.js";
import { agentMemories } from "../db/schema/agentMemories.js";
import { eq, and, gte, desc } from "drizzle-orm";

export interface AgentMemoryEntry {
  id: number;
  fact: string;
  confidence: number;
  conversationId?: string | null;
}

/**
 * Retrieve agent-scoped memories for a specific council member.
 * Used to inject archetype-specific context before that member's call.
 */
export async function getAgentMemory(
  userId: number,
  agentId: string,
  limit = 10,
): Promise<AgentMemoryEntry[]> {
  const rows = await db
    .select({
      id:             agentMemories.id,
      fact:           agentMemories.fact,
      confidence:     agentMemories.confidence,
      conversationId: agentMemories.conversationId,
    })
    .from(agentMemories)
    .where(and(
      eq(agentMemories.userId, userId),
      eq(agentMemories.agentId, agentId),
      gte(agentMemories.decayScore, 0.1),
    ))
    .orderBy(desc(agentMemories.decayScore))
    .limit(limit);

  return rows.map(r => ({
    id:             r.id,
    fact:           r.fact,
    confidence:     r.confidence ?? 1.0,
    conversationId: r.conversationId,
  }));
}

/**
 * Store a new fact in an agent's memory.
 */
export async function storeAgentMemory(
  userId: number,
  agentId: string,
  agentLabel: string,
  fact: string,
  conversationId?: string,
): Promise<void> {
  await db.insert(agentMemories).values({
    userId,
    agentId,
    agentLabel,
    fact,
    conversationId: conversationId ?? null,
    confidence: 1.0,
    decayScore: 1.0,
  });
}

/**
 * Format agent memories as a prefix for that council member's system prompt.
 */
export function formatAgentMemoryPrefix(memories: AgentMemoryEntry[]): string {
  if (memories.length === 0) return "";
  const lines = memories.map(m => `• ${m.fact}`).join("\n");
  return `[YOUR MEMORY OF THIS USER]\n${lines}\n[/YOUR MEMORY]\n\n`;
}

/**
 * Build agent memory prefixes for all active council members.
 * Returns a map: agentId → system prompt prefix.
 */
export async function buildAgentMemoryPrefixes(
  userId: number,
  agentIds: string[],
): Promise<Map<string, string>> {
  const prefixes = new Map<string, string>();

  await Promise.all(agentIds.map(async (agentId) => {
    const memories = await getAgentMemory(userId, agentId);
    if (memories.length > 0) {
      prefixes.set(agentId, formatAgentMemoryPrefix(memories));
    }
  }));

  return prefixes;
}
