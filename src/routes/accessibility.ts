/**
 * Phase 6.8 — Accessibility Mode
 *
 * WCAG 2.1 AA compliant accessibility settings:
 *   - High-contrast theme (WCAG AA: 4.5:1 minimum contrast ratio)
 *   - Font size scaling (100%–200%)
 *   - Reduce motion (prefers-reduced-motion equivalent)
 *   - Screen-reader optimisations (ARIA live regions, verbose labels)
 *   - Captions for voice/video content
 *   - Keyboard navigation enhancements
 *
 * Settings are persisted per user and returned on session load so the
 * frontend can apply them before first paint (no flash of inaccessible content).
 *
 * Ref:
 *   WCAG 2.1 — https://www.w3.org/TR/WCAG21/
 *   ARIA — https://www.w3.org/TR/wai-aria-1.2/
 *   axe-core — https://github.com/dequelabs/axe-core (MIT, 5k stars)
 */

import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import { db } from "../lib/drizzle.js";
import { userSettings } from "../db/schema/users.js";
import { eq } from "drizzle-orm";
import logger from "../lib/logger.js";

const log = logger.child({ route: "accessibility" });

// ─── Schema ───────────────────────────────────────────────────────────────────

const accessibilitySettingsSchema = z.object({
  /** High-contrast theme variant */
  highContrast:         z.enum(["off", "dark-hc", "light-hc", "yellow-on-black"]).default("off"),
  /** Font size multiplier as percentage (100–200) */
  fontSizePercent:      z.number().int().min(100).max(200).default(100),
  /** Suppress animations and transitions */
  reduceMotion:         z.boolean().default(false),
  /** Emit ARIA live region announcements for every AI response */
  screenReaderMode:     z.boolean().default(false),
  /** Show closed captions for TTS/voice council audio */
  captions:             z.boolean().default(false),
  /** Enhance keyboard focus indicators beyond browser defaults */
  enhancedFocusRings:   z.boolean().default(false),
  /** Increase spacing between lines and paragraphs (WCAG 1.4.12) */
  increasedSpacing:     z.boolean().default(false),
  /** Dyslexia-friendly font (OpenDyslexic or similar) */
  dyslexiaFont:         z.boolean().default(false),
  /** Colour-blindness assist filter */
  colourBlindMode:      z.enum(["off", "protanopia", "deuteranopia", "tritanopia", "achromatopsia"]).default("off"),
});

type AccessibilitySettings = z.infer<typeof accessibilitySettingsSchema>;

const DEFAULTS: AccessibilitySettings = {
  highContrast:       "off",
  fontSizePercent:    100,
  reduceMotion:       false,
  screenReaderMode:   false,
  captions:           false,
  enhancedFocusRings: false,
  increasedSpacing:   false,
  dyslexiaFont:       false,
  colourBlindMode:    "off",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getSettings(userId: number): Promise<AccessibilitySettings> {
  try {
    const rows = await db
      .select({ settings: userSettings.settings })
      .from(userSettings)
      .where(eq(userSettings.userId, userId))
      .limit(1);
    const raw = rows[0]?.settings as Record<string, unknown> | undefined;
    const a11y = raw?.accessibility as Partial<AccessibilitySettings> | undefined;
    return { ...DEFAULTS, ...a11y };
  } catch (err) {
    log.warn({ err }, "Failed to load accessibility settings, returning defaults");
    return { ...DEFAULTS };
  }
}

async function saveSettings(userId: number, settings: AccessibilitySettings): Promise<void> {
  // Merge into the user's settings JSON blob
  const current = await db
    .select({ settings: userSettings.settings })
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
    .limit(1);

  const existing = (current[0]?.settings as Record<string, unknown>) ?? {};
  const merged = { ...existing, accessibility: settings };

  await db
    .insert(userSettings)
    .values({ userId, settings: merged })
    .onConflictDoUpdate({ target: userSettings.userId, set: { settings: merged } });
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

const accessibilityPlugin: FastifyPluginAsync = async (fastify) => {

  /**
   * GET /accessibility/settings
   * Return the current user's accessibility settings.
   * Returns defaults if no settings have been saved.
   */
  fastify.get("/settings", { preHandler: fastifyRequireAuth }, async (req, reply) => {
    const settings = await getSettings(req.userId!);
    return reply.send({ settings, defaults: DEFAULTS });
  });

  /**
   * PATCH /accessibility/settings
   * Partial update — only provided fields are changed.
   */
  fastify.patch("/settings", { preHandler: fastifyRequireAuth }, async (req, reply) => {
    const parsed = accessibilitySettingsSchema.partial().safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const current = await getSettings(req.userId!);
    const updated: AccessibilitySettings = { ...current, ...parsed.data };
    await saveSettings(req.userId!, updated);
    return reply.send({ settings: updated });
  });

  /**
   * PUT /accessibility/settings
   * Full replace — resets any unspecified fields to defaults.
   */
  fastify.put("/settings", { preHandler: fastifyRequireAuth }, async (req, reply) => {
    const parsed = accessibilitySettingsSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    await saveSettings(req.userId!, parsed.data);
    return reply.send({ settings: parsed.data });
  });

  /**
   * DELETE /accessibility/settings
   * Reset all settings to defaults.
   */
  fastify.delete("/settings", { preHandler: fastifyRequireAuth }, async (req, reply) => {
    await saveSettings(req.userId!, { ...DEFAULTS });
    return reply.send({ settings: DEFAULTS, reset: true });
  });

  /**
   * GET /accessibility/themes
   * List available high-contrast theme options with WCAG contrast ratios.
   */
  fastify.get("/themes", { preHandler: fastifyRequireAuth }, async (_req, reply) => {
    return reply.send({
      themes: [
        { id: "off",             label: "Default",              contrastRatio: "~4.5:1",  wcag: "AA" },
        { id: "dark-hc",         label: "Dark High Contrast",  contrastRatio: "≥7:1",    wcag: "AAA", cssClass: "dark-hc" },
        { id: "light-hc",        label: "Light High Contrast", contrastRatio: "≥7:1",    wcag: "AAA", cssClass: "light-hc" },
        { id: "yellow-on-black", label: "Yellow on Black",     contrastRatio: "19.56:1", wcag: "AAA", cssClass: "yellow-on-black" },
      ],
      wcagReference: "https://www.w3.org/TR/WCAG21/#contrast-minimum",
    });
  });

  /**
   * GET /accessibility/font-options
   * List available font options including dyslexia-friendly choices.
   */
  fastify.get("/font-options", { preHandler: fastifyRequireAuth }, async (_req, reply) => {
    return reply.send({
      fonts: [
        { id: "system",       label: "System Default",    free: true },
        { id: "opendyslexic", label: "OpenDyslexic",      free: true, url: "https://opendyslexic.org/" },
        { id: "atkinson",     label: "Atkinson Hyperlegible", free: true, url: "https://brailleinstitute.org/freefont" },
        { id: "lexie",        label: "Lexie Readable",    free: true, url: "http://www.lexiefont.com/" },
      ],
      fontSizeRange: { min: 100, max: 200, step: 10, unit: "percent" },
    });
  });
};

export default accessibilityPlugin;
