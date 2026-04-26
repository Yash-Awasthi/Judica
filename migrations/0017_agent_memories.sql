-- Phase 2.10: Agent-Level Memory Scope (mem0 multi-level memory)
CREATE TABLE IF NOT EXISTS agent_memories (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL,
  agent_id        TEXT NOT NULL,
  agent_label     TEXT,
  fact            TEXT NOT NULL,
  confidence      REAL DEFAULT 1.0,
  decay_score     REAL DEFAULT 1.0,
  conversation_id TEXT,
  created_at      TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at      TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_memories_user_agent ON agent_memories(user_id, agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_memories_decay      ON agent_memories(user_id, decay_score DESC);
