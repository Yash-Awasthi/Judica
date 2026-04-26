/**
 * Agent Memory — Phase 2.10
 *
 * Agent-level memory scope: specific council member's own persistent memory.
 * Separate from user-level (global) and session-level (conversation) memory.
 *
 * An archetype like "The Contrarian" maintains its own memory of user interactions,
 * past disagreements, topics it's repeatedly been asked about, etc.
 *
 * Inspired by:
 * - mem0 (Apache 2.0, mem0ai/mem0) — Agent-level memory scope
 */

import { pgTable, serial, integer, text, real, timestamp, index } from "drizzle-orm/pg-core";

export const agentMemories = pgTable("agent_memories", {
  id:             serial("id").primaryKey(),
  userId:         integer("user_id").notNull(),
  agentId:        text("agent_id").notNull(),       // council member archetype id
  agentLabel:     text("agent_label"),              // human-readable archetype name
  fact:           text("fact").notNull(),
  confidence:     real("confidence").default(1.0),
  decayScore:     real("decay_score").default(1.0),
  conversationId: text("conversation_id"),
  createdAt:      timestamp("created_at").defaultNow().notNull(),
  updatedAt:      timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  userAgentIdx: index("idx_agent_memories_user_agent").on(t.userId, t.agentId),
}));
