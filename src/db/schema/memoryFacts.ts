/**
 * Memory Facts DB Schema — Phase 1.8
 *
 * User-editable short facts, modeled after mem0 (Apache 2.0, mem0ai/mem0).
 * mem0 stores memory as structured facts with user/session/agent scope,
 * supports CRUD operations, and provides a dashboard for user management.
 *
 * Separate from the vector Memory table (which stores RAG document chunks).
 * These are short, human-readable facts: "User prefers Python over JS",
 * "User's project is a SaaS for logistics companies", etc.
 */

import {
  pgTable,
  uuid,
  integer,
  text,
  boolean,
  real,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { users } from "./users.js";

export const memoryFacts = pgTable(
  "MemoryFact",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    fact: text("fact").notNull(),
    tags: text("tags").array().notNull().default([]),
    /** Where this fact came from */
    source: text("source").default("extracted"),      // "extracted" | "manual" | "agent"
    conversationId: text("conversationId"),
    /** Temporal decay score (mem0 + Ebbinghaus forgetting curve). 1.0 = fresh */
    decayScore: real("decayScore").notNull().default(1.0),
    lastConfirmedAt: timestamp("lastConfirmedAt", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("createdAt", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    /** Phase 2.3 — opt-in cross-chat sharing */
    isShared: boolean("isShared").notNull().default(false),
  },
  (table) => [
    index("MemoryFact_userId_idx").on(table.userId),
    index("MemoryFact_userId_decayScore_idx").on(table.userId, table.decayScore),
  ],
);
