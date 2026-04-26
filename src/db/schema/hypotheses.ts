/**
 * Hypothesis Tracker — Phase 1.12
 *
 * Lightweight forecasting table inspired by:
 * - Metaculus (metaculus.com) — community forecasting with probability tracking
 * - Fatebook (fatebook.io, MIT, Sage-Future/fatebook) — personal prediction book
 *
 * Each hypothesis is a falsifiable claim with a probability estimate (0–1),
 * a resolution status, and optional conversation context.
 */
import { pgTable, uuid, text, real, boolean, timestamp, integer } from "drizzle-orm/pg-core";
import { users } from "./users.js";

export type HypothesisStatus = "open" | "resolved_true" | "resolved_false" | "voided";

export const hypotheses = pgTable("hypotheses", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }),
  /** The falsifiable claim */
  claim: text("claim").notNull(),
  /** 0–1 probability estimate at creation time */
  probability: real("probability").notNull().default(0.5),
  /** Latest revised probability (updated via PUT) */
  currentProbability: real("current_probability").notNull().default(0.5),
  /** open | resolved_true | resolved_false | voided */
  status: text("status").notNull().default("open"),
  /** Optional resolution note explaining the outcome */
  resolutionNote: text("resolution_note"),
  /** Optional link to the conversation where this was raised */
  conversationId: uuid("conversation_id"),
  /** Optional deadline for resolution */
  resolveBy: timestamp("resolve_by", { withTimezone: true }),
  /** Tags for grouping (e.g. ['economics', 'ai']) */
  tags: text("tags").array(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  isPublic: boolean("is_public").notNull().default(false),
});

export type Hypothesis = typeof hypotheses.$inferSelect;
export type NewHypothesis = typeof hypotheses.$inferInsert;
