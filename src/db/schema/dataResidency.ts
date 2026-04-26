/**
 * Data Residency Controls — per-tenant region configuration for vector storage
 * and conversation data.
 *
 * Modeled after CockroachDB multi-region data domiciling and Citus distributed
 * PostgreSQL tenant-based sharding patterns.
 *
 * Design:
 * - Each tenant can pin data to a named region (e.g., "eu-west-1", "us-east-1")
 * - Region controls:  which pgvector namespace is used, which S3 bucket/prefix
 *   is used for uploads, and which database replica (read endpoint) is preferred
 * - When a tenant has no residency record the platform uses the global default
 *   region from DATA_DEFAULT_REGION env var (falls back to "us-east-1")
 * - Enforcement is advisory at the application layer — it routes requests to the
 *   right endpoint; it does not replicate existing data automatically (ops task)
 */

import {
  pgTable,
  text,
  timestamp,
  boolean,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

// ─── Supported Regions ────────────────────────────────────────────────────────

export const SUPPORTED_REGIONS = [
  "us-east-1",
  "us-west-2",
  "eu-west-1",
  "eu-central-1",
  "ap-southeast-1",
  "ap-northeast-1",
] as const;

export type SupportedRegion = (typeof SUPPORTED_REGIONS)[number];

// ─── TenantDataResidency ──────────────────────────────────────────────────────

export const tenantDataResidency = pgTable(
  "TenantDataResidency",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenantId")
      .notNull()
      .unique()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** Primary region for all data storage. */
    primaryRegion: text("primaryRegion").notNull().default("us-east-1"),
    /**
     * Optional secondary regions for read replicas / disaster recovery.
     * JSON array of region strings.
     */
    secondaryRegions: jsonb("secondaryRegions")
      .$type<SupportedRegion[]>()
      .default([])
      .notNull(),
    /** Override pgvector namespace prefix for this tenant (e.g. "eu_tenant_<id>"). */
    vectorNamespace: text("vectorNamespace"),
    /** Override S3/object-storage bucket or prefix for uploads. */
    storagePrefix: text("storagePrefix"),
    /**
     * Override database read endpoint URL (for read replicas in a specific
     * region).  When null, the global DATABASE_URL is used.
     */
    dbReadEndpoint: text("dbReadEndpoint"),
    /**
     * Whether to restrict conversation data to primaryRegion only.
     * When true the app refuses to process requests from outside the region
     * (relies on a CDN/load-balancer header, e.g. CF-IPCountry / X-Region).
     */
    strictEnforcement: boolean("strictEnforcement").default(false).notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("TenantDataResidency_tenantId_key").on(table.tenantId),
    index("TenantDataResidency_region_idx").on(table.primaryRegion),
  ],
);

export type TenantDataResidency = typeof tenantDataResidency.$inferSelect;
export type NewTenantDataResidency = typeof tenantDataResidency.$inferInsert;
