/**
 * Surface Access Service — manage embeddable widgets and multi-surface access tokens.
 *
 * Provides CRUD for widget configs, token generation/validation, and per-surface
 * usage statistics. Tokens use the same SHA-256 hashing strategy as PATs.
 */

import { db } from "../lib/drizzle.js";
import { embeddableWidgets, surfaceAccessTokens } from "../db/schema/surfaceAccess.js";
import { users } from "../db/schema/users.js";
import { eq, and, sql } from "drizzle-orm";
import { randomBytes, createHash, randomUUID } from "node:crypto";
import logger from "../lib/logger.js";

const log = logger.child({ service: "surfaceAccess" });

// ─── Constants ───────────────────────────────────────────────────────────────

const TOKEN_PREFIX = "srf_";

export const VALID_SURFACES = [
  "chrome_extension",
  "slack_bot",
  "discord_bot",
  "widget",
  "desktop",
  "mobile",
] as const;

export type Surface = (typeof VALID_SURFACES)[number];

export const VALID_THEMES = ["light", "dark", "auto"] as const;
export type WidgetTheme = (typeof VALID_THEMES)[number];

export const VALID_POSITIONS = ["bottom-right", "bottom-left"] as const;
export type WidgetPosition = (typeof VALID_POSITIONS)[number];

// ─── Widget Types ────────────────────────────────────────────────────────────

export interface WidgetCreateInput {
  name: string;
  allowedOrigins?: string[];
  theme?: WidgetTheme;
  position?: WidgetPosition;
  customCss?: string;
}

export interface WidgetUpdateInput {
  name?: string;
  allowedOrigins?: string[];
  theme?: WidgetTheme;
  position?: WidgetPosition;
  customCss?: string | null;
  isActive?: boolean;
}

// ─── Token Types ─────────────────────────────────────────────────────────────

export interface TokenCreateInput {
  surface: Surface;
  label: string;
  expiresInDays?: number;
}

export interface TokenCreateResponse {
  id: string;
  token: string; // Only returned once
  surface: Surface;
  label: string;
  createdAt: string;
  expiresAt: string | null;
}

// ─── Widget CRUD ─────────────────────────────────────────────────────────────

export async function createWidget(userId: number, input: WidgetCreateInput) {
  const id = randomUUID();
  const apiKey = `wgt_${randomBytes(24).toString("hex")}`;

  const [created] = await db
    .insert(embeddableWidgets)
    .values({
      id,
      userId,
      name: input.name,
      allowedOrigins: input.allowedOrigins ?? [],
      apiKey,
      theme: input.theme ?? "auto",
      position: input.position ?? "bottom-right",
      customCss: input.customCss ?? null,
    })
    .returning();

  log.info({ userId, widgetId: id }, "Widget created");
  return created;
}

export async function getWidgets(userId: number) {
  return db
    .select()
    .from(embeddableWidgets)
    .where(eq(embeddableWidgets.userId, userId))
    .orderBy(embeddableWidgets.createdAt);
}

export async function updateWidget(id: string, userId: number, input: WidgetUpdateInput) {
  const values: Record<string, unknown> = {
    updatedAt: new Date(),
  };

  if (input.name !== undefined) values.name = input.name;
  if (input.allowedOrigins !== undefined) values.allowedOrigins = input.allowedOrigins;
  if (input.theme !== undefined) values.theme = input.theme;
  if (input.position !== undefined) values.position = input.position;
  if (input.customCss !== undefined) values.customCss = input.customCss;
  if (input.isActive !== undefined) values.isActive = input.isActive;

  const [updated] = await db
    .update(embeddableWidgets)
    .set(values)
    .where(and(eq(embeddableWidgets.id, id), eq(embeddableWidgets.userId, userId)))
    .returning();

  if (updated) {
    log.info({ userId, widgetId: id }, "Widget updated");
  }
  return updated ?? null;
}

export async function deleteWidget(id: string, userId: number): Promise<boolean> {
  const result = await db
    .delete(embeddableWidgets)
    .where(and(eq(embeddableWidgets.id, id), eq(embeddableWidgets.userId, userId)))
    .returning();

  if (result.length > 0) {
    log.info({ userId, widgetId: id }, "Widget deleted");
    return true;
  }
  return false;
}

export async function getWidgetByApiKey(apiKey: string) {
  const [widget] = await db
    .select()
    .from(embeddableWidgets)
    .where(and(eq(embeddableWidgets.apiKey, apiKey), eq(embeddableWidgets.isActive, true)))
    .limit(1);

  return widget ?? null;
}

// ─── Surface Token CRUD ──────────────────────────────────────────────────────

export async function generateSurfaceToken(
  userId: number,
  surface: Surface,
  label: string,
  expiresInDays?: number,
): Promise<TokenCreateResponse> {
  const id = randomUUID();
  const rawToken = TOKEN_PREFIX + randomBytes(24).toString("hex");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");

  const expiresAt = expiresInDays
    ? new Date(Date.now() + expiresInDays * 86_400_000)
    : null;

  const [created] = await db
    .insert(surfaceAccessTokens)
    .values({
      id,
      userId,
      surface,
      tokenHash,
      label,
      expiresAt,
    })
    .returning();

  log.info({ userId, tokenId: id, surface }, "Surface token created");

  return {
    id: created.id,
    token: rawToken,
    surface: surface,
    label: created.label,
    createdAt: created.createdAt.toISOString(),
    expiresAt: expiresAt?.toISOString() ?? null,
  };
}

export async function revokeSurfaceToken(id: string, userId: number): Promise<boolean> {
  const result = await db
    .delete(surfaceAccessTokens)
    .where(and(eq(surfaceAccessTokens.id, id), eq(surfaceAccessTokens.userId, userId)))
    .returning();

  if (result.length > 0) {
    log.info({ userId, tokenId: id }, "Surface token revoked");
    return true;
  }
  return false;
}

export async function getSurfaceTokens(userId: number) {
  const tokens = await db
    .select({
      id: surfaceAccessTokens.id,
      surface: surfaceAccessTokens.surface,
      label: surfaceAccessTokens.label,
      lastUsedAt: surfaceAccessTokens.lastUsedAt,
      expiresAt: surfaceAccessTokens.expiresAt,
      createdAt: surfaceAccessTokens.createdAt,
    })
    .from(surfaceAccessTokens)
    .where(eq(surfaceAccessTokens.userId, userId))
    .orderBy(surfaceAccessTokens.createdAt);

  return tokens.map((t) => ({
    id: t.id,
    surface: t.surface,
    label: t.label,
    lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
    expiresAt: t.expiresAt?.toISOString() ?? null,
    createdAt: t.createdAt.toISOString(),
  }));
}

export interface SurfaceTokenValidation {
  valid: boolean;
  userId?: number;
  surface?: string;
  tokenId?: string;
}

export async function validateSurfaceToken(
  rawToken: string,
  expectedSurface: Surface,
): Promise<SurfaceTokenValidation> {
  if (!rawToken.startsWith(TOKEN_PREFIX)) {
    return { valid: false };
  }

  const tokenHash = createHash("sha256").update(rawToken).digest("hex");

  const [record] = await db
    .select({
      id: surfaceAccessTokens.id,
      userId: surfaceAccessTokens.userId,
      surface: surfaceAccessTokens.surface,
      expiresAt: surfaceAccessTokens.expiresAt,
    })
    .from(surfaceAccessTokens)
    .where(
      and(
        eq(surfaceAccessTokens.tokenHash, tokenHash),
        eq(surfaceAccessTokens.surface, expectedSurface),
      ),
    )
    .limit(1);

  if (!record) {
    return { valid: false };
  }

  if (record.expiresAt && record.expiresAt < new Date()) {
    return { valid: false };
  }

  // Verify owning user is still active
  const [user] = await db
    .select({ isActive: users.isActive })
    .from(users)
    .where(eq(users.id, record.userId))
    .limit(1);

  if (!user?.isActive) {
    return { valid: false };
  }

  // Fire-and-forget lastUsedAt update
  db.update(surfaceAccessTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(surfaceAccessTokens.id, record.id))
    .catch(() => {});

  return {
    valid: true,
    userId: record.userId,
    surface: record.surface,
    tokenId: record.id,
  };
}

// ─── Usage Stats ─────────────────────────────────────────────────────────────

export async function getSurfaceUsageStats(userId: number) {
  // Count tokens per surface
  const tokenCounts = await db
    .select({
      surface: surfaceAccessTokens.surface,
      count: sql<number>`count(*)::int`,
    })
    .from(surfaceAccessTokens)
    .where(eq(surfaceAccessTokens.userId, userId))
    .groupBy(surfaceAccessTokens.surface);

  // Count widgets
  const [widgetCount] = await db
    .select({
      total: sql<number>`count(*)::int`,
      active: sql<number>`count(*) filter (where ${embeddableWidgets.isActive} = true)::int`,
    })
    .from(embeddableWidgets)
    .where(eq(embeddableWidgets.userId, userId));

  const surfaceMap: Record<string, number> = {};
  for (const row of tokenCounts) {
    surfaceMap[row.surface] = row.count;
  }

  return {
    tokensBySurface: surfaceMap,
    widgets: {
      total: widgetCount?.total ?? 0,
      active: widgetCount?.active ?? 0,
    },
  };
}
