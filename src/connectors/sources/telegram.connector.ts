/**
 * Telegram Connector — loads messages from Telegram chats/channels via Bot API.
 * Supports: LoadConnector, PollConnector.
 */

import type { BaseConnectorConfig, LoadConnector, PollConnector } from "../interfaces.js";
import type { ConnectorDocument, ConnectorFailure } from "../models.js";
import { DocumentSource, SectionType } from "../models.js";

export class TelegramConnector implements LoadConnector, PollConnector {
  readonly displayName = "Telegram";
  readonly sourceType = DocumentSource.TELEGRAM;

  private config!: BaseConnectorConfig;
  private botToken!: string;
  private chatIds: string[] = [];

  async init(config: BaseConnectorConfig): Promise<void> {
    this.config = config;
    this.chatIds = (config.settings.chat_ids as string[]) ?? [];
  }

  async loadCredentials(credentials: Record<string, unknown>): Promise<void> {
    this.botToken = credentials.bot_token as string;
  }

  async validateSettings(): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    if (!this.botToken) errors.push("bot_token is required");
    if (this.chatIds.length === 0) errors.push("At least one chat_id is required");
    return { valid: errors.length === 0, errors };
  }

  async *loadFromState(): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    for (const chatId of this.chatIds) {
      yield* this.fetchMessages(chatId);
    }
  }

  async *pollSource(
    startEpochSecs: number,
  ): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    for (const chatId of this.chatIds) {
      yield* this.fetchMessages(chatId, startEpochSecs);
    }
  }

  private async *fetchMessages(
    chatId: string,
    afterEpochSecs?: number,
  ): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    // First resolve chat name
    let chatTitle = chatId;
    try {
      const chatInfo = (await this.telegramApi("getChat", { chat_id: chatId })) as Record<string, unknown>;
      const result = chatInfo.result as Record<string, unknown>;
      chatTitle = (result?.title ?? result?.username ?? chatId) as string;
    } catch {
      // Use chatId as fallback title
    }

    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      try {
        const params: Record<string, string> = {
          offset: String(offset),
          limit: "100",
          allowed_updates: '["message"]',
        };
        const response = (await this.telegramApi("getUpdates", params)) as Record<string, unknown>;
        const updates = (response.result as Array<Record<string, unknown>>) ?? [];

        if (!Array.isArray(updates) || updates.length === 0) break;

        const docs: ConnectorDocument[] = [];
        for (const update of updates) {
          const msg = update.message as Record<string, unknown> | undefined;
          if (!msg) continue;

          const msgChatId = String((msg.chat as Record<string, unknown>)?.id ?? "");
          if (msgChatId !== chatId) continue;

          const msgDate = msg.date as number;
          if (afterEpochSecs && msgDate < afterEpochSecs) continue;

          const msgId = update.update_id as number;
          const from = msg.from as Record<string, unknown> | undefined;
          const text = (msg.text ?? msg.caption ?? "") as string;

          docs.push({
            id: `telegram:${chatId}:${msg.message_id}`,
            source: DocumentSource.TELEGRAM,
            title: `${chatTitle} — ${new Date(msgDate * 1000).toISOString()}`,
            sourceUrl: `https://t.me/${chatId.replace(/^-100/, "")}/${msg.message_id}`,
            sections: [{ type: SectionType.TEXT as const, content: text }],
            metadata: { chatId, messageId: msg.message_id, type: "message" },
            lastModifiedEpochSecs: msgDate,
            owners: from ? [{ name: [from.first_name, from.last_name].filter(Boolean).join(" ") || (from.username as string) }] : undefined,
          });

          offset = msgId + 1;
        }

        if (docs.length > 0) yield docs;
        hasMore = updates.length === 100;
      } catch (err) {
        yield { error: `Telegram fetch failed for chat ${chatId}: ${(err as Error).message}` };
        break;
      }
    }
  }

  private async telegramApi(method: string, params?: Record<string, string>): Promise<unknown> {
    const url = new URL(`https://api.telegram.org/bot${this.botToken}/${method}`);
    if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const resp = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
    });
    if (resp.status === 401 || resp.status === 403) {
      console.warn(`Telegram API auth error: ${resp.status}`);
      return { result: [] };
    }
    if (!resp.ok) throw new Error(`Telegram API error: ${resp.status} ${resp.statusText}`);
    return resp.json();
  }
}
