/**
 * Multi-Tenancy — tenant context propagation and isolation.
 *
 * Modeled after Onyx's tenant tracking:
 * - CURRENT_TENANT_ID propagated via AsyncLocalStorage (not explicit parameter)
 * - Tenant ID extracted from JWT, API key, or cookie
 * - Schema-based isolation for PostgreSQL
 * - Per-tenant rate limits and usage tracking
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { FastifyRequest, FastifyReply } from "fastify";
import logger from "../lib/logger.js";

// ─── Tenant Context ───────────────────────────────────────────────────────────

export interface TenantContext {
  tenantId: string;
  tenantSchemaName: string;
}

/** AsyncLocalStorage for tenant context — available anywhere without parameter threading. */
export const tenantStorage = new AsyncLocalStorage<TenantContext>();

/** Default tenant for single-tenant mode. */
export const DEFAULT_TENANT_ID = "default";
export const DEFAULT_SCHEMA = "public";

/**
 * Get the current tenant context.
 * Returns the default tenant if multi-tenancy is not enabled.
 */
export function getCurrentTenant(): TenantContext {
  return tenantStorage.getStore() ?? {
    tenantId: DEFAULT_TENANT_ID,
    tenantSchemaName: DEFAULT_SCHEMA,
  };
}

/**
 * Get the current tenant ID (shorthand).
 */
export function getCurrentTenantId(): string {
  return getCurrentTenant().tenantId;
}

// ─── Schema Name Validation ───────────────────────────────────────────────────

/** Prevent SQL injection via tenant schema name. */
const VALID_SCHEMA_NAME = /^[a-z][a-z0-9_]{0,62}$/;

export function isValidSchemaName(name: string): boolean {
  return VALID_SCHEMA_NAME.test(name);
}

export function tenantIdToSchemaName(tenantId: string): string {
  const schema = `tenant_${tenantId.replace(/[^a-z0-9]/gi, "_").toLowerCase()}`;
  if (!isValidSchemaName(schema)) {
    throw new Error(`Invalid tenant schema name: ${schema}`);
  }
  return schema;
}

// ─── Fastify Middleware ───────────────────────────────────────────────────────

/**
 * Whether multi-tenancy is enabled.
 * When disabled, all requests use the default schema.
 */
export const MULTI_TENANT = process.env.MULTI_TENANT === "true";

/**
 * Fastify middleware that extracts tenant ID and sets up the context.
 *
 * Extraction priority:
 * 1. X-Tenant-Id header (for API clients)
 * 2. JWT payload tenantId field
 * 3. Default tenant (single-tenant mode)
 */
export async function fastifyTenantTracking(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  if (!MULTI_TENANT) return;

  let tenantId: string = DEFAULT_TENANT_ID;

  // 1. Explicit header (highest priority)
  const headerTenant = request.headers["x-tenant-id"];
  if (typeof headerTenant === "string" && headerTenant.length > 0) {
    tenantId = headerTenant;
  }
  // 2. JWT payload (set by auth middleware)
  else if ((request as unknown as { tenantId?: string }).tenantId) {
    tenantId = (request as unknown as { tenantId: string }).tenantId;
  }

  // Validate and set schema name
  const schemaName = tenantId === DEFAULT_TENANT_ID
    ? DEFAULT_SCHEMA
    : tenantIdToSchemaName(tenantId);

  // Store in AsyncLocalStorage for downstream access
  tenantStorage.enterWith({ tenantId, tenantSchemaName: schemaName });

  // Attach to request for logging
  (request as unknown as { tenantId: string }).tenantId = tenantId;

  logger.debug({ tenantId, schema: schemaName }, "Tenant context set");
}

// ─── Tenant-Aware Query Helpers ───────────────────────────────────────────────

/**
 * Add tenant_id filter to a Drizzle query condition.
 * Usage: .where(and(eq(table.tenantId, withTenantFilter()), ...other conditions))
 */
export function withTenantFilter(): string {
  return getCurrentTenantId();
}

// ─── Tenant Rate Limits ───────────────────────────────────────────────────────

export interface TenantLimits {
  maxUsersPerTenant: number;
  maxKbsPerTenant: number;
  maxStorageMb: number;
  maxApiCallsPerDay: number;
  maxConnectors: number;
}

export const DEFAULT_TENANT_LIMITS: TenantLimits = {
  maxUsersPerTenant: 100,
  maxKbsPerTenant: 50,
  maxStorageMb: 10240, // 10 GB
  maxApiCallsPerDay: 100_000,
  maxConnectors: 20,
};

// ─── Tenant Invite Tracking ──────────────────────────────────────────────────

export interface TenantInvite {
  tenantId: string;
  email: string;
  role: string;
  invitedBy: number;
  expiresAt: Date;
}
