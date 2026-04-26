/**
 * Idea Evolution Tree — Phase 1.13
 *
 * Stores idea nodes and parent-child relationships to build a tree
 * showing how ideas evolve through conversation.
 *
 * Inspired by:
 * - Markmap (MIT, markmap-lib/markmap) — mindmap from Markdown headings
 * - D3.js (ISC, d3/d3) — tree/hierarchy visualisations
 *
 * Each node links to a conversation message (optionally) and has
 * a parent pointer for tree reconstruction.
 */
import { pgTable, uuid, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { users } from "./users.js";

export const ideaNodes = pgTable("idea_nodes", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }),
  /** Parent node ID — null for root nodes */
  parentId: uuid("parent_id"),
  /** Short label shown on the tree node */
  label: text("label").notNull(),
  /** Optional expanded content / summary */
  content: text("content"),
  /** Optional link to the source conversation */
  conversationId: uuid("conversation_id"),
  /** Optional extra metadata (tags, confidence, etc.) */
  meta: jsonb("meta"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type IdeaNode = typeof ideaNodes.$inferSelect;
export type NewIdeaNode = typeof ideaNodes.$inferInsert;
