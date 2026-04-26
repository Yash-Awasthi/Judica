/**
 * Session Templates Schema — Phase 1.22
 */
import { pgTable, uuid, integer, text, jsonb, boolean, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users.js";

export const sessionTemplates = pgTable("session_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  icon: text("icon"),
  /** Serialized council config: { councilMembers, master, summon, deliberationMode, systemPrompt, defaultQuestion, maxTokens } */
  config: jsonb("config").notNull().default({}),
  isPublic: boolean("is_public").notNull().default(false),
  usageCount: integer("usage_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SessionTemplate = typeof sessionTemplates.$inferSelect;
export type NewSessionTemplate = typeof sessionTemplates.$inferInsert;
