/**
 * Whitelabel Service — tenant branding configuration management.
 *
 * Functions:
 *   getBranding        — fetch branding config by tenantId
 *   upsertBranding     — create or update branding config
 *   deleteBranding     — delete branding (resets to defaults)
 *   resolveBrandingForDomain — find tenant branding by customDomain
 */

import { db } from "../lib/drizzle.js";
import { tenantBranding } from "../db/schema/whitelabel.js";
import { eq } from "drizzle-orm";
import logger from "../lib/logger.js";

export type { TenantBranding, NewTenantBranding } from "../db/schema/whitelabel.js";

const log = logger.child({ service: "whitelabel" });

// ─── Branding CRUD ────────────────────────────────────────────────────────────

export async function getBranding(tenantId: string): Promise<typeof tenantBranding.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(tenantBranding)
    .where(eq(tenantBranding.tenantId, tenantId))
    .limit(1);
  return row ?? null;
}

export async function upsertBranding(
  tenantId: string,
  data: Partial<Omit<typeof tenantBranding.$inferInsert, "id" | "tenantId" | "createdAt" | "updatedAt">>,
): Promise<typeof tenantBranding.$inferSelect> {
  const existing = await getBranding(tenantId);

  if (existing) {
    const [updated] = await db
      .update(tenantBranding)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(tenantBranding.tenantId, tenantId))
      .returning();
    log.info({ tenantId }, "Tenant branding updated");
    return updated;
  }

  const [created] = await db
    .insert(tenantBranding)
    .values({ id: crypto.randomUUID(), tenantId, ...data })
    .returning();
  log.info({ tenantId }, "Tenant branding created");
  return created;
}

export async function deleteBranding(tenantId: string): Promise<boolean> {
  const [deleted] = await db
    .delete(tenantBranding)
    .where(eq(tenantBranding.tenantId, tenantId))
    .returning();
  if (deleted) {
    log.info({ tenantId }, "Tenant branding deleted");
  }
  return !!deleted;
}

export async function resolveBrandingForDomain(
  domain: string,
): Promise<typeof tenantBranding.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(tenantBranding)
    .where(eq(tenantBranding.customDomain, domain))
    .limit(1);
  return row ?? null;
}
