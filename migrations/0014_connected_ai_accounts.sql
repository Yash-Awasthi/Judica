-- Phase 1.28: Connected AI Accounts (GodMode/Passport.js pattern)
CREATE TABLE IF NOT EXISTS connected_ai_accounts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider          TEXT NOT NULL,
  label             TEXT NOT NULL,
  api_key_encrypted TEXT NOT NULL,
  base_url          TEXT,
  default_model     TEXT,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  last_used_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_connected_ai_accounts_user_id ON connected_ai_accounts(user_id);
