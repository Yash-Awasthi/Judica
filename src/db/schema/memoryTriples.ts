/**
 * Triple-Store Memory — Phase 2.2
 *
 * Stores factual knowledge as RDF-style subject–predicate–object triples.
 * Enables structured knowledge graph queries over conversation-extracted facts.
 *
 * Inspired by:
 * - RDF/SPARQL triple stores (W3C standard)
 * - MemGPT/Letta (Apache 2.0) — structured memory with entity relationships
 * - Zep (Apache 2.0, getzep/zep) — temporal knowledge graph for AI memory
 *
 * Example triples:
 *   subject: "user"  predicate: "prefers"   object: "dark mode"
 *   subject: "Alice" predicate: "works at"  object: "Acme Corp"
 *   subject: "project X" predicate: "uses" object: "PostgreSQL"
 */
import { pgTable, uuid, integer, text, real, timestamp, index } from "drizzle-orm/pg-core";
import { users } from "./users.js";

export const memoryTriples = pgTable("memory_triples", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  subject: text("subject").notNull(),
  predicate: text("predicate").notNull(),
  object: text("object").notNull(),
  /** Confidence score 0–1 */
  confidence: real("confidence").notNull().default(1.0),
  /** Source conversation ID */
  conversationId: uuid("conversation_id"),
  /** ISO timestamp when this fact was observed (defaults to now) */
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("memory_triples_user_subj_idx").on(t.userId, t.subject),
  index("memory_triples_user_pred_idx").on(t.userId, t.predicate),
]);

export type MemoryTriple = typeof memoryTriples.$inferSelect;
export type NewMemoryTriple = typeof memoryTriples.$inferInsert;
