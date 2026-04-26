/**
 * Tenant Isolation — DB schemas for per-tenant encryption keys and
 * pgvector namespace mapping.
 *
 * Ref: PostgreSQL Row-Level Security (RLS) + Drizzle ORM RLS pattern.
 *
 * Key design:
 * - Per-tenant HKDF IKM stored encrypted with the platform master key
 *   → each tenant gets an independent AES-256-GCM data key
 * - pgvector namespace per tenant → embeddings are isolated at the schema level
 * - RLS policies live in migration 0025; the Drizzle schema here just declares
 *   the table shapes for type-safe query access.
 */

import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

// ─── TenantEncryptionKey ──────────────────────────────────────────────────────

export const tenantEncryptionKeys = pgTable("TenantEncryptionKey", {
  id: text("id").primaryKey(),
  tenantId: text("tenantId")
    .notNull()
    .unique()
    .references(() => tenants.id, { onDelete: "cascade" }),
  /** HKDF IKM encrypted with the platform master key (AES-256-GCM envelope). */
  encryptedIkm: text("encryptedIkm").notNull(),
  /** Monotonically increasing key version — incremented on key rotation. */
  keyVersion: integer("keyVersion").default(1).notNull(),
  /** False during key rotation (old key kept for decrypt-only decryption). */
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
});

export type TenantEncryptionKey = typeof tenantEncryptionKeys.$inferSelect;
export type NewTenantEncryptionKey = typeof tenantEncryptionKeys.$inferInsert;

// ─── TenantVectorNamespace ────────────────────────────────────────────────────

export const tenantVectorNamespaces = pgTable(
  "TenantVectorNamespace",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenantId")
      .notNull()
      .unique()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** PostgreSQL schema name that holds this tenant's vector tables. */
    schemaName: text("schemaName").notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("TenantVectorNamespace_tenantId_key").on(table.tenantId),
  ],
);

export type TenantVectorNamespace = typeof tenantVectorNamespaces.$inferSelect;
