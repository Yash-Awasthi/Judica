/**
 * Workspace System — Phase 1.18
 *
 * Isolated namespaces within a user account.
 * Each workspace has its own:
 * - Council configuration (members, master, system prompt)
 * - Knowledge base (kb_id)
 * - Conversation isolation (all chats are scoped to a workspace)
 * - Slug for URL routing
 *
 * Inspired by:
 * - AnythingLLM (MIT, Mintplex-Labs/anything-llm) — workspace-based chat isolation
 *   with per-workspace vector store and LLM config
 */
import { pgTable, uuid, integer, text, jsonb, boolean, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { users } from "./users.js";

export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** URL-safe slug (e.g. "my-research-workspace") */
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  /** Emoji or icon name for UI display */
  icon: text("icon"),
  /** Default council members JSON (array of ProviderConfig) */
  councilConfig: jsonb("council_config"),
  /** Default master/synthesizer config */
  masterConfig: jsonb("master_config"),
  /** Linked knowledge base ID */
  kbId: uuid("kb_id"),
  /** Default system prompt override */
  systemPrompt: text("system_prompt"),
  /** Default deliberation mode */
  deliberationMode: text("deliberation_mode").default("standard"),
  /** Whether this is the user's default workspace */
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("workspaces_user_slug_key").on(table.userId, table.slug),
]);

export type Workspace = typeof workspaces.$inferSelect;
export type NewWorkspace = typeof workspaces.$inferInsert;
