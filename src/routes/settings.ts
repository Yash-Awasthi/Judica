import type { FastifyPluginAsync } from "fastify";
import { db } from "../lib/drizzle.js";
import { userSettings } from "../db/schema/users.js";
import { eq } from "drizzle-orm";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";

const settingsPlugin: FastifyPluginAsync = async (fastify) => {
  // ── GET /api/settings/preferences ──────────────────────────────────────────
  fastify.get("/preferences", { preHandler: fastifyRequireAuth }, async (request, _reply) => {
    const userId = request.userId!;

    const [row] = await db
      .select()
      .from(userSettings)
      .where(eq(userSettings.userId, userId))
      .limit(1);

    const settings = (row?.settings ?? {}) as Record<string, unknown>;
    const prefs = (settings.preferences ?? {}) as Record<string, unknown>;

    return {
      autoCouncil:       prefs.autoCouncil       ?? true,
      debateRound:       prefs.debateRound        ?? "2",
      coldValidator:     prefs.coldValidator      ?? true,
      piiDetection:      prefs.piiDetection       ?? true,
      autoAnonymize:     prefs.autoAnonymize      ?? false,
      blockProfanity:    prefs.blockProfanity     ?? false,
      blockAdultContent: prefs.blockAdultContent  ?? true,
      verbosityLevel:    prefs.verbosityLevel     ?? "balanced",
      deliberationMode:  prefs.deliberationMode   ?? "standard",
      enableStreaming:   prefs.enableStreaming     ?? true,
    };
  });

  // ── PUT /api/settings/preferences ──────────────────────────────────────────
  fastify.put("/preferences", { preHandler: fastifyRequireAuth }, async (request, _reply) => {
    const userId = request.userId!;
    const body = request.body as Record<string, unknown>;

    const [existing] = await db
      .select()
      .from(userSettings)
      .where(eq(userSettings.userId, userId))
      .limit(1);

    const currentSettings = (existing?.settings ?? {}) as Record<string, unknown>;
    const updatedSettings = {
      ...currentSettings,
      preferences: {
        ...(currentSettings.preferences as Record<string, unknown> ?? {}),
        ...body,
      },
    };

    if (existing) {
      await db
        .update(userSettings)
        .set({ settings: updatedSettings, updatedAt: new Date() })
        .where(eq(userSettings.userId, userId));
    } else {
      await db.insert(userSettings).values({
        userId,
        settings: updatedSettings,
        updatedAt: new Date(),
      });
    }

    return { success: true };
  });

  // ── GET /api/settings/council ───────────────────────────────────────────────
  fastify.get("/council", { preHandler: fastifyRequireAuth }, async (request, _reply) => {
    const userId = request.userId!;

    const [row] = await db
      .select()
      .from(userSettings)
      .where(eq(userSettings.userId, userId))
      .limit(1);

    const settings = (row?.settings ?? {}) as Record<string, unknown>;
    return (settings.council ?? {}) as Record<string, unknown>;
  });

  // ── PUT /api/settings/council ───────────────────────────────────────────────
  fastify.put("/council", { preHandler: fastifyRequireAuth }, async (request, _reply) => {
    const userId = request.userId!;
    const body = request.body as Record<string, unknown>;

    const [existing] = await db
      .select()
      .from(userSettings)
      .where(eq(userSettings.userId, userId))
      .limit(1);

    const currentSettings = (existing?.settings ?? {}) as Record<string, unknown>;
    const updatedSettings = {
      ...currentSettings,
      council: {
        ...(currentSettings.council as Record<string, unknown> ?? {}),
        ...body,
      },
    };

    if (existing) {
      await db
        .update(userSettings)
        .set({ settings: updatedSettings, updatedAt: new Date() })
        .where(eq(userSettings.userId, userId));
    } else {
      await db.insert(userSettings).values({
        userId,
        settings: updatedSettings,
        updatedAt: new Date(),
      });
    }

    return { success: true };
  });
};

export default settingsPlugin;
