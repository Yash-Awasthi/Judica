/**
 * Discord Bot — core bot class for sending messages and managing state.
 */

import type { DiscordBotConfig, DiscordEmbed } from "./models.js";
import logger from "../../lib/logger.js";

const log = logger.child({ service: "discord-bot" });

const DISCORD_API = "https://discord.com/api/v10";

export class DiscordBot {
  private config: DiscordBotConfig;

  constructor(config: DiscordBotConfig) {
    this.config = config;
  }

  async sendMessage(channelId: string, content: string, options?: {
    embeds?: DiscordEmbed[];
    replyTo?: string;
  }): Promise<Record<string, unknown>> {
    const body: Record<string, unknown> = {
      content: content.slice(0, this.config.maxResponseLength),
    };

    if (options?.embeds) body.embeds = options.embeds;
    if (options?.replyTo) {
      body.message_reference = { message_id: options.replyTo };
    }

    const resp = await this.apiCall(`/channels/${channelId}/messages`, "POST", body);
    return resp;
  }

  async editMessage(channelId: string, messageId: string, content: string, embeds?: DiscordEmbed[]): Promise<Record<string, unknown>> {
    const body: Record<string, unknown> = {
      content: content.slice(0, this.config.maxResponseLength),
    };
    if (embeds) body.embeds = embeds;
    return this.apiCall(`/channels/${channelId}/messages/${messageId}`, "PATCH", body);
  }

  async createThread(channelId: string, messageId: string, name: string): Promise<Record<string, unknown>> {
    return this.apiCall(`/channels/${channelId}/messages/${messageId}/threads`, "POST", {
      name: name.slice(0, 100),
      auto_archive_duration: 1440,
    });
  }

  async triggerTyping(channelId: string): Promise<void> {
    if (!this.config.showTypingIndicator) return;
    try {
      await this.apiCall(`/channels/${channelId}/typing`, "POST");
    } catch {
      // Non-critical
    }
  }

  async editInteractionResponse(interactionToken: string, content: string, embeds?: DiscordEmbed[]): Promise<Record<string, unknown>> {
    const body: Record<string, unknown> = {
      content: content.slice(0, this.config.maxResponseLength),
    };
    if (embeds) body.embeds = embeds;
    return this.apiCall(`/webhooks/${this.config.applicationId}/${interactionToken}/messages/@original`, "PATCH", body);
  }

  async registerSlashCommands(guildId?: string): Promise<void> {
    const commands = [
      {
        name: "ask",
        description: "Ask the AI assistant a question",
        options: [{
          name: "question",
          description: "Your question",
          type: 3, // STRING
          required: true,
        }],
      },
      {
        name: "search",
        description: "Search the knowledge base",
        options: [{
          name: "query",
          description: "Search query",
          type: 3,
          required: true,
        }],
      },
      {
        name: "help",
        description: "Show bot help and available commands",
      },
    ];

    const endpoint = guildId
      ? `/applications/${this.config.applicationId}/guilds/${guildId}/commands`
      : `/applications/${this.config.applicationId}/commands`;

    await this.apiCall(endpoint, "PUT", commands);
    log.info({ guildId: guildId ?? "global" }, "Slash commands registered");
  }

  private async apiCall(path: string, method: string, body?: unknown): Promise<Record<string, unknown>> {
    const resp = await fetch(`${DISCORD_API}${path}`, {
      method,
      headers: {
        Authorization: `Bot ${this.config.botToken}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!resp.ok) {
      const errorBody = await resp.text();
      log.error({ status: resp.status, path, error: errorBody }, "Discord API error");
      throw new Error(`Discord API error: ${resp.status} ${resp.statusText}`);
    }

    if (resp.status === 204) return {};
    return resp.json() as Promise<Record<string, unknown>>;
  }
}
