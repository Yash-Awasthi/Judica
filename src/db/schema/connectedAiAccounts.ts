/**
 * Connected AI Accounts Schema — Phase 1.28
 *
 * Stores per-user AI provider credentials securely.
 * Each user can connect multiple AI providers (OpenAI, Anthropic, etc.)
 *
 * Inspired by:
 * - GodMode (MIT, smol-ai/GodMode) — multi-provider API key management
 * - Passport.js (MIT, jaredhanson/passport) — account connection strategy pattern
 */
import { pgTable, uuid, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users.js";

export const connectedAiAccounts = pgTable("connected_ai_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** Provider name: openai, anthropic, gemini, mistral, cohere, ollama, etc. */
  provider: text("provider").notNull(),
  /** Display name for the account (e.g. "Personal GPT-4 Key") */
  label: text("label").notNull(),
  /** Encrypted API key (AES-256 in production; stored as-is for local dev) */
  apiKeyEncrypted: text("api_key_encrypted").notNull(),
  /** Optional base URL override (for self-hosted endpoints) */
  baseUrl: text("base_url"),
  /** Default model for this provider */
  defaultModel: text("default_model"),
  isActive: boolean("is_active").notNull().default(true),
  /** Last time this key was successfully used */
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ConnectedAiAccount = typeof connectedAiAccounts.$inferSelect;
export type NewConnectedAiAccount = typeof connectedAiAccounts.$inferInsert;
