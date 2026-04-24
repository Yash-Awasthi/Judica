/**
 * SCIM 2.0 Provisioning — database schema for SCIM tokens and sync audit log.
 */

import { pgTable, serial, text, timestamp, boolean, integer, jsonb } from "drizzle-orm/pg-core";

// ─── SCIM Bearer Tokens ──────────────────────────────────────────────────────

export const scimTokens = pgTable("scim_tokens", {
  id: serial("id").primaryKey(),
  /** Hashed bearer token (argon2id). */
  tokenHash: text("token_hash").notNull(),
  /** Human-readable label (e.g., "Okta SCIM token"). */
  label: text("label").notNull(),
  /** Which tenant this token provisions into (null = default tenant). */
  tenantId: integer("tenant_id"),
  /** Created by admin user. */
  createdByUserId: integer("created_by_user_id"),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  lastUsedAt: timestamp("last_used_at"),
  expiresAt: timestamp("expires_at"),
});

// ─── SCIM Sync Audit Log ─────────────────────────────────────────────────────

export const scimSyncLog = pgTable("scim_sync_log", {
  id: serial("id").primaryKey(),
  /** "Users" | "Groups" */
  resourceType: text("resource_type").notNull(),
  /** "CREATE" | "UPDATE" | "DELETE" | "PATCH" */
  operation: text("operation").notNull(),
  /** SCIM externalId from the IdP. */
  externalId: text("external_id"),
  /** Local user/group ID after sync. */
  localId: integer("local_id"),
  /** Was the operation successful? */
  success: boolean("success").notNull(),
  /** Error message if failed. */
  errorMessage: text("error_message"),
  /** Full SCIM request payload (redacted if needed). */
  requestPayload: jsonb("request_payload"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
