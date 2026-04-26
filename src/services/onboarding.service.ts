/**
 * Onboarding Wizard Service
 *
 * Modeled after Shepherd.js / React Joyride guided-tour patterns:
 * - Step-based progress tracking persisted to DB
 * - Idempotent step completion (completing the same step twice is harmless)
 * - Step metadata storage for personalisation (which provider key was added, etc.)
 * - Skip / dismiss support
 *
 * Steps (in order):
 *   welcome → provider_keys → first_council → sample_run → explore → complete
 */

import { db } from "../lib/drizzle.js";
import { onboardingStates, ONBOARDING_STEPS } from "../db/schema/onboarding.js";
import type { OnboardingStep } from "../db/schema/onboarding.js";
import { eq } from "drizzle-orm";
import logger from "../lib/logger.js";

const log = logger.child({ service: "onboarding" });

// ─── Get or create state ──────────────────────────────────────────────────────

export async function getOrCreateState(
  userId: number,
): Promise<typeof onboardingStates.$inferSelect> {
  const [existing] = await db
    .select()
    .from(onboardingStates)
    .where(eq(onboardingStates.userId, userId))
    .limit(1);

  if (existing) return existing;

  const [created] = await db
    .insert(onboardingStates)
    .values({ userId })
    .returning();

  log.info({ userId }, "Onboarding state initialised");
  return created;
}

// ─── Complete a step ──────────────────────────────────────────────────────────

/**
 * Mark a step as completed.  Advances currentStep to the next step in sequence.
 * Idempotent — completing the same step twice is a no-op.
 *
 * @param userId  The user completing the step
 * @param step    The step that was just completed
 * @param meta    Optional step-specific data (e.g. { providerKey: "openai" })
 */
export async function completeStep(
  userId: number,
  step: OnboardingStep,
  meta?: Record<string, unknown>,
): Promise<typeof onboardingStates.$inferSelect> {
  const state = await getOrCreateState(userId);

  // Already completed this step — idempotent
  if ((state.completedSteps as OnboardingStep[]).includes(step)) return state;

  const completedSteps = [...(state.completedSteps as OnboardingStep[]), step];
  const stepData = {
    ...(state.stepData as Record<string, unknown>),
    ...(meta ? { [step]: meta } : {}),
  };

  // Advance to the next step
  const currentIdx = ONBOARDING_STEPS.indexOf(step);
  const nextStep: OnboardingStep =
    currentIdx >= 0 && currentIdx < ONBOARDING_STEPS.length - 1
      ? ONBOARDING_STEPS[currentIdx + 1]
      : "complete";

  const isComplete = nextStep === "complete" || step === "complete";

  const [updated] = await db
    .update(onboardingStates)
    .set({
      completedSteps,
      stepData,
      currentStep: nextStep,
      completed: isComplete,
      completedAt: isComplete ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(onboardingStates.userId, userId))
    .returning();

  log.info({ userId, step, nextStep, isComplete }, "Onboarding step completed");
  return updated;
}

// ─── Skip wizard ──────────────────────────────────────────────────────────────

export async function skipOnboarding(
  userId: number,
): Promise<typeof onboardingStates.$inferSelect> {
  await getOrCreateState(userId);

  const [updated] = await db
    .update(onboardingStates)
    .set({ skipped: true, updatedAt: new Date() })
    .where(eq(onboardingStates.userId, userId))
    .returning();

  log.info({ userId }, "Onboarding skipped");
  return updated;
}

// ─── Reset wizard (admin / testing) ──────────────────────────────────────────

export async function resetOnboarding(userId: number): Promise<void> {
  await db.delete(onboardingStates).where(eq(onboardingStates.userId, userId));
  log.info({ userId }, "Onboarding state reset");
}

// ─── Summary ──────────────────────────────────────────────────────────────────

/**
 * Returns a concise summary of the user's onboarding progress, suitable for
 * the frontend wizard component (Shepherd.js / Joyride integration).
 */
export async function getOnboardingSummary(userId: number): Promise<{
  currentStep: OnboardingStep;
  completedSteps: OnboardingStep[];
  completed: boolean;
  skipped: boolean;
  progressPercent: number;
  steps: Array<{ id: OnboardingStep; label: string; completed: boolean; current: boolean }>;
}> {
  const state = await getOrCreateState(userId);

  const STEP_LABELS: Record<OnboardingStep, string> = {
    welcome: "Welcome",
    provider_keys: "Connect an AI Provider",
    first_council: "Configure Your First Council",
    sample_run: "Run a Sample Deliberation",
    explore: "Explore Features",
    complete: "Done",
  };

  const completed = state.completedSteps as OnboardingStep[];
  const progressPercent =
    state.completed
      ? 100
      : Math.round((completed.length / (ONBOARDING_STEPS.length - 1)) * 100);

  return {
    currentStep: state.currentStep as OnboardingStep,
    completedSteps: completed,
    completed: state.completed,
    skipped: state.skipped,
    progressPercent,
    steps: ONBOARDING_STEPS.map((s) => ({
      id: s,
      label: STEP_LABELS[s],
      completed: completed.includes(s),
      current: state.currentStep === s,
    })),
  };
}
