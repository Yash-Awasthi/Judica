-- Phase 1.7: Conversation branches (Loom tree-based branching pattern)
-- Each branch is a fork from a specific message in a parent conversation.
CREATE TABLE IF NOT EXISTS "ConversationBranch" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "parentConversationId" text NOT NULL,
  "branchPointMessageId" text,          -- message ID where the fork starts
  "title" text,                          -- optional user-set branch label
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "userId" integer NOT NULL REFERENCES "User"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "ConversationBranch_userId_parentConvId_idx"
  ON "ConversationBranch" ("userId", "parentConversationId");
