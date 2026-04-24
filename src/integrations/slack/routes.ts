/**
 * Slack Bot Integration — Routes
 *
 * Fastify routes for Slack event webhooks, OAuth installation,
 * and channel configuration.
 */

import type { FastifyPluginAsync } from "fastify";
import { fastifyRequireAuth } from "../../middleware/fastifyAuth.js";
import { AppError } from "../../middleware/errorHandler.js";
import { verifySlackSignature, handleSlackEvent } from "./events.js";
import { SlackBot } from "./bot.js";
import { DEFAULT_SLACK_BOT_CONFIG } from "./models.js";
import type { SlackEventPayload, SlackChannelConfig, SlackBotConfig } from "./models.js";
import { env } from "../../config/env.js";
import logger from "../../lib/logger.js";

const slackPlugin: FastifyPluginAsync = async (fastify) => {
  // ─── POST /events — Slack event webhook ──────────────────────────
  fastify.post("/events", async (request, reply) => {
    const rawBody = JSON.stringify(request.body);
    const timestamp = request.headers["x-slack-request-timestamp"] as string;
    const signature = request.headers["x-slack-signature"] as string;

    const signingSecret = env.SLACK_SIGNING_SECRET;
    if (!signingSecret) {
      throw new AppError(500, "Slack signing secret not configured", "SLACK_NOT_CONFIGURED");
    }

    // Verify request signature
    if (!timestamp || !signature || !verifySlackSignature(signingSecret, timestamp, rawBody, signature)) {
      throw new AppError(401, "Invalid Slack signature", "SLACK_INVALID_SIGNATURE");
    }

    const payload = request.body as SlackEventPayload;

    // URL verification challenge
    if (payload.type === "url_verification") {
      return { challenge: payload.challenge };
    }

    const botToken = env.SLACK_BOT_TOKEN;
    if (!botToken) {
      throw new AppError(500, "Slack bot token not configured", "SLACK_NOT_CONFIGURED");
    }

    const config: SlackBotConfig = {
      ...DEFAULT_SLACK_BOT_CONFIG,
      botToken,
      signingSecret,
    };

    const bot = new SlackBot(config);

    // Process event async (respond 200 immediately per Slack requirements)
    const channelConfigs = new Map<string, SlackChannelConfig>();

    handleSlackEvent(payload, {
      config,
      channelConfigs,
      bot,
      apiBaseUrl: env.SLACK_API_BASE_URL || `http://localhost:${env.PORT || 3000}`,
      apiKey: env.SLACK_INTERNAL_API_KEY,
    }).catch((err) => {
      logger.error({ err }, "Async Slack event handling failed");
    });

    reply.code(200);
    return { ok: true };
  });

  // ─── POST /install — OAuth installation flow ────────────────────
  fastify.get("/install", async (_request, reply) => {
    const clientId = env.SLACK_CLIENT_ID;
    if (!clientId) {
      throw new AppError(500, "Slack client ID not configured", "SLACK_NOT_CONFIGURED");
    }

    const scopes = [
      "app_mentions:read",
      "channels:history",
      "channels:read",
      "chat:write",
      "commands",
      "groups:history",
      "groups:read",
      "im:history",
      "im:read",
      "reactions:read",
      "reactions:write",
      "users:read",
    ].join(",");

    const redirectUri = `${env.SLACK_REDIRECT_URI || env.FRONTEND_URL || ""}/api/integrations/slack/callback`;
    const installUrl = `https://slack.com/oauth/v2/authorize?client_id=${clientId}&scope=${scopes}&redirect_uri=${encodeURIComponent(redirectUri)}`;

    reply.redirect(installUrl);
  });

  // ─── GET /callback — OAuth callback ─────────────────────────────
  fastify.get("/callback", async (request, reply) => {
    const { code } = request.query as { code?: string };
    if (!code) {
      throw new AppError(400, "Missing OAuth code", "SLACK_MISSING_CODE");
    }

    const clientId = env.SLACK_CLIENT_ID;
    const clientSecret = env.SLACK_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new AppError(500, "Slack OAuth not configured", "SLACK_NOT_CONFIGURED");
    }

    const res = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: `${env.SLACK_REDIRECT_URI || env.FRONTEND_URL || ""}/api/integrations/slack/callback`,
      }).toString(),
    });

    const data = (await res.json()) as { ok: boolean; access_token?: string; team?: { id: string; name: string }; error?: string };

    if (!data.ok) {
      throw new AppError(400, `Slack OAuth failed: ${data.error}`, "SLACK_OAUTH_FAILED");
    }

    // In production, store the access_token securely
    logger.info({ teamId: data.team?.id, teamName: data.team?.name }, "Slack workspace installed");

    reply.code(200);
    return { success: true, team: data.team };
  });

  // ─── GET /channels — List bot's channels ────────────────────────
  fastify.get("/channels", { preHandler: fastifyRequireAuth }, async () => {
    const botToken = env.SLACK_BOT_TOKEN;
    if (!botToken) {
      throw new AppError(500, "Slack bot token not configured", "SLACK_NOT_CONFIGURED");
    }

    const bot = new SlackBot({ ...DEFAULT_SLACK_BOT_CONFIG, botToken, signingSecret: "" });
    const channels = await bot.listChannels();

    return { channels: channels.filter((c) => c.is_member) };
  });

  // ─── GET /health — Check bot connectivity ───────────────────────
  fastify.get("/health", { preHandler: fastifyRequireAuth }, async () => {
    const botToken = env.SLACK_BOT_TOKEN;
    if (!botToken) {
      return { connected: false, error: "Bot token not configured" };
    }

    const bot = new SlackBot({ ...DEFAULT_SLACK_BOT_CONFIG, botToken, signingSecret: "" });
    const auth = await bot.authTest();

    return { connected: auth.ok, botId: auth.bot_id, teamId: auth.team_id };
  });
};

export default slackPlugin;
