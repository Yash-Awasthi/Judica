/**
 * API Key Tier Middleware — enforce access control based on PAT tier.
 *
 * Tiers:
 *   admin   — all routes
 *   basic   — /api/ask, /api/chat, /api/history, /api/kb, /api/search,
 *             /api/documents (read + chat)
 *   limited — /api/ask, /api/chat only — hard rate limit 10 req/min
 *
 * Fine-grained overrides: if the PAT has an `allowedRoutes` list set,
 * it takes precedence over the tier defaults.
 */

import type { FastifyRequest, FastifyReply } from "fastify";
import { db } from "../lib/drizzle.js";
import { personalAccessTokens } from "../db/schema/pat.js";
import { eq, and } from "drizzle-orm";
import { createHash } from "node:crypto";
import redis from "../lib/redis.js";
import logger from "../lib/logger.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type PatTier = "limited" | "basic" | "admin";

const TIER_RANK: Record<PatTier, number> = {
  limited: 1,
  basic: 2,
  admin: 3,
};

// ─── Allowed Routes per Tier ──────────────────────────────────────────────────

/** Route prefixes accessible by each tier (checked via startsWith). */
const TIER_ROUTES: Record<PatTier, string[]> = {
  admin: [], // empty = all routes allowed
  basic: [
    "/api/ask",
    "/api/chat",
    "/api/history",
    "/api/kb",
    "/api/search",
    "/api/documents",
  ],
  limited: [
    "/api/ask",
    "/api/chat",
  ],
};

// ─── Rate limit constants ──────────────────────────────────────────────────────

const LIMITED_TIER_MAX_PER_MIN = 10;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isRouteAllowed(tier: PatTier, url: string, allowedRoutes?: string[] | null): boolean {
  // Fine-grained whitelist takes precedence
  if (allowedRoutes && allowedRoutes.length > 0) {
    return allowedRoutes.some((r) => url.startsWith(r));
  }

  // Admin tier has unrestricted access
  if (tier === "admin") return true;

  const allowed = TIER_ROUTES[tier];
  return allowed.some((r) => url.startsWith(r));
}

async function checkLimitedRateLimit(patId: number): Promise<boolean> {
  const key = `pat:tier:limited:${patId}`;
  try {
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, 60);
    return count <= LIMITED_TIER_MAX_PER_MIN;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "apiKeyTier: Redis rate limit check failed — allowing request");
    return true; // Fail open on Redis error
  }
}

// ─── tierFromKey ──────────────────────────────────────────────────────────────

/**
 * Look up the tier associated with a raw PAT token.
 * Returns null if the token is invalid, inactive, or expired.
 */
export async function tierFromKey(rawToken: string): Promise<PatTier | null> {
  if (!rawToken.startsWith("aib_")) return null;

  const tokenHash = createHash("sha256").update(rawToken).digest("hex");

  // Check Redis cache first (TTL: 5 min)
  const cacheKey = `pat:tier:cache:${tokenHash.slice(0, 16)}`;
  try {
    const cached = await redis.get(cacheKey);
    if (cached) return cached as PatTier;
  } catch {
    // Redis unavailable — fall through to DB
  }

  const [record] = await db
    .select({
      tier: personalAccessTokens.tier,
      active: personalAccessTokens.active,
      expiresAt: personalAccessTokens.expiresAt,
    })
    .from(personalAccessTokens)
    .where(and(eq(personalAccessTokens.tokenHash, tokenHash), eq(personalAccessTokens.active, true)))
    .limit(1);

  if (!record) return null;
  if (record.expiresAt && record.expiresAt < new Date()) return null;

  const tier = (record.tier ?? "basic") as PatTier;

  // Cache for 5 minutes
  try {
    await redis.set(cacheKey, tier, { EX: 300 });
  } catch {
    // Best-effort cache
  }

  return tier;
}

// ─── requireTier ─────────────────────────────────────────────────────────────

/**
 * Returns a Fastify preHandler that enforces a minimum PAT tier.
 *
 * Only applies to requests authenticated with a PAT (token starts with "aib_").
 * JWT-authenticated requests pass through unchanged.
 *
 * Usage:
 *   fastify.addHook("onRequest", fastifyRequireAuth);
 *   fastify.addHook("preHandler", requireTier("basic"));
 */
export function requireTier(minTier: PatTier) {
  return async function (request: FastifyRequest, reply: FastifyReply): Promise<void> {
    // Only enforce tier for PAT-authenticated requests
    const authHeader = request.headers.authorization;
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (!token || !token.startsWith("aib_")) {
      // Not a PAT request — JWT auth handles its own access control
      return;
    }

    const tokenHash = createHash("sha256").update(token).digest("hex");

    // Fetch PAT record including tier and allowedRoutes
    const [record] = await db
      .select({
        id: personalAccessTokens.id,
        tier: personalAccessTokens.tier,
        allowedRoutes: personalAccessTokens.allowedRoutes,
        active: personalAccessTokens.active,
        expiresAt: personalAccessTokens.expiresAt,
      })
      .from(personalAccessTokens)
      .where(and(eq(personalAccessTokens.tokenHash, tokenHash), eq(personalAccessTokens.active, true)))
      .limit(1);

    if (!record) {
      reply.code(401).send({ error: "Invalid or expired API key" });
      return;
    }

    if (record.expiresAt && record.expiresAt < new Date()) {
      reply.code(401).send({ error: "API key expired" });
      return;
    }

    const tier = (record.tier ?? "basic") as PatTier;

    // Check tier rank meets the minimum required
    if (TIER_RANK[tier] < TIER_RANK[minTier]) {
      reply.code(403).send({
        error: `API key tier '${tier}' is not permitted. Minimum required: '${minTier}'`,
      });
      return;
    }

    // Check route access
    const url = request.url.split("?")[0]; // Strip query string
    const allowed = isRouteAllowed(tier, url, record.allowedRoutes as string[] | null);
    if (!allowed) {
      reply.code(403).send({
        error: `API key tier '${tier}' does not have access to this endpoint`,
      });
      return;
    }

    // For limited tier — enforce hard 10 req/min rate limit
    if (tier === "limited") {
      const withinLimit = await checkLimitedRateLimit(record.id);
      if (!withinLimit) {
        reply.code(429)
          .header("Retry-After", "60")
          .send({ error: `Limited tier rate limit exceeded: ${LIMITED_TIER_MAX_PER_MIN} requests per minute` });
        return;
      }
    }
  };
}
