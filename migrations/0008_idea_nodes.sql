-- Phase 1.13: Idea Evolution Tree (Markmap/D3.js pattern)
CREATE TABLE IF NOT EXISTS idea_nodes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         INTEGER REFERENCES users(id) ON DELETE CASCADE,
  parent_id       UUID REFERENCES idea_nodes(id) ON DELETE SET NULL,
  label           TEXT NOT NULL,
  content         TEXT,
  conversation_id UUID,
  meta            JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_idea_nodes_user_id ON idea_nodes(user_id);
CREATE INDEX IF NOT EXISTS idx_idea_nodes_parent_id ON idea_nodes(parent_id);
