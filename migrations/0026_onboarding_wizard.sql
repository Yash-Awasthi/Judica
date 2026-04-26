-- Phase 9.7: Onboarding Wizard (Shepherd.js / React Joyride pattern)

CREATE TABLE IF NOT EXISTS "OnboardingState" (
  "id"             SERIAL      PRIMARY KEY,
  "userId"         INTEGER     NOT NULL UNIQUE REFERENCES "User"("id") ON DELETE CASCADE,
  "currentStep"    TEXT        NOT NULL DEFAULT 'welcome',
  "completedSteps" JSONB       NOT NULL DEFAULT '[]',
  "completed"      BOOLEAN     NOT NULL DEFAULT FALSE,
  "skipped"        BOOLEAN     NOT NULL DEFAULT FALSE,
  "stepData"       JSONB       NOT NULL DEFAULT '{}',
  "startedAt"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "completedAt"    TIMESTAMPTZ,
  "updatedAt"      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS "OnboardingState_userId_key"
  ON "OnboardingState"("userId");

COMMENT ON TABLE "OnboardingState" IS
  'Per-user onboarding wizard progress. Tracks which setup steps have been '
  'completed and stores step-specific metadata (provider keys set, archetypes '
  'chosen, etc.). Modeled after Shepherd.js / React Joyride step-tracking.';
