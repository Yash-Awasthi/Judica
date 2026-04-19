import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  index,
} from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { knowledgeBases } from "./uploads.js";
import { vector } from "./types.js";

// ─── Memory ──────────────────────────────────────────────────────────────────
export const memories = pgTable(
  "Memory",
  {
    id: text("id").primaryKey(),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kbId: text("kbId").references(() => knowledgeBases.id, {
      onDelete: "cascade",
    }),
    content: text("content").notNull(),
    chunkIndex: integer("chunkIndex").default(0).notNull(),
    sourceName: text("sourceName"),
    sourceUrl: text("sourceUrl"),
    parentChunkId: text("parentChunkId"),
    embedding: vector("embedding", { dimensions: 1536 }).notNull(),
    createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
    lastAccessedAt: timestamp("lastAccessedAt", { mode: "date" }),
    accessCount: integer("accessCount").default(0).notNull(),
  },
  (table) => [
    index("Memory_userId_kbId_idx").on(table.userId, table.kbId),
    index("Memory_embedding_hnsw_idx")
      .using("hnsw", table.embedding.op("vector_cosine_ops")),
  ],
);

// ─── MemoryBackend ───────────────────────────────────────────────────────────
export const memoryBackends = pgTable("MemoryBackend", {
  id: text("id").primaryKey(),
  userId: integer("userId")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  config: text("config").notNull(),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
});
