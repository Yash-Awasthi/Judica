/**
 * Discord Bot Integration — Routes
 *
 * Fastify routes for Discord interaction webhooks, slash command registration,
 * and channel configuration.
 */

import type { FastifyPluginAsync } from "fastify";
import { fastifyRequireAuth, fastifyRequireAdmin } from "../../middleware/fastifyAuth.js";
import { AppError } from "../../middleware/errorHandler.js";
import { verifyDiscordSignature, handleInteraction } from "./events.js";
import { DiscordBot } from "./bot.js";
import { DEFAULT_DISCORD_BOT_CONFIG } from "./models.js";
import type { DiscordInteraction, DiscordChannelConfig, DiscordBotConfig } from "./models.js";
import { env } from "../../config/env.js";
import logger from "../../lib/logger.js";

const log = logger.child({ service: "discord-routes" });

const discordPlugin: FastifyPluginAsync = async (fastify) => {
  // ─── POST /interactions — Discord interaction webhook ────────────────
  fastify.post("/interactions", {
    config: { rawBody: true },
  }, async (request, reply) => {
    const rawBody = JSON.stringify(request.body);
    const signature = request.headers["x-signature-ed25519"] as string;
    const timestamp = request.headers["x-signature-timestamp"] as string;

    const publicKey = env.DISCORD_PUBLIC_KEY;
    if (!publicKey) {
      throw new AppError(500, "Discord public key not configured", "DISCORD_NOT_CONFIGURED");
    }

    if (!signature || !timestamp || !await verifyDiscordSignature(publicKey, signature, timestamp, rawBody)) {
      throw new AppError(401, "Invalid Discord signature", "DISCORD_INVALID_SIGNATURE");
    }

    const interaction = request.body as DiscordInteraction;

    const config: DiscordBotConfig = {
      ...DEFAULT_DISCORD_BOT_CONFIG,
      botToken: env.DISCORD_BOT_TOKEN ?? "",
      applicationId: env.DISCORD_APPLICATION_ID ?? "",
      publicKey,
    };

    const response = await handleInteraction(interaction, config);
    return response;
  });

  // ─── POST /register-commands — Register slash commands (admin) ───────
  fastify.post("/register-commands", {
    preHandler: fastifyRequireAdmin,
  }, async (request) => {
    const body = request.body as { guildId?: string };
    const botToken = env.DISCORD_BOT_TOKEN;
    const appId = env.DISCORD_APPLICATION_ID;
    if (!botToken || !appId) {
      throw new AppError(500, "Discord bot not configured", "DISCORD_NOT_CONFIGURED");
    }

    const config: DiscordBotConfig = {
      ...DEFAULT_DISCORD_BOT_CONFIG,
      botToken,
      applicationId: appId,
      publicKey: env.DISCORD_PUBLIC_KEY ?? "",
    };

    const bot = new DiscordBot(config);
    await bot.registerSlashCommands(body.guildId);

    return { ok: true, guildId: body.guildId ?? "global" };
  });

  // ─── GET /config — Get Discord bot configuration (admin) ─────────────
  fastify.get("/config", {
    preHandler: fastifyRequireAdmin,
  }, async () => {
    return {
      configured: !!(env.DISCORD_BOT_TOKEN && env.DISCORD_APPLICATION_ID && env.DISCORD_PUBLIC_KEY),
      applicationId: env.DISCORD_APPLICATION_ID ?? null,
    };
  });

  // ─── PUT /config — Update Discord bot configuration (admin) ──────────
  fastify.put("/config", {
    preHandler: fastifyRequireAdmin,
  }, async (request) => {
    const body = request.body as Partial<DiscordBotConfig>;
    // In production, this would persist to DB. For now, env vars are used.
    log.info("Discord config update requested (env-based, requires restart)");
    return {
      ok: true,
      message: "Discord configuration is environment-based. Update DISCORD_BOT_TOKEN, DISCORD_APPLICATION_ID, and DISCORD_PUBLIC_KEY env vars.",
    };
  });

  // ─── Channel configuration endpoints ─────────────────────────────────

  fastify.get("/channels", {
    preHandler: fastifyRequireAuth,
  }, async () => {
    // TODO: Load from DB when channel config table is added
    return { channels: [] as DiscordChannelConfig[] };
  });

  fastify.put("/channels/:channelId", {
    preHandler: fastifyRequireAdmin,
  }, async (request) => {
    const { channelId } = request.params as { channelId: string };
    const body = request.body as Partial<DiscordChannelConfig>;
    log.info({ channelId, config: body }, "Discord channel config updated");
    return { ok: true, channelId };
  });
};

export default discordPlugin;
