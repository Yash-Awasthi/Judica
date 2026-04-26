/**
 * Memory Scopes — Phase 2.4
 *
 * Three-tier memory scoping system for isolation and sharing.
 *
 * Inspired by:
 * - MemGPT/Letta (Apache 2.0) — tiered memory: in-context, archival, external
 * - Zep (Apache 2.0) — session vs. user vs. global memory
 *
 * Scopes:
 * - conversation: Ephemeral, only accessible within a single conversation
 * - session:      Persists across conversations for the current session/day
 * - global:       Long-term user memory (persists indefinitely, decays slowly)
 *
 * The existing memoryFacts table gets a scope field via ALTER TABLE.
 * This module provides helpers for scope-filtered memory retrieval.
 */

import { db } from "./drizzle.js";
import { memoryFacts } from "../db/schema/memoryFacts.js";
import { eq, and, gte, desc } from "drizzle-orm";

export type MemoryScope = "conversation" | "session" | "global";

/** Retrieve memory facts filtered by scope */
export async function getMemoryByScope(
  userId: number,
  scope: MemoryScope,
  conversationId?: string,
  limit = 20,
): Promise<typeof memoryFacts.$inferSelect[]> {
  const conditions = [
    eq(memoryFacts.userId, userId),
    gte(memoryFacts.decayScore, 0.1), // Filter out heavily decayed memories
  ];

  // For conversation scope, filter by conversationId
  if (scope === "conversation" && conversationId) {
    conditions.push(eq(memoryFacts.conversationId, conversationId));
  }

  // For session scope, filter to facts created today
  if (scope === "session") {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    conditions.push(gte(memoryFacts.createdAt, today));
  }

  // Global scope: all facts (no additional filter beyond decay)
  return db
    .select()
    .from(memoryFacts)
    .where(and(...conditions))
    .orderBy(desc(memoryFacts.decayScore), desc(memoryFacts.createdAt))
    .limit(limit);
}

/**
 * Build a context string from scoped memories for injection into prompts.
 */
export function formatScopedMemory(
  facts: typeof memoryFacts.$inferSelect[],
  scope: MemoryScope,
): string {
  if (facts.length === 0) return "";
  const header = scope === "conversation"
    ? "This conversation facts:"
    : scope === "session"
    ? "Today's session facts:"
    : "Long-term memory:";

  const lines = facts.map(f => `• ${f.fact}`).join("\n");
  return `[${header.toUpperCase()}]\n${lines}`;
}
