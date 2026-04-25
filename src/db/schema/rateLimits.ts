/**
 * Token Rate Limits — configurable rate limits per user, group, and global defaults.
 */

import { pgTable, serial, text, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { userGroups } from "./userGroups.js";

/**
 * Rate limit tiers — named configurations (e.g., "free", "pro", "enterprise").
 */
export const rateLimitTiers = pgTable("rate_limit_tiers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  /** Requests per minute */
  requestsPerMinute: integer("requests_per_minute").notNull().default(60),
  /** Requests per hour */
  requestsPerHour: integer("requests_per_hour").notNull().default(1000),
  /** Requests per day */
  requestsPerDay: integer("requests_per_day").notNull().default(10000),
  /** Max tokens (LLM) per minute */
  tokensPerMinute: integer("tokens_per_minute").notNull().default(100000),
  /** Max tokens (LLM) per day */
  tokensPerDay: integer("tokens_per_day").notNull().default(1000000),
  /** Max concurrent requests */
  maxConcurrent: integer("max_concurrent").notNull().default(5),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/**
 * Per-user rate limit overrides — assign a tier to a specific user.
 */
export const userRateLimits = pgTable("user_rate_limits", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tierId: integer("tier_id")
    .notNull()
    .references(() => rateLimitTiers.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("user_rate_limits_user_id_idx").on(table.userId),
]);

/**
 * Per-group rate limit overrides — assign a tier to an entire group.
 */
export const groupRateLimits = pgTable("group_rate_limits", {
  id: serial("id").primaryKey(),
  groupId: integer("group_id")
    .notNull()
    .references(() => userGroups.id, { onDelete: "cascade" }),
  tierId: integer("tier_id")
    .notNull()
    .references(() => rateLimitTiers.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("group_rate_limits_group_id_idx").on(table.groupId),
]);
