-- Phase 1.12: Hypothesis Tracker (Metaculus/Fatebook pattern)
CREATE TABLE IF NOT EXISTS hypotheses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
  claim       TEXT NOT NULL,
  probability REAL NOT NULL DEFAULT 0.5,
  current_probability REAL NOT NULL DEFAULT 0.5,
  status      TEXT NOT NULL DEFAULT 'open',
  resolution_note TEXT,
  conversation_id UUID,
  resolve_by  TIMESTAMPTZ,
  tags        TEXT[],
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  is_public   BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_hypotheses_user_id ON hypotheses(user_id);
CREATE INDEX IF NOT EXISTS idx_hypotheses_status ON hypotheses(status);
