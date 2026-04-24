/**
 * Discord Bot — interaction verification and event handling.
 */

import { createHash } from "node:crypto";
import type {
  DiscordInteraction,
  DiscordBotConfig,
  DiscordEmbed,
} from "./models.js";
import { DiscordInteractionType, DiscordInteractionResponseType } from "./models.js";
import { DiscordBot } from "./bot.js";
import logger from "../../lib/logger.js";
import redis from "../../lib/redis.js";

const log = logger.child({ service: "discord-events" });

// ─── Ed25519 Signature Verification ──────────────────────────────────────────

export async function verifyDiscordSignature(
  publicKey: string,
  signature: string,
  timestamp: string,
  body: string,
): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      hexToUint8Array(publicKey),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    const message = new TextEncoder().encode(timestamp + body);
    return crypto.subtle.verify("Ed25519", key, hexToUint8Array(signature), message);
  } catch (err) {
    log.error({ error: (err as Error).message }, "Discord signature verification failed");
    return false;
  }
}

function hexToUint8Array(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

// ─── Rate Limiting ────────────────────────────────────────────────────────────

async function checkChannelRateLimit(channelId: string, limit: number): Promise<boolean> {
  const key = `discord:rl:${channelId}:${Math.floor(Date.now() / 60000)}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, 120);
  return count <= limit;
}

// ─── Interaction Handler ──────────────────────────────────────────────────────

export interface InteractionResponse {
  type: number;
  data?: {
    content?: string;
    embeds?: DiscordEmbed[];
    flags?: number;
  };
}

export async function handleInteraction(
  interaction: DiscordInteraction,
  config: DiscordBotConfig,
): Promise<InteractionResponse> {
  // PING — required for Discord endpoint verification
  if (interaction.type === DiscordInteractionType.PING) {
    return { type: DiscordInteractionResponseType.PONG };
  }

  // Slash commands
  if (interaction.type === DiscordInteractionType.APPLICATION_COMMAND) {
    const commandName = interaction.data?.name;
    const channelId = interaction.channel_id;

    if (channelId && !await checkChannelRateLimit(channelId, config.rateLimitPerChannel)) {
      return {
        type: DiscordInteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: "Rate limit exceeded. Please wait a moment before trying again.",
          flags: 64, // EPHEMERAL
        },
      };
    }

    switch (commandName) {
      case "ask":
        return handleAskCommand(interaction, config);
      case "search":
        return handleSearchCommand(interaction, config);
      case "help":
        return handleHelpCommand();
      default:
        return {
          type: DiscordInteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: { content: "Unknown command.", flags: 64 },
        };
    }
  }

  return { type: DiscordInteractionResponseType.PONG };
}

function handleAskCommand(
  interaction: DiscordInteraction,
  _config: DiscordBotConfig,
): InteractionResponse {
  const question = interaction.data?.options?.find((o) => o.name === "question")?.value as string;
  if (!question) {
    return {
      type: DiscordInteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { content: "Please provide a question.", flags: 64 },
    };
  }

  // Defer the response — actual answer will be sent via webhook edit
  // The bot service will pick this up from BullMQ and process async
  const channelId = interaction.channel_id ?? "";
  const userId = interaction.member?.user?.id ?? interaction.user?.id ?? "unknown";

  log.info({ channelId, userId, question: question.slice(0, 100) }, "Discord /ask command");

  return {
    type: DiscordInteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
  };
}

function handleSearchCommand(
  interaction: DiscordInteraction,
  _config: DiscordBotConfig,
): InteractionResponse {
  const query = interaction.data?.options?.find((o) => o.name === "query")?.value as string;
  if (!query) {
    return {
      type: DiscordInteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { content: "Please provide a search query.", flags: 64 },
    };
  }

  log.info({ query: query.slice(0, 100) }, "Discord /search command");

  return {
    type: DiscordInteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
  };
}

function handleHelpCommand(): InteractionResponse {
  const embed: DiscordEmbed = {
    title: "AI Assistant — Help",
    description: "I'm an AI assistant that can answer questions using the organization's knowledge base.",
    color: 0x5865F2,
    fields: [
      { name: "/ask <question>", value: "Ask the AI a question", inline: false },
      { name: "/search <query>", value: "Search the knowledge base", inline: false },
      { name: "/help", value: "Show this help message", inline: false },
    ],
    footer: { text: "Powered by aibyai" },
  };

  return {
    type: DiscordInteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      content: "",
      embeds: [embed],
    },
  };
}
