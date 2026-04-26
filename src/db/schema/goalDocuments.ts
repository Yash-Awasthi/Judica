/**
 * Goal Documents — Phase 2.8
 *
 * User-authored "goal document" injected silently into every conversation context.
 * Inspired by:
 * - Cursor `.cursorrules` — project-level context injection into every AI interaction
 * - CLAUDE.md — persistent context files that shape all subsequent conversations
 */

import { pgTable, serial, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";

export const goalDocuments = pgTable("goal_documents", {
  id:        serial("id").primaryKey(),
  userId:    integer("user_id").notNull(),
  title:     text("title").notNull().default("My Goal Document"),
  content:   text("content").notNull(),
  isActive:  boolean("is_active").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
