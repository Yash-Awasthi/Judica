-- Phase 4.19: Agent Action Audit Log (Agno pattern)
CREATE TABLE IF NOT EXISTS agent_action_logs (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL,
  agent_id    TEXT NOT NULL,           -- archetype id (e.g. 'researcher', 'critic')
  action      TEXT NOT NULL,           -- claim_task | release_task | submit_task | review | steal | llm_call | …
  entity_type TEXT,                    -- build_task | workflow | conversation | …
  entity_id   TEXT,                    -- id of the affected entity
  meta        JSONB DEFAULT '{}',      -- action-specific data
  duration_ms INTEGER,
  status      TEXT NOT NULL DEFAULT 'success',  -- success | error | skipped
  error       TEXT,
  created_at  TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_aal_user_id   ON agent_action_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_aal_agent_id  ON agent_action_logs(agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_aal_action    ON agent_action_logs(action, created_at DESC);
