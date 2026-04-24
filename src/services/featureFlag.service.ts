/**
 * Feature Flag Service — evaluate flags with user/group override resolution.
 *
 * Resolution order:
 *   1. Per-user override
 *   2. Per-group override (any group the user belongs to)
 *   3. Global flag state + rollout percentage
 */

import { db } from "../lib/drizzle.js";
import { featureFlags, featureFlagUserOverrides, featureFlagGroupOverrides } from "../db/schema/featureFlags.js";
import { userGroupMembers } from "../db/schema/userGroups.js";
import { eq, and, inArray } from "drizzle-orm";
import { createHash } from "node:crypto";
import redis from "../lib/redis.js";
import logger from "../lib/logger.js";

const log = logger.child({ service: "feature-flags" });

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FlagEvaluation {
  key: string;
  enabled: boolean;
  variant?: string;
  source: "user_override" | "group_override" | "rollout" | "global" | "default";
}

export interface FeatureFlagDef {
  id: number;
  key: string;
  name: string;
  description: string | null;
  enabled: boolean;
  rolloutPercent: number;
  flagType: string;
  variants: Record<string, number> | null;
  environment: string;
}

// ─── Flag Cache ───────────────────────────────────────────────────────────────

const FLAG_CACHE_TTL = 60; // seconds

async function getCachedFlag(key: string): Promise<FeatureFlagDef | null | undefined> {
  const cached = await redis.get(`ff:${key}`);
  if (cached === "__null__") return null; // Negative cache
  if (cached) return JSON.parse(cached) as FeatureFlagDef;
  return undefined; // Cache miss
}

async function setCachedFlag(key: string, flag: FeatureFlagDef | null): Promise<void> {
  await redis.set(`ff:${key}`, flag ? JSON.stringify(flag) : "__null__", { EX: FLAG_CACHE_TTL });
}

// ─── Evaluate Flag ────────────────────────────────────────────────────────────

export async function evaluateFlag(flagKey: string, userId?: number): Promise<FlagEvaluation> {
  // Load flag definition
  let flag = await getCachedFlag(flagKey);
  if (flag === undefined) {
    const [row] = await db.select().from(featureFlags).where(eq(featureFlags.key, flagKey)).limit(1);
    flag = row as FeatureFlagDef | null;
    await setCachedFlag(flagKey, flag);
  }

  if (!flag) {
    return { key: flagKey, enabled: false, source: "default" };
  }

  // Check environment
  const currentEnv = process.env.NODE_ENV ?? "development";
  if (flag.environment !== "all" && flag.environment !== currentEnv) {
    return { key: flagKey, enabled: false, source: "default" };
  }

  // If flag is globally disabled, it's off
  if (!flag.enabled) {
    return { key: flagKey, enabled: false, source: "global" };
  }

  if (userId) {
    // 1. Check per-user override
    const [userOverride] = await db
      .select()
      .from(featureFlagUserOverrides)
      .where(and(eq(featureFlagUserOverrides.flagId, flag.id), eq(featureFlagUserOverrides.userId, userId)))
      .limit(1);

    if (userOverride) {
      return {
        key: flagKey,
        enabled: userOverride.enabled,
        variant: userOverride.variant ?? undefined,
        source: "user_override",
      };
    }

    // 2. Check group overrides
    const memberships = await db
      .select({ groupId: userGroupMembers.groupId })
      .from(userGroupMembers)
      .where(eq(userGroupMembers.userId, userId));

    if (memberships.length > 0) {
      const groupIds = memberships.map((m) => m.groupId);
      const groupOverrides = await db
        .select()
        .from(featureFlagGroupOverrides)
        .where(and(
          eq(featureFlagGroupOverrides.flagId, flag.id),
          inArray(featureFlagGroupOverrides.groupId, groupIds),
        ));

      // Any group enabling it wins
      const enabledOverride = groupOverrides.find((o) => o.enabled);
      if (enabledOverride) {
        return { key: flagKey, enabled: true, source: "group_override" };
      }
      // If any group explicitly disabled it
      if (groupOverrides.length > 0) {
        return { key: flagKey, enabled: false, source: "group_override" };
      }
    }

    // 3. Percentage rollout (deterministic hash based on userId + flagKey)
    if (flag.rolloutPercent < 100) {
      const bucket = deterministicBucket(userId, flagKey);
      const enabled = bucket < flag.rolloutPercent;
      return { key: flagKey, enabled, source: "rollout" };
    }
  }

  // 4. Global enabled
  return { key: flagKey, enabled: true, source: "global" };
}

/**
 * Evaluate all flags for a user — useful for frontend bootstrapping.
 */
export async function evaluateAllFlags(userId?: number): Promise<Record<string, FlagEvaluation>> {
  const allFlags = await db.select().from(featureFlags);
  const result: Record<string, FlagEvaluation> = {};

  for (const flag of allFlags) {
    result[flag.key] = await evaluateFlag(flag.key, userId);
  }

  return result;
}

/**
 * Deterministic percentage bucketing using hash(userId:flagKey).
 * Returns 0-99.
 */
function deterministicBucket(userId: number, flagKey: string): number {
  const hash = createHash("md5").update(`${userId}:${flagKey}`).digest();
  return hash.readUInt16BE(0) % 100;
}

// ─── Admin CRUD ───────────────────────────────────────────────────────────────

export async function listFlags(): Promise<FeatureFlagDef[]> {
  return db.select().from(featureFlags) as Promise<FeatureFlagDef[]>;
}

export async function createFlag(flag: Omit<FeatureFlagDef, "id">): Promise<FeatureFlagDef> {
  const [created] = await db.insert(featureFlags).values(flag).returning();
  log.info({ key: flag.key }, "Feature flag created");
  return created as FeatureFlagDef;
}

export async function updateFlag(id: number, updates: Partial<FeatureFlagDef>): Promise<FeatureFlagDef | null> {
  const [updated] = await db
    .update(featureFlags)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(featureFlags.id, id))
    .returning();
  if (updated) {
    await redis.del(`ff:${updated.key}`); // Invalidate cache
    log.info({ id, key: updated.key }, "Feature flag updated");
  }
  return (updated as FeatureFlagDef) ?? null;
}

export async function deleteFlag(id: number): Promise<boolean> {
  const [deleted] = await db.delete(featureFlags).where(eq(featureFlags.id, id)).returning();
  if (deleted) {
    await redis.del(`ff:${deleted.key}`);
    log.info({ id, key: deleted.key }, "Feature flag deleted");
  }
  return !!deleted;
}

export async function setUserOverride(flagId: number, userId: number, enabled: boolean, variant?: string): Promise<void> {
  await db
    .insert(featureFlagUserOverrides)
    .values({ flagId, userId, enabled, variant })
    .onConflictDoUpdate({
      target: [featureFlagUserOverrides.flagId, featureFlagUserOverrides.userId],
      set: { enabled, variant },
    });
}

export async function removeUserOverride(flagId: number, userId: number): Promise<void> {
  await db
    .delete(featureFlagUserOverrides)
    .where(and(eq(featureFlagUserOverrides.flagId, flagId), eq(featureFlagUserOverrides.userId, userId)));
}

export async function setGroupOverride(flagId: number, groupId: number, enabled: boolean): Promise<void> {
  await db
    .insert(featureFlagGroupOverrides)
    .values({ flagId, groupId, enabled })
    .onConflictDoUpdate({
      target: [featureFlagGroupOverrides.flagId, featureFlagGroupOverrides.groupId],
      set: { enabled },
    });
}

export async function removeGroupOverride(flagId: number, groupId: number): Promise<void> {
  await db
    .delete(featureFlagGroupOverrides)
    .where(and(eq(featureFlagGroupOverrides.flagId, flagId), eq(featureFlagGroupOverrides.groupId, groupId)));
}
