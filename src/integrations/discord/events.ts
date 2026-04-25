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

// ─── Discord Gateway Message Event Types ─────────────────────────────────────

export interface DiscordMessageCreateEvent {
  id: string;
  channel_id: string;
  guild_id?: string;
  content: string;
  author: {
    id: string;
    username: string;
    bot?: boolean;
  };
  mentions: Array<{ id: string; username: string; bot?: boolean }>;
  referenced_message?: {
    id: string;
    channel_id: string;
    content: string;
  };
}

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
      hexToUint8Array(publicKey) as unknown as BufferSource,
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    const message = new TextEncoder().encode(timestamp + body);
    return crypto.subtle.verify("Ed25519", key, hexToUint8Array(signature) as unknown as BufferSource, message);
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
  config: DiscordBotConfig,
): InteractionResponse {
  const question = interaction.data?.options?.find((o) => o.name === "question")?.value as string;
  if (!question) {
    return {
      type: DiscordInteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { content: "Please provide a question.", flags: 64 },
    };
  }

  const channelId = interaction.channel_id ?? "";
  const userId = interaction.member?.user?.id ?? interaction.user?.id ?? "unknown";
  const interactionToken = interaction.token;

  log.info({ channelId, userId, question: question.slice(0, 100) }, "Discord /ask command");

  // Call the AI service async and edit the deferred response
  const bot = new DiscordBot(config);
  (async () => {
    try {
      const apiBaseUrl = process.env.SLACK_API_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
      const apiKey = process.env.SLACK_INTERNAL_API_KEY;

      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

      const res = await fetch(`${apiBaseUrl}/api/ask`, {
        method: "POST",
        headers,
        body: JSON.stringify({ query: question }),
        signal: AbortSignal.timeout(60000),
      });

      if (!res.ok) throw new Error(`API returned ${res.status}`);

      const data = (await res.json()) as { answer?: string; sources?: Array<{ title: string; url: string }> };
      let answer = data.answer || "I couldn't find an answer to that question.";

      if (answer.length > config.maxResponseLength) {
        answer = answer.slice(0, config.maxResponseLength - 3) + "...";
      }

      if (config.includeSources && data.sources && data.sources.length > 0) {
        const sourcesText = data.sources
          .slice(0, 3)
          .map((s, i) => `${i + 1}. ${s.url ? `[${s.title}](${s.url})` : s.title}`)
          .join("\n");
        answer += `\n\n**Sources:**\n${sourcesText}`;
      }

      await bot.editInteractionResponse(interactionToken, answer);
    } catch (err) {
      log.error({ err, channelId, userId }, "Failed to process Discord /ask command");
      await bot.editInteractionResponse(
        interactionToken,
        "Sorry, I encountered an error processing your question. Please try again.",
      ).catch(() => {});
    }
  })().catch((err) => {
    log.error({ err }, "Async Discord /ask handling failed");
  });

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

// ─── MESSAGE_CREATE Handler (Gateway Events) ──────────────────────────────────

/**
 * Handle Discord MESSAGE_CREATE events where the bot is @mentioned.
 * Called from the /messages webhook route, which receives gateway events
 * forwarded by a gateway proxy (e.g., discord-gateway-proxy or similar).
 *
 * @param message - The Discord message object from the gateway event
 * @param botUserId - The bot's own Discord user ID (to detect mentions)
 * @param config - Discord bot configuration
 */
export async function handleMessageCreate(
  message: DiscordMessageCreateEvent,
  botUserId: string,
  config: DiscordBotConfig,
): Promise<void> {
  // Ignore messages from bots (including ourselves)
  if (message.author.bot) return;

  // Check if bot is mentioned
  const isMentioned = message.mentions.some((u) => u.id === botUserId);
  if (!isMentioned) return;

  // Strip bot mention(s) from message content
  const query = message.content.replace(/<@!?[0-9]+>/g, "").trim();
  if (!query) return;

  log.info(
    { channelId: message.channel_id, authorId: message.author.id, query: query.slice(0, 100) },
    "Discord @mention received",
  );

  const bot = new DiscordBot(config);

  // Rate limit check
  if (!await checkChannelRateLimit(message.channel_id, config.rateLimitPerChannel)) {
    await bot.sendMessage(message.channel_id, "Rate limit exceeded. Please wait a moment before trying again.", {
      replyTo: message.id,
    });
    return;
  }

  // Show typing indicator
  await bot.triggerTyping(message.channel_id);

  try {
    const apiBaseUrl = process.env.SLACK_API_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
    const apiKey = process.env.SLACK_INTERNAL_API_KEY;

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

    const res = await fetch(`${apiBaseUrl}/api/ask`, {
      method: "POST",
      headers,
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(60000),
    });

    if (!res.ok) throw new Error(`API returned ${res.status}`);

    const data = (await res.json()) as { answer?: string; sources?: Array<{ title: string; url: string }> };
    let answer = data.answer || "I couldn't find an answer to that question.";

    if (answer.length > config.maxResponseLength) {
      answer = answer.slice(0, config.maxResponseLength - 3) + "...";
    }

    if (config.includeSources && data.sources && data.sources.length > 0) {
      const sourcesText = data.sources
        .slice(0, 3)
        .map((s, i) => `${i + 1}. ${s.url ? `[${s.title}](${s.url})` : s.title}`)
        .join("\n");
      answer += `\n\n**Sources:**\n${sourcesText}`;
    }

    await bot.sendMessage(message.channel_id, answer, { replyTo: message.id });
  } catch (err) {
    log.error({ err, channelId: message.channel_id }, "Failed to process Discord @mention");
    await bot.sendMessage(
      message.channel_id,
      "Sorry, I encountered an error processing your question. Please try again.",
      { replyTo: message.id },
    ).catch(() => {});
  }
}
