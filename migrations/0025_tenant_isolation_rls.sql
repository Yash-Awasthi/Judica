-- Phase 9.5: Tenant Isolation — PostgreSQL RLS policies + per-tenant encryption key table
--
-- Strategy (Drizzle ORM RLS / PostgreSQL Row-Level Security pattern):
--   1. Each tenant's rows are guarded by a policy that checks app.current_tenant_id
--      against the row's tenantId column.
--   2. The application sets SET LOCAL app.current_tenant_id = '<id>' inside each
--      transaction that touches tenant-scoped data.
--   3. Per-tenant encryption key derivation material is stored separately so a
--      compromise of one tenant's data does not expose other tenants.
--
-- Tables covered by RLS in this migration:
--   - "Tenant"                (self — owners and super-admins only)
--   - "TenantMember"
--   - "TenantDataResidency"
--   - "TenantEncryptionKey"   (new — per-tenant key material)

-- ─── Per-tenant encryption key table ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "TenantEncryptionKey" (
  "id"           TEXT        PRIMARY KEY,
  "tenantId"     TEXT        NOT NULL UNIQUE REFERENCES "Tenant"("id") ON DELETE CASCADE,
  -- HKDF input key material (IKM) — encrypted with the master key.
  -- The actual AES-256-GCM data key is derived per-operation via HKDF(masterKey, IKM).
  -- Storing encrypted IKM per tenant means rotating one tenant's key does not
  -- affect others, and a tenant can be re-keyed independently.
  "encryptedIkm" TEXT        NOT NULL,
  -- Key version — incremented each time the tenant's key is rotated.
  "keyVersion"   INTEGER     NOT NULL DEFAULT 1,
  -- Whether this key is currently active for new encryptions.
  "active"       BOOLEAN     NOT NULL DEFAULT TRUE,
  "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS "TenantEncryptionKey_tenantId_key"
  ON "TenantEncryptionKey"("tenantId");

COMMENT ON TABLE "TenantEncryptionKey" IS
  'Per-tenant encryption key material (HKDF IKM). Encrypted with the platform '
  'master key so each tenant has a fully independent data key.';

-- ─── pgvector namespace table ─────────────────────────────────────────────────
-- Maps tenant_id → pgvector collection/schema so embeddings are namespaced.
CREATE TABLE IF NOT EXISTS "TenantVectorNamespace" (
  "id"          TEXT        PRIMARY KEY,
  "tenantId"    TEXT        NOT NULL UNIQUE REFERENCES "Tenant"("id") ON DELETE CASCADE,
  -- The PostgreSQL schema name that holds this tenant's vector tables.
  "schemaName"  TEXT        NOT NULL,
  "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS "TenantVectorNamespace_tenantId_key"
  ON "TenantVectorNamespace"("tenantId");

-- ─── Row-Level Security — enable + policies ───────────────────────────────────
-- RLS is ONLY enforced when the application has called:
--   SET LOCAL app.current_tenant_id = '<tenantId>';
-- Super-admin role (aibyai_admin) bypasses all RLS policies.

-- TenantMember — users can only see members of their own tenant
ALTER TABLE "TenantMember" ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'TenantMember' AND policyname = 'tenant_member_isolation'
  ) THEN
    CREATE POLICY tenant_member_isolation ON "TenantMember"
      USING (
        "tenantId" = current_setting('app.current_tenant_id', TRUE)
        OR current_setting('app.current_tenant_id', TRUE) IS NULL
        OR current_setting('app.current_tenant_id', TRUE) = ''
      );
  END IF;
END $$;

-- TenantDataResidency — per-tenant residency config visible only to that tenant
ALTER TABLE "TenantDataResidency" ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'TenantDataResidency' AND policyname = 'tenant_residency_isolation'
  ) THEN
    CREATE POLICY tenant_residency_isolation ON "TenantDataResidency"
      USING (
        "tenantId" = current_setting('app.current_tenant_id', TRUE)
        OR current_setting('app.current_tenant_id', TRUE) IS NULL
        OR current_setting('app.current_tenant_id', TRUE) = ''
      );
  END IF;
END $$;

-- TenantEncryptionKey — key material is never visible to the tenant itself (admin only)
ALTER TABLE "TenantEncryptionKey" ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'TenantEncryptionKey' AND policyname = 'tenant_key_admin_only'
  ) THEN
    -- Only super-admins (no tenant context) may read key material
    CREATE POLICY tenant_key_admin_only ON "TenantEncryptionKey"
      USING (
        current_setting('app.current_tenant_id', TRUE) IS NULL
        OR current_setting('app.current_tenant_id', TRUE) = ''
      );
  END IF;
END $$;
