-- Phase 9.4: Data Residency Controls (CockroachDB multi-region / Citus pattern)

CREATE TABLE IF NOT EXISTS "TenantDataResidency" (
  "id"                TEXT        PRIMARY KEY,
  "tenantId"          TEXT        NOT NULL UNIQUE REFERENCES "Tenant"("id") ON DELETE CASCADE,
  "primaryRegion"     TEXT        NOT NULL DEFAULT 'us-east-1',
  "secondaryRegions"  JSONB       NOT NULL DEFAULT '[]',
  "vectorNamespace"   TEXT,
  "storagePrefix"     TEXT,
  "dbReadEndpoint"    TEXT,
  "strictEnforcement" BOOLEAN     NOT NULL DEFAULT FALSE,
  "createdAt"         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS "TenantDataResidency_tenantId_key"
  ON "TenantDataResidency"("tenantId");

CREATE INDEX IF NOT EXISTS "TenantDataResidency_region_idx"
  ON "TenantDataResidency"("primaryRegion");

COMMENT ON TABLE "TenantDataResidency" IS
  'Per-tenant data-residency controls: primary + secondary regions, vector namespace, '
  'storage prefix, and read-endpoint overrides. Implements CockroachDB-style multi-region '
  'data domiciling at the application routing layer.';
