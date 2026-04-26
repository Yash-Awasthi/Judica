-- Phase 1.15: OpenAPI Tool Definitions
CREATE TABLE IF NOT EXISTS openapi_tools (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT NOT NULL,
  method      TEXT NOT NULL DEFAULT 'POST',
  url         TEXT NOT NULL,
  parameters  JSONB NOT NULL,
  meta        JSONB,
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_openapi_tools_user_id ON openapi_tools(user_id);
