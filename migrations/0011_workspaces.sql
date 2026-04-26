-- Phase 1.18: Workspace System (AnythingLLM pattern)
CREATE TABLE IF NOT EXISTS workspaces (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug              TEXT NOT NULL,
  name              TEXT NOT NULL,
  description       TEXT,
  icon              TEXT,
  council_config    JSONB,
  master_config     JSONB,
  kb_id             UUID,
  system_prompt     TEXT,
  deliberation_mode TEXT DEFAULT 'standard',
  is_default        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ,
  UNIQUE(user_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_workspaces_user_id ON workspaces(user_id);
