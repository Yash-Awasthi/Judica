/**
 * Token Rate Limit Service — resolves and enforces per-user/group rate limits.
 *
 * Resolution order:
 *   1. Per-user tier override
 *   2. Highest tier from user's groups
 *   3. Global default tier ("default")
 *
 * Enforcement uses Redis sliding window counters.
 */

import { db } from "../lib/drizzle.js";
import { rateLimitTiers, userRateLimits, groupRateLimits } from "../db/schema/rateLimits.js";
import { userGroupMembers } from "../db/schema/userGroups.js";
import { eq, inArray } from "drizzle-orm";
import redis from "../lib/redis.js";
import logger from "../lib/logger.js";

const log = logger.child({ service: "rateLimit" });

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RateLimitTier {
  id: number;
  name: string;
  requestsPerMinute: number;
  requestsPerHour: number;
  requestsPerDay: number;
  tokensPerMinute: number;
  tokensPerDay: number;
  maxConcurrent: number;
}

export interface RateLimitStatus {
  allowed: boolean;
  tier: string;
  limits: {
    requestsPerMinute: { limit: number; remaining: number; reset: number };
    requestsPerHour: { limit: number; remaining: number; reset: number };
    requestsPerDay: { limit: number; remaining: number; reset: number };
  };
  retryAfter?: number;
}

// ─── Default Tier ─────────────────────────────────────────────────────────────

const DEFAULT_TIER: RateLimitTier = {
  id: 0,
  name: "default",
  requestsPerMinute: 60,
  requestsPerHour: 1000,
  requestsPerDay: 10000,
  tokensPerMinute: 100000,
  tokensPerDay: 1000000,
  maxConcurrent: 5,
};

// Cache tiers for 5 minutes
let tierCache: Map<number, RateLimitTier> = new Map();
let tierCacheExpiry = 0;

async function loadTiers(): Promise<Map<number, RateLimitTier>> {
  if (Date.now() < tierCacheExpiry && tierCache.size > 0) return tierCache;

  const tiers = await db.select().from(rateLimitTiers);
  tierCache = new Map(tiers.map((t) => [t.id, t as RateLimitTier]));
  tierCacheExpiry = Date.now() + 300000;
  return tierCache;
}

// ─── Resolve Tier for User ────────────────────────────────────────────────────

export async function resolveUserTier(userId: number): Promise<RateLimitTier> {
  const tiers = await loadTiers();

  // 1. Check per-user override
  const [userOverride] = await db
    .select()
    .from(userRateLimits)
    .where(eq(userRateLimits.userId, userId))
    .limit(1);

  if (userOverride) {
    const tier = tiers.get(userOverride.tierId);
    if (tier) return tier;
  }

  // 2. Check group tiers — pick the most permissive (highest requestsPerMinute)
  const memberships = await db
    .select({ groupId: userGroupMembers.groupId })
    .from(userGroupMembers)
    .where(eq(userGroupMembers.userId, userId));

  if (memberships.length > 0) {
    const groupIds = memberships.map((m) => m.groupId);
    const groupLimits = await db
      .select()
      .from(groupRateLimits)
      .where(inArray(groupRateLimits.groupId, groupIds));

    let bestTier: RateLimitTier | null = null;
    for (const gl of groupLimits) {
      const tier = tiers.get(gl.tierId);
      if (tier && (!bestTier || tier.requestsPerMinute > bestTier.requestsPerMinute)) {
        bestTier = tier;
      }
    }
    if (bestTier) return bestTier;
  }

  // 3. Fall back to default
  const defaultFromDb = [...tiers.values()].find((t) => t.name === "default");
  return defaultFromDb ?? DEFAULT_TIER;
}

// ─── Check Rate Limit ─────────────────────────────────────────────────────────

export async function checkRateLimit(userId: number): Promise<RateLimitStatus> {
  const tier = await resolveUserTier(userId);
  const now = Math.floor(Date.now() / 1000);

  const minuteKey = `rl:${userId}:min:${Math.floor(now / 60)}`;
  const hourKey = `rl:${userId}:hr:${Math.floor(now / 3600)}`;
  const dayKey = `rl:${userId}:day:${Math.floor(now / 86400)}`;

  const pipe = redis.pipeline();
  pipe.incr(minuteKey);
  pipe.expire(minuteKey, 120);
  pipe.incr(hourKey);
  pipe.expire(hourKey, 7200);
  pipe.incr(dayKey);
  pipe.expire(dayKey, 172800);
  const results = await pipe.exec();

  const minuteCount = (results?.[0]?.[1] as number) ?? 0;
  const hourCount = (results?.[2]?.[1] as number) ?? 0;
  const dayCount = (results?.[4]?.[1] as number) ?? 0;

  const minuteRemaining = Math.max(0, tier.requestsPerMinute - minuteCount);
  const hourRemaining = Math.max(0, tier.requestsPerHour - hourCount);
  const dayRemaining = Math.max(0, tier.requestsPerDay - dayCount);

  const exceeded =
    minuteCount > tier.requestsPerMinute ||
    hourCount > tier.requestsPerHour ||
    dayCount > tier.requestsPerDay;

  if (exceeded) {
    let retryAfter = 60;
    if (minuteCount > tier.requestsPerMinute) {
      retryAfter = 60 - (now % 60);
    } else if (hourCount > tier.requestsPerHour) {
      retryAfter = 3600 - (now % 3600);
    } else {
      retryAfter = 86400 - (now % 86400);
    }

    return {
      allowed: false,
      tier: tier.name,
      limits: {
        requestsPerMinute: { limit: tier.requestsPerMinute, remaining: minuteRemaining, reset: Math.ceil(now / 60) * 60 },
        requestsPerHour: { limit: tier.requestsPerHour, remaining: hourRemaining, reset: Math.ceil(now / 3600) * 3600 },
        requestsPerDay: { limit: tier.requestsPerDay, remaining: dayRemaining, reset: Math.ceil(now / 86400) * 86400 },
      },
      retryAfter,
    };
  }

  return {
    allowed: true,
    tier: tier.name,
    limits: {
      requestsPerMinute: { limit: tier.requestsPerMinute, remaining: minuteRemaining, reset: Math.ceil(now / 60) * 60 },
      requestsPerHour: { limit: tier.requestsPerHour, remaining: hourRemaining, reset: Math.ceil(now / 3600) * 3600 },
      requestsPerDay: { limit: tier.requestsPerDay, remaining: dayRemaining, reset: Math.ceil(now / 86400) * 86400 },
    },
  };
}

// ─── Token Usage Tracking ─────────────────────────────────────────────────────

export async function trackTokenUsage(userId: number, tokens: number): Promise<boolean> {
  const tier = await resolveUserTier(userId);
  const now = Math.floor(Date.now() / 1000);

  const minuteKey = `rl:tok:${userId}:min:${Math.floor(now / 60)}`;
  const dayKey = `rl:tok:${userId}:day:${Math.floor(now / 86400)}`;

  const pipe = redis.pipeline();
  pipe.incrby(minuteKey, tokens);
  pipe.expire(minuteKey, 120);
  pipe.incrby(dayKey, tokens);
  pipe.expire(dayKey, 172800);
  const results = await pipe.exec();

  const minuteTokens = (results?.[0]?.[1] as number) ?? 0;
  const dayTokens = (results?.[2]?.[1] as number) ?? 0;

  return minuteTokens <= tier.tokensPerMinute && dayTokens <= tier.tokensPerDay;
}

// ─── Admin: CRUD Tiers ───────────────────────────────────────────────────────

export async function listTiers(): Promise<RateLimitTier[]> {
  return db.select().from(rateLimitTiers);
}

export async function createTier(tier: Omit<RateLimitTier, "id">): Promise<RateLimitTier> {
  const [created] = await db.insert(rateLimitTiers).values(tier).returning();
  tierCacheExpiry = 0; // Invalidate cache
  return created as RateLimitTier;
}

export async function updateTier(id: number, updates: Partial<Omit<RateLimitTier, "id">>): Promise<RateLimitTier | null> {
  const [updated] = await db
    .update(rateLimitTiers)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(rateLimitTiers.id, id))
    .returning();
  tierCacheExpiry = 0;
  return (updated as RateLimitTier) ?? null;
}

export async function deleteTier(id: number): Promise<boolean> {
  const result = await db.delete(rateLimitTiers).where(eq(rateLimitTiers.id, id)).returning();
  tierCacheExpiry = 0;
  return result.length > 0;
}

// ─── Admin: Assign Tiers ─────────────────────────────────────────────────────

export async function setUserTier(userId: number, tierId: number): Promise<void> {
  await db
    .insert(userRateLimits)
    .values({ userId, tierId })
    .onConflictDoUpdate({ target: userRateLimits.userId, set: { tierId } });
  log.info({ userId, tierId }, "User rate limit tier assigned");
}

export async function removeUserTier(userId: number): Promise<void> {
  await db.delete(userRateLimits).where(eq(userRateLimits.userId, userId));
}

export async function setGroupTier(groupId: number, tierId: number): Promise<void> {
  await db
    .insert(groupRateLimits)
    .values({ groupId, tierId })
    .onConflictDoUpdate({ target: groupRateLimits.groupId, set: { tierId } });
  log.info({ groupId, tierId }, "Group rate limit tier assigned");
}

export async function removeGroupTier(groupId: number): Promise<void> {
  await db.delete(groupRateLimits).where(eq(groupRateLimits.groupId, groupId));
}
