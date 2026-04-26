-- Phase 3.6: Sandbox Artifact Browser — extend existing artifacts with file storage columns
-- (Open Interpreter / E2B / Anthropic Artifacts pattern)
ALTER TABLE "Artifact" ADD COLUMN IF NOT EXISTS storage_key  TEXT;
ALTER TABLE "Artifact" ADD COLUMN IF NOT EXISTS storage_url  TEXT;
ALTER TABLE "Artifact" ADD COLUMN IF NOT EXISTS size_bytes   BIGINT DEFAULT 0;
ALTER TABLE "Artifact" ADD COLUMN IF NOT EXISTS is_public    BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE "Artifact" ADD COLUMN IF NOT EXISTS source_code  TEXT;

CREATE INDEX IF NOT EXISTS idx_artifact_user_type ON "Artifact"("userId", type);
