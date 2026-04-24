/**
 * Feature Flags — database schema for runtime feature toggles.
 */

import { pgTable, serial, text, timestamp, boolean, integer, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { userGroups } from "./userGroups.js";

/**
 * Feature flag definitions.
 */
export const featureFlags = pgTable("feature_flags", {
  id: serial("id").primaryKey(),
  /** Unique flag key (e.g., "dark_mode", "new_search_ui"). */
  key: text("key").notNull().unique(),
  /** Human-readable name. */
  name: text("name").notNull(),
  /** Description of what the flag controls. */
  description: text("description"),
  /** Global enabled state. */
  enabled: boolean("enabled").default(false).notNull(),
  /** Percentage rollout (0-100). Only applies when enabled=true. */
  rolloutPercent: integer("rollout_percent").default(100).notNull(),
  /** Flag type: boolean, percentage, variant */
  flagType: text("flag_type", { enum: ["boolean", "percentage", "variant"] }).default("boolean").notNull(),
  /** JSON variants for multivariate flags (e.g., {"control": 50, "treatment_a": 25, "treatment_b": 25}). */
  variants: jsonb("variants").$type<Record<string, number>>(),
  /** Environment scoping: "all", "production", "development", "staging". */
  environment: text("environment").default("all").notNull(),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/**
 * Per-user flag overrides — force a flag on/off for specific users.
 */
export const featureFlagUserOverrides = pgTable("feature_flag_user_overrides", {
  id: serial("id").primaryKey(),
  flagId: integer("flag_id")
    .notNull()
    .references(() => featureFlags.id, { onDelete: "cascade" }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull(),
  /** For variant flags, which variant to force. */
  variant: text("variant"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("ff_user_override_idx").on(table.flagId, table.userId),
]);

/**
 * Per-group flag overrides — enable/disable for entire groups.
 */
export const featureFlagGroupOverrides = pgTable("feature_flag_group_overrides", {
  id: serial("id").primaryKey(),
  flagId: integer("flag_id")
    .notNull()
    .references(() => featureFlags.id, { onDelete: "cascade" }),
  groupId: integer("group_id")
    .notNull()
    .references(() => userGroups.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("ff_group_override_idx").on(table.flagId, table.groupId),
]);
