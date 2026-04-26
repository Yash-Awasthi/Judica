-- Phase 1.8: Editable memory facts (mem0 CRUD pattern)
-- Separate from the vector Memory table (for RAG chunks).
-- These are user-editable short facts extracted from conversations.
CREATE TABLE IF NOT EXISTS "MemoryFact" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" integer NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "fact" text NOT NULL,
  "tags" text[] NOT NULL DEFAULT '{}',
  "source" text,              -- "extracted" | "manual" | "agent"
  "conversationId" text,      -- conversation this was extracted from
  "decayScore" real NOT NULL DEFAULT 1.0,   -- 1.0 = fresh; decays toward 0
  "lastConfirmedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "isShared" boolean NOT NULL DEFAULT false  -- Phase 2.3: cross-chat sharing
);

CREATE INDEX IF NOT EXISTS "MemoryFact_userId_idx" ON "MemoryFact" ("userId");
CREATE INDEX IF NOT EXISTS "MemoryFact_userId_decayScore_idx" ON "MemoryFact" ("userId", "decayScore");
