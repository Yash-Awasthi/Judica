/**
 * Prompt Favourites Schema — Phase 1.26
 *
 * Stores user's favourite/bookmarked prompts for quick reuse.
 * Inspired by TypingMind's saved prompts library.
 */
import { pgTable, uuid, integer, text, boolean, timestamp, integer as pgInt } from "drizzle-orm/pg-core";
import { users } from "./users.js";

export const promptFavourites = pgTable("prompt_favourites", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  prompt: text("prompt").notNull(),
  /** Folder/category for organization */
  folder: text("folder"),
  /** Tags for search */
  tags: text("tags").array(),
  /** How many times this prompt was used */
  useCount: pgInt("use_count").notNull().default(0),
  isPinned: boolean("is_pinned").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
});

export type PromptFavourite = typeof promptFavourites.$inferSelect;
export type NewPromptFavourite = typeof promptFavourites.$inferInsert;
