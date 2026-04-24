/**
 * Document Sets DB Schema — named collections of documents for scoped search.
 */

import {
  pgTable,
  serial,
  text,
  timestamp,
  integer,
  boolean,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { users } from "./users.js";

export const documentSets = pgTable(
  "DocumentSet",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description").default("").notNull(),
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

export const documentSetMembers = pgTable(
  "DocumentSetMember",
  {
    id: serial("id").primaryKey(),
    setId: integer("setId")
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
    index("DocumentSetMember_setId_idx").on(table.setId),
    uniqueIndex("DocumentSetMember_setId_documentId_key").on(table.setId, table.documentId),
  ],
);
