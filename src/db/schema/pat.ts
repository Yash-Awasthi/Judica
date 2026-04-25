/**
 * Personal Access Tokens — database schema for user-generated API keys.
 */

import { pgTable, serial, text, timestamp, boolean, integer, jsonb } from "drizzle-orm/pg-core";
import { users } from "./users.js";

export const personalAccessTokens = pgTable("personal_access_tokens", {
  id: serial("id").primaryKey(),
  /** Owning user. */
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  /** Human-readable label (e.g., "CI Pipeline", "Local dev"). */
  label: text("label").notNull(),
  /** SHA-256 hash of the token — never store plaintext. */
  tokenHash: text("token_hash").notNull().unique(),
  /** First 8 chars of the token for identification (e.g., "aib_xxxx"). */
  tokenPrefix: text("token_prefix").notNull(),
  /** Scopes granted to this token (e.g., ["read", "write", "admin"]). */
  scopes: jsonb("scopes").$type<string[]>().default([]).notNull(),
  /**
   * Tier controls which routes the token can access:
   *   admin   — all routes
   *   basic   — /api/ask, /api/chat, /api/history, /api/kb, /api/search, /api/documents
   *   limited — /api/ask, /api/chat only (hard rate limit: 10 req/min)
   */
  tier: text("tier").default("basic").notNull(),
  /** Optional fine-grained route whitelist (overrides tier defaults when set). */
  allowedRoutes: jsonb("allowed_routes").$type<string[]>(),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  lastUsedAt: timestamp("last_used_at"),
  expiresAt: timestamp("expires_at"),
});
