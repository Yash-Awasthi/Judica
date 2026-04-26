-- Phase 4.1: Build Tab Task Graph (CrewAI pattern)
CREATE TABLE IF NOT EXISTS build_tasks (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL,
  conversation_id TEXT,
  parent_id       INTEGER,
  title           TEXT NOT NULL,
  description     TEXT,
  status          TEXT NOT NULL DEFAULT 'planned',
  claimed_by      TEXT,
  claimed_at      TIMESTAMP,
  output          TEXT,
  submitted_at    TIMESTAMP,
  is_locked       BOOLEAN NOT NULL DEFAULT FALSE,
  meta            JSONB DEFAULT '{}',
  created_at      TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at      TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_build_tasks_user_id   ON build_tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_build_tasks_parent_id ON build_tasks(parent_id);
CREATE INDEX IF NOT EXISTS idx_build_tasks_status    ON build_tasks(user_id, status);
