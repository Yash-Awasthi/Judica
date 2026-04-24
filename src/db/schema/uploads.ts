import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { users } from "./users.js";

// ─── Upload ──────────────────────────────────────────────────────────────────
export const uploads = pgTable(
  "Upload",
  {
    id: text("id").primaryKey(),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    originalName: text("originalName").notNull(),
    mimeType: text("mimeType").notNull(),
    sizeBytes: integer("sizeBytes").notNull(),
    storagePath: text("storagePath").notNull(),
    processed: boolean("processed").default(false).notNull(),
    extractedText: text("extractedText"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("createdAt", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("Upload_userId_createdAt_idx").on(table.userId, table.createdAt),
  ],
);

// ─── KnowledgeBase ───────────────────────────────────────────────────────────
export const knowledgeBases = pgTable(
  "KnowledgeBase",
  {
    id: text("id").primaryKey(),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    createdAt: timestamp("createdAt", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    // Add defaultNow to prevent insert failures when updatedAt is omitted
    updatedAt: timestamp("updatedAt", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("KnowledgeBase_userId_name_key").on(table.userId, table.name),
  ],
);

// ─── KBDocument ──────────────────────────────────────────────────────────────
export const kbDocuments = pgTable(
  "KBDocument",
  {
    id: text("id").primaryKey(),
    kbId: text("kbId")
      .notNull()
      .references(() => knowledgeBases.id, { onDelete: "cascade" }),
    uploadId: text("uploadId")
      .notNull()
      .references(() => uploads.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    chunkCount: integer("chunkCount").default(0).notNull(),
    indexed: boolean("indexed").default(false).notNull(),
    indexedAt: timestamp("indexedAt", { mode: "date", withTimezone: true }),
    createdAt: timestamp("createdAt", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("KBDocument_kbId_idx").on(table.kbId),
    index("KBDocument_uploadId_idx").on(table.uploadId),
  ],
);
