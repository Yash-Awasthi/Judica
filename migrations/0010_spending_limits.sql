-- Phase 1.16: LLM Spending Limits (Onyx EE pattern)
CREATE TABLE IF NOT EXISTS spending_limits (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  cap_usd           REAL NOT NULL,
  period            TEXT NOT NULL DEFAULT 'monthly',
  current_spend_usd REAL NOT NULL DEFAULT 0,
  period_resets_at  TIMESTAMPTZ NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
