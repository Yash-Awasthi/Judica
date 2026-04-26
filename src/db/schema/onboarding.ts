/**
 * Onboarding Wizard — database schema.
 *
 * Tracks per-user onboarding progress through the guided setup flow.
 * Modeled after Shepherd.js / React Joyride step-tracking patterns.
 *
 * Steps (in order):
 *   welcome          — landing screen
 *   provider_keys    — configure at least one LLM provider API key
 *   first_council    — choose archetypes / models for the first council
 *   sample_run       — run a sample deliberation
 *   explore          — highlight key features (memory, RAG, voice, etc.)
 *   complete         — wizard finished
 */

import {
  pgTable,
  serial,
  integer,
  text,
  boolean,
  timestamp,
  jsonb,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { users } from "./users.js";

// ─── Onboarding Step Enum ─────────────────────────────────────────────────────

export const ONBOARDING_STEPS = [
  "welcome",
  "provider_keys",
  "first_council",
  "sample_run",
  "explore",
  "complete",
] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

// ─── OnboardingState ──────────────────────────────────────────────────────────

export const onboardingStates = pgTable(
  "OnboardingState",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId")
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Current step the user is on (or "complete" if finished). */
    currentStep: text("currentStep")
      .$type<OnboardingStep>()
      .default("welcome")
      .notNull(),
    /** Steps the user has completed, as a JSON array of step names. */
    completedSteps: jsonb("completedSteps")
      .$type<OnboardingStep[]>()
      .default([])
      .notNull(),
    /** Whether the onboarding is fully done (wizard dismissed permanently). */
    completed: boolean("completed").default(false).notNull(),
    /** Whether the user manually skipped the wizard. */
    skipped: boolean("skipped").default(false).notNull(),
    /**
     * Arbitrary per-step metadata (e.g., which provider key was set,
     * which archetypes were picked).  Keyed by step name.
     */
    stepData: jsonb("stepData")
      .$type<Partial<Record<OnboardingStep, Record<string, unknown>>>>()
      .default({})
      .notNull(),
    startedAt: timestamp("startedAt", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completedAt", { withTimezone: true }),
    updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("OnboardingState_userId_key").on(table.userId),
  ],
);

export type OnboardingState = typeof onboardingStates.$inferSelect;
export type NewOnboardingState = typeof onboardingStates.$inferInsert;
