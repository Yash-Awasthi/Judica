/**
 * Tenant DB Schema — tenant registry and per-tenant config.
 */

import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  index,
  uniqueIndex,
  boolean,
} from "drizzle-orm/pg-core";

// ─── Tenant ───────────────────────────────────────────────────────────────────

export const tenants = pgTable(
  "Tenant",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    schemaName: text("schemaName").notNull(),
    ownerId: integer("ownerId").notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    limits: jsonb("limits").default({}).notNull(),
    createdAt: timestamp("createdAt", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("Tenant_slug_key").on(table.slug),
    uniqueIndex("Tenant_schemaName_key").on(table.schemaName),
  ],
);

// ─── TenantMember ─────────────────────────────────────────────────────────────

export const tenantMembers = pgTable(
  "TenantMember",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenantId")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: integer("userId").notNull(),
    role: text("role").notNull().default("member"),
    invitedBy: integer("invitedBy"),
    joinedAt: timestamp("joinedAt", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("TenantMember_tenantId_userId_key").on(table.tenantId, table.userId),
    index("TenantMember_userId_idx").on(table.userId),
  ],
);

// ─── TenantUsage ──────────────────────────────────────────────────────────────

export const tenantUsage = pgTable(
  "TenantUsage",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenantId")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    apiCalls: integer("apiCalls").default(0).notNull(),
    tokensUsed: integer("tokensUsed").default(0).notNull(),
    storageMb: integer("storageMb").default(0).notNull(),
    documentsIndexed: integer("documentsIndexed").default(0).notNull(),
  },
  (table) => [
    uniqueIndex("TenantUsage_tenantId_date_key").on(table.tenantId, table.date),
  ],
);
