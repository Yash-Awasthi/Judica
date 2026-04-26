/**
 * Data Residency Service — region routing for vector storage, uploads, and
 * database read endpoints on a per-tenant basis.
 *
 * Reference: CockroachDB multi-region + Citus distributed PostgreSQL
 * (tenant-based sharding) patterns.
 *
 * Key responsibilities:
 *   getResidencyConfig    — fetch (or synthesise default) residency for a tenant
 *   upsertResidencyConfig — create or update residency rules
 *   getVectorNamespace    — return the pgvector namespace prefix for a tenant
 *   getStoragePrefix      — return the object-storage prefix for a tenant
 *   checkRegionAllowed    — enforce strict-mode request gating by region header
 */

import { db } from "../lib/drizzle.js";
import { tenantDataResidency, SUPPORTED_REGIONS } from "../db/schema/dataResidency.js";
import type { SupportedRegion } from "../db/schema/dataResidency.js";
import { eq } from "drizzle-orm";
import { env } from "../config/env.js";
import logger from "../lib/logger.js";
import { randomUUID } from "crypto";

const log = logger.child({ service: "dataResidency" });

// ─── Default Region ───────────────────────────────────────────────────────────

function defaultRegion(): SupportedRegion {
  const r = (env.DATA_DEFAULT_REGION as string | undefined) ?? "us-east-1";
  return (SUPPORTED_REGIONS as readonly string[]).includes(r)
    ? (r as SupportedRegion)
    : "us-east-1";
}

// ─── Get / Synthesise Config ──────────────────────────────────────────────────

export async function getResidencyConfig(
  tenantId: string,
): Promise<typeof tenantDataResidency.$inferSelect> {
  const [row] = await db
    .select()
    .from(tenantDataResidency)
    .where(eq(tenantDataResidency.tenantId, tenantId))
    .limit(1);

  if (row) return row;

  // Synthesise an in-memory default so callers always get a usable object
  return {
    id: "",
    tenantId,
    primaryRegion: defaultRegion(),
    secondaryRegions: [],
    vectorNamespace: null,
    storagePrefix: null,
    dbReadEndpoint: null,
    strictEnforcement: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// ─── Upsert ───────────────────────────────────────────────────────────────────

export async function upsertResidencyConfig(
  tenantId: string,
  data: Partial<{
    primaryRegion: SupportedRegion;
    secondaryRegions: SupportedRegion[];
    vectorNamespace: string | null;
    storagePrefix: string | null;
    dbReadEndpoint: string | null;
    strictEnforcement: boolean;
  }>,
): Promise<typeof tenantDataResidency.$inferSelect> {
  const existing = await db
    .select({ id: tenantDataResidency.id })
    .from(tenantDataResidency)
    .where(eq(tenantDataResidency.tenantId, tenantId))
    .limit(1);

  if (existing.length > 0) {
    const [updated] = await db
      .update(tenantDataResidency)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(tenantDataResidency.tenantId, tenantId))
      .returning();
    log.info({ tenantId, primaryRegion: updated.primaryRegion }, "Data residency config updated");
    return updated;
  }

  const [created] = await db
    .insert(tenantDataResidency)
    .values({
      id: randomUUID(),
      tenantId,
      primaryRegion: data.primaryRegion ?? defaultRegion(),
      secondaryRegions: data.secondaryRegions ?? [],
      vectorNamespace: data.vectorNamespace ?? null,
      storagePrefix: data.storagePrefix ?? null,
      dbReadEndpoint: data.dbReadEndpoint ?? null,
      strictEnforcement: data.strictEnforcement ?? false,
    })
    .returning();
  log.info({ tenantId, primaryRegion: created.primaryRegion }, "Data residency config created");
  return created;
}

// ─── Routing Helpers ──────────────────────────────────────────────────────────

/**
 * Returns the pgvector namespace prefix to use for a tenant.
 * Falls back to `tenant_<tenantId>` if no custom namespace is set.
 */
export async function getVectorNamespace(tenantId: string): Promise<string> {
  const config = await getResidencyConfig(tenantId);
  return config.vectorNamespace ?? `tenant_${tenantId.replace(/[^a-z0-9]/gi, "_").toLowerCase()}`;
}

/**
 * Returns the object-storage prefix (folder) for a tenant's uploads.
 * Falls back to `tenants/<tenantId>/` if not configured.
 */
export async function getStoragePrefix(tenantId: string): Promise<string> {
  const config = await getResidencyConfig(tenantId);
  return config.storagePrefix ?? `tenants/${tenantId}/`;
}

/**
 * Returns the read-endpoint override for a tenant.
 * Returns null when the global DATABASE_URL should be used.
 */
export async function getDbReadEndpoint(tenantId: string): Promise<string | null> {
  const config = await getResidencyConfig(tenantId);
  return config.dbReadEndpoint ?? null;
}

/**
 * Check whether the request's origin region is allowed for a strict-enforcement
 * tenant.  Returns true when allowed (non-strict, or region matches).
 *
 * @param tenantId   Tenant to look up
 * @param reqRegion  Region inferred from request (e.g. CF-IPCountry → mapped,
 *                   or X-Region header set by the load-balancer)
 */
export async function checkRegionAllowed(
  tenantId: string,
  reqRegion: string | undefined,
): Promise<{ allowed: boolean; requiredRegion: string }> {
  const config = await getResidencyConfig(tenantId);

  if (!config.strictEnforcement) return { allowed: true, requiredRegion: config.primaryRegion };

  if (!reqRegion) {
    log.warn({ tenantId }, "Strict data residency: missing region header");
    return { allowed: false, requiredRegion: config.primaryRegion };
  }

  const allowed =
    reqRegion === config.primaryRegion ||
    (config.secondaryRegions as SupportedRegion[]).includes(reqRegion as SupportedRegion);

  if (!allowed) {
    log.warn(
      { tenantId, reqRegion, requiredRegion: config.primaryRegion },
      "Strict data residency: request region rejected",
    );
  }

  return { allowed, requiredRegion: config.primaryRegion };
}

// ─── List All Residency Configs (admin) ──────────────────────────────────────

export async function listResidencyConfigs(): Promise<
  typeof tenantDataResidency.$inferSelect[]
> {
  return db.select().from(tenantDataResidency);
}
