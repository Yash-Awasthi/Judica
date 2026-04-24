/**
 * Discord Connector — loads messages from Discord channels via Bot API.
 * Supports: LoadConnector, PollConnector.
 */

import type { BaseConnectorConfig, LoadConnector, PollConnector } from "../interfaces.js";
import type { ConnectorDocument, ConnectorFailure } from "../models.js";
import { DocumentSource, SectionType } from "../models.js";

export class DiscordConnector implements LoadConnector, PollConnector {
  readonly displayName = "Discord";
  readonly sourceType = DocumentSource.DISCORD;

  private config!: BaseConnectorConfig;
  private botToken!: string;
  private guildIds: string[] = [];
  private channelIds: string[] = [];

  async init(config: BaseConnectorConfig): Promise<void> {
    this.config = config;
    this.guildIds = (config.settings.guild_ids as string[]) ?? [];
    this.channelIds = (config.settings.channel_ids as string[]) ?? [];
  }

  async loadCredentials(credentials: Record<string, unknown>): Promise<void> {
    this.botToken = credentials.bot_token as string;
  }

  async validateSettings(): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    if (!this.botToken) errors.push("bot_token is required");
    if (this.guildIds.length === 0 && this.channelIds.length === 0)
      errors.push("At least one guild_id or channel_id is required");
    return { valid: errors.length === 0, errors };
  }

  async *loadFromState(): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    const channels = await this.resolveChannels();
    for (const channelId of channels) {
      yield* this.fetchMessages(channelId);
    }
  }

  async *pollSource(
    startEpochSecs: number,
  ): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    // Discord snowflake from epoch: ((epoch_ms - DISCORD_EPOCH) << 22)
    const DISCORD_EPOCH = 1420070400000;
    const afterSnowflake = String(BigInt(startEpochSecs * 1000 - DISCORD_EPOCH) << BigInt(22));
    const channels = await this.resolveChannels();
    for (const channelId of channels) {
      yield* this.fetchMessages(channelId, afterSnowflake);
    }
  }

  private async resolveChannels(): Promise<string[]> {
    if (this.channelIds.length > 0) return this.channelIds;
    const allChannels: string[] = [];
    for (const guildId of this.guildIds) {
      try {
        const channels = (await this.discordApi(`/guilds/${guildId}/channels`)) as Array<Record<string, unknown>>;
        allChannels.push(
          ...channels
            .filter((c) => c.type === 0) // text channels only
            .map((c) => c.id as string),
        );
      } catch (err) {
        // Skip inaccessible guilds
      }
    }
    return allChannels;
  }

  private async *fetchMessages(
    channelId: string,
    afterId?: string,
  ): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    let after = afterId;
    let hasMore = true;

    while (hasMore) {
      try {
        const params: Record<string, string> = { limit: "100" };
        if (after) params.after = after;
        const messages = (await this.discordApi(
          `/channels/${channelId}/messages`,
          params,
        )) as Array<Record<string, unknown>>;

        if (!Array.isArray(messages) || messages.length === 0) break;

        const docs: ConnectorDocument[] = messages.map((msg) => ({
          id: `discord:${channelId}:${msg.id}`,
          source: DocumentSource.DISCORD,
          title: `Discord #${channelId} — ${(msg.author as Record<string, unknown>)?.username ?? "unknown"}`,
          sourceUrl: `https://discord.com/channels/${msg.guild_id ?? "@me"}/${channelId}/${msg.id}`,
          sections: [{ type: SectionType.TEXT as const, content: (msg.content as string) ?? "" }],
          metadata: { type: "message", channelId },
          lastModifiedEpochSecs: msg.timestamp
            ? Math.floor(new Date(msg.timestamp as string).getTime() / 1000)
            : undefined,
          owners: msg.author ? [{ name: (msg.author as Record<string, unknown>).username as string }] : undefined,
        }));

        if (docs.length > 0) yield docs;
        after = messages[messages.length - 1].id as string;
        hasMore = messages.length === 100;
      } catch (err) {
        yield { error: `Discord message fetch failed for channel ${channelId}: ${(err as Error).message}` };
        break;
      }
    }
  }

  private async discordApi(path: string, params?: Record<string, string>): Promise<unknown> {
    const url = new URL(`https://discord.com/api/v10${path}`);
    if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const resp = await fetch(url.toString(), {
      headers: { Authorization: `Bot ${this.botToken}`, Accept: "application/json" },
    });
    if (!resp.ok) throw new Error(`Discord API error: ${resp.status} ${resp.statusText}`);
    return resp.json();
  }
}
