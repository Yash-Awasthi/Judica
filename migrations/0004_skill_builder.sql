-- Phase 1.3: Custom skill builder (Dify tool builder pattern)
-- Adds language, version, inputSchema, publishedToMarketplace, updatedAt to UserSkill
ALTER TABLE "UserSkill"
  ADD COLUMN IF NOT EXISTS "language" text NOT NULL DEFAULT 'python',
  ADD COLUMN IF NOT EXISTS "version" text NOT NULL DEFAULT '1.0.0',
  ADD COLUMN IF NOT EXISTS "inputSchema" jsonb,
  ADD COLUMN IF NOT EXISTS "publishedToMarketplace" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "updatedAt" timestamp with time zone DEFAULT now();
