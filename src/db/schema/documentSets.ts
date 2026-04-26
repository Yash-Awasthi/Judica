/**
 * Document Sets DB Schema — named collections of documents for scoped search.
 *
 * Phase 3.8: Curated subsets of the knowledge base. Scope a specific agent or
 * conversation to only a defined set of documents — e.g. "only search our
 * legal docs" or "only the Q3 reports."
 */

import {
  pgTable,
  text,
  timestamp,
  integer,
  boolean,
  index,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { conversations } from "./conversations.js";

// ─── DocumentSet ────────────────────────────────────────────────────────────
export const documentSets = pgTable(
  "DocumentSet",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Whether this set is publicly accessible to all users. */
    isPublic: boolean("isPublic").default(false).notNull(),
    createdAt: timestamp("createdAt", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("DocumentSet_userId_idx").on(table.userId),
    uniqueIndex("DocumentSet_userId_name_key").on(table.userId, table.name),
  ],
);

// ─── DocumentSetMember ──────────────────────────────────────────────────────
export const documentSetMembers = pgTable(
  "DocumentSetMember",
  {
    id: text("id").primaryKey(),
    documentSetId: text("documentSetId")
      .notNull()
      .references(() => documentSets.id, { onDelete: "cascade" }),
    /** Reference to memory/document chunk by ID. */
    documentId: text("documentId").notNull(),
    /** Document title for display. */
    documentTitle: text("documentTitle").default("").notNull(),
    /** Document source URL. */
    documentSource: text("documentSource"),
    addedAt: timestamp("addedAt", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("DocumentSetMember_documentSetId_idx").on(table.documentSetId),
    uniqueIndex("DocumentSetMember_documentSetId_documentId_key").on(
      table.documentSetId,
      table.documentId,
    ),
  ],
);

// ─── ConversationDocumentSet ────────────────────────────────────────────────
// Junction table linking conversations to document sets, enabling scoped search.
export const conversationDocumentSets = pgTable(
  "ConversationDocumentSet",
  {
    conversationId: text("conversationId")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    documentSetId: text("documentSetId")
      .notNull()
      .references(() => documentSets.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.conversationId, table.documentSetId] }),
    index("ConversationDocumentSet_documentSetId_idx").on(table.documentSetId),
  ],
);
