-- Phase 3.1: Custom Connector Builder (Nango/Airbyte pattern)
CREATE TABLE IF NOT EXISTS custom_connectors (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  base_url    TEXT NOT NULL,
  auth_type   TEXT NOT NULL DEFAULT 'none',
  auth_config JSONB DEFAULT '{}',
  endpoints   JSONB DEFAULT '[]',
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  version     INTEGER NOT NULL DEFAULT 1,
  created_at  TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at  TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_custom_connectors_user_id ON custom_connectors(user_id);
