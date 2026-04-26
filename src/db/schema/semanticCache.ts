/**
 * Semantic Cache schema — Phase 8.2
 *
 * Stores embedded query + response pairs for L2 semantic similarity cache.
 * Uses pgvector for cosine similarity lookups.
 *
 * L1 (exact key) and L3 (member-level) caches are stored in Redis only.
 */

import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users.js";

export const semanticCache = pgTable("semantic_cache", {
  id: serial("id").primaryKey(),
  query: text("query").notNull(),
  response: text("response").notNull(),
  // Stored as vector(1536) — matches the default embedding model dimension.
  // For Ollama nomic-embed-text (768-dim) or other models, migration will handle resizing.
  // The column type is text here because Drizzle doesn't natively model pgvector columns;
  // the actual column is created via raw SQL in migrations.
  embedding: text("embedding").notNull(),
  userId: integer("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  councilConfigHash: text("councilConfigHash").notNull(),
  hitCount: integer("hitCount").notNull().default(0),
  createdAt: timestamp("createdAt", { mode: "date", withTimezone: true })
    .defaultNow()
    .notNull(),
});

/**
 * Migration SQL — run once during schema setup.
 * Creates the table with a proper vector column and HNSW index.
 */
export const SEMANTIC_CACHE_MIGRATION_SQL = `
  CREATE TABLE IF NOT EXISTS "semantic_cache" (
    "id"                SERIAL PRIMARY KEY,
    "query"             TEXT NOT NULL,
    "response"          TEXT NOT NULL,
    "embedding"         vector(1536),
    "userId"            INTEGER NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
    "councilConfigHash" TEXT NOT NULL,
    "hitCount"          INTEGER NOT NULL DEFAULT 0,
    "createdAt"         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT "semantic_cache_unique_entry" UNIQUE ("userId", "councilConfigHash", "query")
  );

  CREATE INDEX IF NOT EXISTS "semantic_cache_embedding_hnsw_idx"
    ON "semantic_cache" USING hnsw ("embedding" vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

  CREATE INDEX IF NOT EXISTS "semantic_cache_user_config_idx"
    ON "semantic_cache" ("userId", "councilConfigHash");
`;
