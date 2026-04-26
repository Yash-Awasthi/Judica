/**
 * Phase 7.17 — Webview-based AI Fallback (No-API-Key Mode)
 *
 * In the desktop app (Electron), users who have no provider API keys can still
 * access AI services by embedding the official web UIs as authenticated webviews.
 * The user logs in once; prompts are injected automatically.
 *
 * Zero API cost, no keys needed — uses the free tier of each provider's web UI.
 *
 * This backend route:
 *   - Stores the user's webview fallback preferences
 *   - Returns provider metadata (login URLs, webview-compatible domains)
 *   - Reports whether the user has any API keys configured (to decide whether
 *     fallback mode is needed at all)
 *   - Provides prompt injection configuration (the desktop app reads this to
 *     know how to inject into each provider's web UI)
 *
 * Note: The actual webview rendering is handled by the Electron frontend.
 *       This backend provides configuration and state — it does not render UIs.
 *
 * Ref:
 *   GodMode webview approach — https://github.com/smol-ai/GodMode (MIT, 5k stars)
 *   Electron webview — https://www.electronjs.org/docs/latest/api/webview-tag
 */

import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import { db } from "../lib/drizzle.js";
import { userSettings } from "../db/schema/users.js";
import { eq } from "drizzle-orm";
import { env } from "../config/env.js";
import logger from "../lib/logger.js";

const log = logger.child({ route: "webview-fallback" });

// ─── Provider definitions ─────────────────────────────────────────────────────

const WEBVIEW_PROVIDERS = [
  {
    id:          "chatgpt",
    label:       "ChatGPT",
    loginUrl:    "https://chat.openai.com/auth/login",
    chatUrl:     "https://chat.openai.com/",
    injectSelector: "#prompt-textarea",
    submitSelector: "button[data-testid='send-button']",
    responseSelector: "[data-message-author-role='assistant']",
    cost:        "Free (GPT-3.5) or ChatGPT Plus ($20/mo)",
    freeTier:    true,
  },
  {
    id:          "claude-web",
    label:       "Claude.ai",
    loginUrl:    "https://claude.ai/login",
    chatUrl:     "https://claude.ai/new",
    injectSelector: "[contenteditable='true']",
    submitSelector: "button[aria-label='Send Message']",
    responseSelector: ".font-claude-message",
    cost:        "Free tier available",
    freeTier:    true,
  },
  {
    id:          "gemini",
    label:       "Google Gemini",
    loginUrl:    "https://gemini.google.com/",
    chatUrl:     "https://gemini.google.com/app",
    injectSelector: "rich-textarea .ql-editor",
    submitSelector: "button.send-button",
    responseSelector: "message-content",
    cost:        "Free tier available",
    freeTier:    true,
  },
  {
    id:          "perplexity",
    label:       "Perplexity AI",
    loginUrl:    "https://www.perplexity.ai/",
    chatUrl:     "https://www.perplexity.ai/",
    injectSelector: "textarea[placeholder]",
    submitSelector: "button[aria-label='Submit']",
    responseSelector: ".prose",
    cost:        "Free tier available",
    freeTier:    true,
  },
  {
    id:          "mistral",
    label:       "Mistral Le Chat",
    loginUrl:    "https://chat.mistral.ai/",
    chatUrl:     "https://chat.mistral.ai/chat",
    injectSelector: "textarea",
    submitSelector: "button[type='submit']",
    responseSelector: ".message-content",
    cost:        "Free",
    freeTier:    true,
  },
];

// ─── Schema ───────────────────────────────────────────────────────────────────

const configSchema = z.object({
  enabled:          z.boolean().optional(),
  preferredProvider: z.string().max(50).optional(),
  autoFallback:     z.boolean().optional(), // auto-enable when no API keys configured
  injectDelay:      z.number().int().min(100).max(5000).optional(), // ms to wait after inject
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG = { enabled: true, preferredProvider: "chatgpt", autoFallback: true, injectDelay: 500 };

async function getConfig(userId: number): Promise<typeof DEFAULT_CONFIG> {
  try {
    const rows = await db.select({ settings: userSettings.settings }).from(userSettings).where(eq(userSettings.userId, userId)).limit(1);
    const raw = rows[0]?.settings as Record<string, unknown> | undefined;
    return { ...DEFAULT_CONFIG, ...((raw?.webviewFallback ?? {}) as Partial<typeof DEFAULT_CONFIG>) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

async function saveConfig(userId: number, config: typeof DEFAULT_CONFIG): Promise<void> {
  const rows = await db.select({ settings: userSettings.settings }).from(userSettings).where(eq(userSettings.userId, userId)).limit(1);
  const existing = (rows[0]?.settings as Record<string, unknown>) ?? {};
  await db.insert(userSettings).values({ userId, settings: { ...existing, webviewFallback: config } })
    .onConflictDoUpdate({ target: userSettings.userId, set: { settings: { ...existing, webviewFallback: config } } });
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

const webviewFallbackPlugin: FastifyPluginAsync = async (fastify) => {

  /**
   * GET /webview-fallback/status
   * Returns whether API keys are configured and whether webview fallback is needed.
   * The frontend reads this to decide whether to show the "No API key — use webview" banner.
   */
  fastify.get("/status", { preHandler: fastifyRequireAuth }, async (req, reply) => {
    const config = await getConfig(req.userId!);

    const hasApiKeys = Boolean(
      env.OPENAI_API_KEY || env.ANTHROPIC_API_KEY ||
      (env as unknown as Record<string, string>).GEMINI_API_KEY ||
      (env as unknown as Record<string, string>).GROQ_API_KEY
    );

    return reply.send({
      hasApiKeys,
      webviewAvailable: true, // always available on desktop; web returns false
      fallbackRecommended: !hasApiKeys,
      config,
      note: hasApiKeys
        ? "API keys are configured. Webview fallback is available as a backup."
        : "No API keys configured. Webview fallback mode can be used with free provider UIs.",
    });
  });

  /**
   * GET /webview-fallback/providers
   * Return metadata for each webview-compatible provider including DOM selectors
   * for prompt injection and response extraction.
   */
  fastify.get("/providers", { preHandler: fastifyRequireAuth }, async (_req, reply) => {
    return reply.send({
      providers: WEBVIEW_PROVIDERS,
      disclaimer: [
        "Webview injection relies on provider DOM selectors which may change without notice.",
        "These selectors are maintained on a best-effort basis.",
        "Always verify your provider's Terms of Service before using automation.",
      ],
      ref: "https://github.com/smol-ai/GodMode — open-source webview aggregator pattern",
    });
  });

  /**
   * GET /webview-fallback/providers/:providerId
   * Get injection config for a specific provider.
   */
  fastify.get<{ Params: { providerId: string } }>(
    "/providers/:providerId",
    { preHandler: fastifyRequireAuth },
    async (req, reply) => {
      const provider = WEBVIEW_PROVIDERS.find(p => p.id === req.params.providerId);
      if (!provider) return reply.status(404).send({ error: "Provider not found" });
      return reply.send(provider);
    }
  );

  /**
   * GET /webview-fallback/config
   * Get current user's webview fallback preferences.
   */
  fastify.get("/config", { preHandler: fastifyRequireAuth }, async (req, reply) => {
    const config = await getConfig(req.userId!);
    return reply.send({ config, defaults: DEFAULT_CONFIG });
  });

  /**
   * PATCH /webview-fallback/config
   * Update preferences.
   */
  fastify.patch("/config", { preHandler: fastifyRequireAuth }, async (req, reply) => {
    const parsed = configSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    const current = await getConfig(req.userId!);
    const updated = { ...current, ...parsed.data };
    await saveConfig(req.userId!, updated);
    return reply.send({ config: updated });
  });
};

export default webviewFallbackPlugin;
