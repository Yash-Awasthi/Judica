-- Phase 4.10: Workflow Execution Logs (step-level events)
CREATE TABLE IF NOT EXISTS workflow_run_logs (
  id          SERIAL PRIMARY KEY,
  run_id      TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  user_id     INTEGER NOT NULL,
  node_id     TEXT,
  node_type   TEXT,
  event_type  TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'info',  -- info | success | error | warning
  message     TEXT,
  data        JSONB DEFAULT '{}',
  duration_ms INTEGER,
  created_at  TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wrl_run_id   ON workflow_run_logs(run_id);
CREATE INDEX IF NOT EXISTS idx_wrl_user_id  ON workflow_run_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wrl_workflow ON workflow_run_logs(workflow_id, created_at DESC);
