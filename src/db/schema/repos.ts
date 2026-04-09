import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  index,
} from "drizzle-orm/pg-core";
import { vector } from "./types.js";

// ─── CodeRepository ──────────────────────────────────────────────────────────
export const codeRepositories = pgTable("CodeRepository", {
  id: text("id").primaryKey(),
  userId: text("userId").notNull(),
  source: text("source").notNull(),
  repoUrl: text("repoUrl"),
  name: text("name").notNull(),
  indexed: boolean("indexed").default(false).notNull(),
  fileCount: integer("fileCount").default(0).notNull(),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
});

// ─── CodeFile ────────────────────────────────────────────────────────────────
export const codeFiles = pgTable(
  "CodeFile",
  {
    id: text("id").primaryKey(),
    repoId: text("repoId")
      .notNull()
      .references(() => codeRepositories.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    language: text("language"),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: 1536 }).notNull(),
  },
  (table) => [index("CodeFile_repoId_idx").on(table.repoId)],
);
