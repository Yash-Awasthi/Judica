-- Phase 2.8: Goal Documents (Cursor .cursorrules / CLAUDE.md pattern)
CREATE TABLE IF NOT EXISTS goal_documents (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  title      TEXT NOT NULL DEFAULT 'My Goal Document',
  content    TEXT NOT NULL,
  is_active  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_goal_documents_user_id ON goal_documents(user_id);
CREATE INDEX IF NOT EXISTS idx_goal_documents_active  ON goal_documents(user_id, is_active) WHERE is_active = TRUE;
