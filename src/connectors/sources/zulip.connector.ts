/**
 * Zulip Connector — loads messages from Zulip streams via REST API.
 * Supports: LoadConnector, PollConnector.
 */

import type { BaseConnectorConfig, LoadConnector, PollConnector } from "../interfaces.js";
import type { ConnectorDocument, ConnectorFailure } from "../models.js";
import { DocumentSource, SectionType } from "../models.js";

export class ZulipConnector implements LoadConnector, PollConnector {
  readonly displayName = "Zulip";
  readonly sourceType = DocumentSource.ZULIP;

  private config!: BaseConnectorConfig;
  private realm!: string;
  private email!: string;
  private apiKey!: string;
  private streams: string[] = [];

  async init(config: BaseConnectorConfig): Promise<void> {
    this.config = config;
    this.realm = config.settings.realm as string;
    this.streams = (config.settings.streams as string[]) ?? [];
  }

  async loadCredentials(credentials: Record<string, unknown>): Promise<void> {
    this.email = credentials.email as string;
    this.apiKey = credentials.api_key as string;
  }

  async validateSettings(): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    if (!this.realm) errors.push("realm is required");
    if (!this.email) errors.push("email is required");
    if (!this.apiKey) errors.push("api_key is required");
    return { valid: errors.length === 0, errors };
  }

  async *loadFromState(): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    yield* this.fetchMessages();
  }

  async *pollSource(
    startEpochSecs: number,
  ): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    yield* this.fetchMessages(startEpochSecs);
  }

  private async *fetchMessages(
    afterEpochSecs?: number,
  ): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    let anchor = "oldest";
    let hasMore = true;

    while (hasMore) {
      try {
        const narrow: Array<Record<string, string>> = [];
        if (this.streams.length === 1) {
          narrow.push({ operator: "stream", operand: this.streams[0] });
        }

        const params: Record<string, string> = {
          anchor,
          num_before: "0",
          num_after: "100",
          narrow: JSON.stringify(narrow),
          apply_markdown: "false",
        };

        const data = (await this.zulipApi("/api/v1/messages", params)) as Record<string, unknown>;
        const messages = (data.messages as Array<Record<string, unknown>>) ?? [];

        if (!Array.isArray(messages) || messages.length === 0) break;

        const docs: ConnectorDocument[] = [];
        for (const msg of messages) {
          const msgEpoch = msg.timestamp as number;
          if (afterEpochSecs && msgEpoch < afterEpochSecs) continue;

          const streamName = (msg.stream_id ? String(msg.stream_id) : (msg.display_recipient as string)) ?? "unknown";
          const subject = (msg.subject ?? msg.topic ?? "(no topic)") as string;

          docs.push({
            id: `zulip:${msg.id}`,
            source: DocumentSource.ZULIP,
            title: `${streamName} > ${subject}`,
            sourceUrl: `${this.realm}/#narrow/id/${msg.id}`,
            sections: [{ type: SectionType.TEXT as const, content: (msg.content as string) ?? "" }],
            metadata: {
              streamId: msg.stream_id,
              subject,
              senderId: msg.sender_id,
              type: "message",
            },
            lastModifiedEpochSecs: msgEpoch,
            owners: msg.sender_full_name ? [{ name: msg.sender_full_name as string, email: msg.sender_email as string }] : undefined,
          });
        }

        if (docs.length > 0) yield docs;

        const lastMsg = messages[messages.length - 1];
        anchor = String((lastMsg.id as number) + 1);
        hasMore = (data.found_newest as boolean) === false && messages.length === 100;
      } catch (err) {
        yield { error: `Zulip fetch failed: ${(err as Error).message}` };
        break;
      }
    }
  }

  private async zulipApi(path: string, params?: Record<string, string>): Promise<unknown> {
    const url = new URL(`${this.realm}${path}`);
    if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const credentials = Buffer.from(`${this.email}:${this.apiKey}`).toString("base64");
    const resp = await fetch(url.toString(), {
      headers: {
        Authorization: `Basic ${credentials}`,
        Accept: "application/json",
      },
    });
    if (resp.status === 401 || resp.status === 403) {
      console.warn(`Zulip API auth error: ${resp.status}`);
      return { messages: [] };
    }
    if (!resp.ok) throw new Error(`Zulip API error: ${resp.status} ${resp.statusText}`);
    return resp.json();
  }
}
