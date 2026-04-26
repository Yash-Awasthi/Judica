-- Phase 1.22: Session Templates (TypingMind / Open WebUI pattern)
CREATE TABLE IF NOT EXISTS session_templates (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  description  TEXT,
  icon         TEXT,
  config       JSONB NOT NULL DEFAULT '{}',
  is_public    BOOLEAN NOT NULL DEFAULT FALSE,
  usage_count  INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_session_templates_user_id ON session_templates(user_id);
