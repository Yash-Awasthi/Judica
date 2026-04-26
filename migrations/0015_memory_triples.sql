-- Phase 2.2: Triple-Store Memory (RDF/Zep/MemGPT pattern)
CREATE TABLE IF NOT EXISTS memory_triples (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject         TEXT NOT NULL,
  predicate       TEXT NOT NULL,
  object          TEXT NOT NULL,
  confidence      REAL NOT NULL DEFAULT 1.0,
  conversation_id UUID,
  observed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_memory_triples_user_subj ON memory_triples(user_id, subject);
CREATE INDEX IF NOT EXISTS idx_memory_triples_user_pred ON memory_triples(user_id, predicate);
