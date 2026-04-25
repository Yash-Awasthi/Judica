/**
 * Personal Access Token Service — create, validate, revoke API keys.
 *
 * Token format: aib_<random 40 hex chars>
 * Storage: SHA-256 hash only. Plaintext returned once at creation.
 */

import { db } from "../lib/drizzle.js";
import { personalAccessTokens } from "../db/schema/pat.js";
import { users } from "../db/schema/users.js";
import { eq, and } from "drizzle-orm";
import { randomBytes, createHash } from "node:crypto";
import logger from "../lib/logger.js";

const log = logger.child({ service: "pat" });

const TOKEN_PREFIX = "aib_";

// ─── Types ────────────────────────────────────────────────────────────────────

export type PatTier = "admin" | "basic" | "limited";

export interface PatCreateRequest {
  label: string;
  scopes?: string[];
  expiresInDays?: number;
  tier?: PatTier;
  allowedRoutes?: string[];
}

export interface PatCreateResponse {
  id: number;
  token: string; // Only returned once
  label: string;
  tokenPrefix: string;
  scopes: string[];
  tier: PatTier;
  createdAt: string;
  expiresAt: string | null;
}

export interface PatListItem {
  id: number;
  label: string;
  tokenPrefix: string;
  scopes: string[];
  tier: PatTier;
  active: boolean;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
}

// ─── Valid Scopes ─────────────────────────────────────────────────────────────

const VALID_SCOPES = new Set([
  "read",        // Read conversations, history, settings
  "write",       // Create conversations, upload files
  "admin",       // Manage users, settings
  "connectors",  // Manage data source connectors
  "kb",          // Manage knowledge base
]);

export function validateScopes(scopes: string[]): { valid: boolean; invalid: string[] } {
  const invalid = scopes.filter((s) => !VALID_SCOPES.has(s));
  return { valid: invalid.length === 0, invalid };
}

// ─── Create ───────────────────────────────────────────────────────────────────

export async function createPat(userId: number, req: PatCreateRequest): Promise<PatCreateResponse> {
  const rawToken = TOKEN_PREFIX + randomBytes(20).toString("hex");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const tokenPrefix = rawToken.slice(0, 8);

  const scopes = req.scopes ?? ["read", "write"];
  const tier: PatTier = req.tier ?? "basic";
  const expiresAt = req.expiresInDays
    ? new Date(Date.now() + req.expiresInDays * 86400000)
    : null;

  const [created] = await db
    .insert(personalAccessTokens)
    .values({
      userId,
      label: req.label,
      tokenHash,
      tokenPrefix,
      scopes,
      tier,
      allowedRoutes: req.allowedRoutes ?? null,
      expiresAt,
    })
    .returning();

  log.info({ userId, patId: created.id, label: req.label }, "PAT created");

  return {
    id: created.id,
    token: rawToken,
    label: created.label,
    tokenPrefix,
    scopes,
    tier,
    createdAt: created.createdAt.toISOString(),
    expiresAt: expiresAt?.toISOString() ?? null,
  };
}

// ─── List ─────────────────────────────────────────────────────────────────────

export async function listPats(userId: number): Promise<PatListItem[]> {
  const tokens = await db
    .select()
    .from(personalAccessTokens)
    .where(eq(personalAccessTokens.userId, userId))
    .orderBy(personalAccessTokens.createdAt);

  return tokens.map((t) => ({
    id: t.id,
    label: t.label,
    tokenPrefix: t.tokenPrefix,
    scopes: t.scopes as string[],
    tier: (t.tier ?? "basic") as PatTier,
    active: t.active,
    createdAt: t.createdAt.toISOString(),
    lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
    expiresAt: t.expiresAt?.toISOString() ?? null,
  }));
}

// ─── Revoke ───────────────────────────────────────────────────────────────────

export async function revokePat(userId: number, patId: number): Promise<boolean> {
  const result = await db
    .update(personalAccessTokens)
    .set({ active: false })
    .where(and(eq(personalAccessTokens.id, patId), eq(personalAccessTokens.userId, userId)))
    .returning();

  if (result.length > 0) {
    log.info({ userId, patId }, "PAT revoked");
    return true;
  }
  return false;
}

// ─── Validate (for auth middleware) ───────────────────────────────────────────

export interface PatValidationResult {
  valid: boolean;
  userId?: number;
  scopes?: string[];
  patId?: number;
  tier?: string;
}

export async function validatePat(rawToken: string): Promise<PatValidationResult> {
  if (!rawToken.startsWith(TOKEN_PREFIX)) {
    return { valid: false };
  }

  const tokenHash = createHash("sha256").update(rawToken).digest("hex");

  const [record] = await db
    .select({
      id: personalAccessTokens.id,
      userId: personalAccessTokens.userId,
      scopes: personalAccessTokens.scopes,
      tier: personalAccessTokens.tier,
      active: personalAccessTokens.active,
      expiresAt: personalAccessTokens.expiresAt,
    })
    .from(personalAccessTokens)
    .where(and(eq(personalAccessTokens.tokenHash, tokenHash), eq(personalAccessTokens.active, true)))
    .limit(1);

  if (!record) {
    return { valid: false };
  }

  if (record.expiresAt && record.expiresAt < new Date()) {
    return { valid: false };
  }

  // Check user is still active
  const [user] = await db
    .select({ isActive: users.isActive })
    .from(users)
    .where(eq(users.id, record.userId))
    .limit(1);

  if (!user?.isActive) {
    return { valid: false };
  }

  // Update last used (fire-and-forget)
  db.update(personalAccessTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(personalAccessTokens.id, record.id))
    .catch(() => {});

  return {
    valid: true,
    userId: record.userId,
    scopes: record.scopes as string[],
    patId: record.id,
    tier: (record.tier ?? "basic") as string,
  };
}
