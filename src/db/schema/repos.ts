import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  index,
} from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { vector } from "./types.js";

// ─── CodeRepository ──────────────────────────────────────────────────────────
export const codeRepositories = pgTable(
  "CodeRepository",
  {
    id: text("id").primaryKey(),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    repoUrl: text("repoUrl"),
    name: text("name").notNull(),
    indexed: boolean("indexed").default(false).notNull(),
    fileCount: integer("fileCount").default(0).notNull(),
    createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    index("CodeRepository_userId_idx").on(table.userId),
  ],
);

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
  (table) => [
    index("CodeFile_repoId_idx").on(table.repoId),
    index("CodeFile_embedding_hnsw_idx")
      .using("hnsw", table.embedding.op("vector_cosine_ops")),
  ],
);
