import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
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
    /** ACL list — tokens like "user:1", "group:team-a", "public", "ext_email:foo@bar.com" */
    accessControlList: jsonb("accessControlList").$type<string[]>().default([]),
    /** Document sets this chunk belongs to (for set-based access control). */
    documentSets: jsonb("documentSets").$type<string[]>().default([]),
    /** Boost factor for search ranking (feedback-driven). Default 0 = neutral. */
    boostFactor: integer("boostFactor").default(0).notNull(),
    /** Whether this document is hidden from search results. */
    hidden: boolean("hidden").default(false).notNull(),
    createdAt: timestamp("createdAt", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    lastAccessedAt: timestamp("lastAccessedAt", { mode: "date", withTimezone: true }),
    accessCount: integer("accessCount").default(0).notNull(),
  },
  (table) => [
    index("Memory_userId_kbId_idx").on(table.userId, table.kbId),
    // Verified HNSW index DDL works with Drizzle 0.45.x — .using() + .op() syntax
    // For tuning: m=16, ef_construction=64 must be set via raw SQL migration (see vectorPartitioning.ts)
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
  // Use jsonb for structured config — enables JSON validation and query operators
  config: jsonb("config").notNull(),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("createdAt", { mode: "date", withTimezone: true }).defaultNow().notNull(),
});
