-- Phase 1.26: Prompt Favourites (TypingMind pattern)
CREATE TABLE IF NOT EXISTS prompt_favourites (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  prompt       TEXT NOT NULL,
  folder       TEXT,
  tags         TEXT[],
  use_count    INTEGER NOT NULL DEFAULT 0,
  is_pinned    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_prompt_favourites_user_id ON prompt_favourites(user_id);
