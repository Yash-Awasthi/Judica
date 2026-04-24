/**
 * Slack Connector — polls Slack channels for messages.
 * Supports: PollConnector (incremental by time range).
 */

import type { BaseConnectorConfig, PollConnector } from "../interfaces.js";
import type { ConnectorDocument, ConnectorFailure } from "../models.js";
import { DocumentSource, SectionType } from "../models.js";

interface SlackChannel {
  id: string;
  name: string;
  is_private: boolean;
}

interface SlackMessage {
  ts: string;
  text: string;
  user?: string;
  thread_ts?: string;
  files?: Array<{ name: string; url_private: string; mimetype: string }>;
}

export class SlackConnector implements PollConnector {
  readonly displayName = "Slack";
  readonly sourceType = DocumentSource.SLACK;

  private config!: BaseConnectorConfig;
  private token!: string;
  private channels: string[] = [];

  async init(config: BaseConnectorConfig): Promise<void> {
    this.config = config;
    this.channels = (config.settings.channels as string[]) ?? [];
  }

  async loadCredentials(credentials: Record<string, unknown>): Promise<void> {
    this.token = credentials.bot_token as string;
  }

  async validateSettings(): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    if (!this.token) errors.push("bot_token is required");
    return { valid: errors.length === 0, errors };
  }

  async *pollSource(
    startEpochSecs: number,
    endEpochSecs: number,
  ): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    const channelIds = this.channels.length > 0
      ? this.channels
      : await this.listAllChannels();

    for (const channelId of channelIds) {
      try {
        const docs = await this.fetchChannelMessages(channelId, startEpochSecs, endEpochSecs);
        if (docs.length > 0) yield docs;
      } catch (err) {
        yield { error: `Failed to fetch channel ${channelId}: ${(err as Error).message}` };
      }
    }
  }

  private async listAllChannels(): Promise<string[]> {
    const resp = await this.slackApi("conversations.list", {
      types: "public_channel,private_channel",
      limit: "200",
      exclude_archived: "true",
    });

    if (!resp.ok) return [];
    return (resp.channels as SlackChannel[]).map((c) => c.id);
  }

  private async fetchChannelMessages(
    channelId: string,
    startEpoch: number,
    endEpoch: number,
  ): Promise<ConnectorDocument[]> {
    const resp = await this.slackApi("conversations.history", {
      channel: channelId,
      oldest: String(startEpoch),
      latest: String(endEpoch),
      limit: "200",
    });

    if (!resp.ok) return [];

    const messages = resp.messages as SlackMessage[];
    const channelInfo = await this.getChannelInfo(channelId);
    const channelName = channelInfo?.name ?? channelId;

    return messages
      .filter((m) => m.text && m.text.trim().length > 0)
      .map((m) => ({
        id: `slack:${channelId}:${m.ts}`,
        source: DocumentSource.SLACK,
        title: `#${channelName} — ${new Date(parseFloat(m.ts) * 1000).toISOString()}`,
        sections: [{ type: SectionType.TEXT as const, content: m.text }],
        metadata: {
          channelId,
          channelName,
          userId: m.user,
          threadTs: m.thread_ts,
          hasFiles: (m.files?.length ?? 0) > 0,
        },
        lastModifiedEpochSecs: parseFloat(m.ts),
      }));
  }

  private async getChannelInfo(channelId: string): Promise<SlackChannel | null> {
    try {
      const resp = await this.slackApi("conversations.info", { channel: channelId });
      return resp.ok ? (resp.channel as SlackChannel) : null;
    } catch {
      return null;
    }
  }

  private async slackApi(
    method: string,
    params: Record<string, string>,
  ): Promise<Record<string, unknown>> {
    const url = new URL(`https://slack.com/api/${method}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

    const resp = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${this.token}` },
    });

    return resp.json() as Promise<Record<string, unknown>>;
  }
}
