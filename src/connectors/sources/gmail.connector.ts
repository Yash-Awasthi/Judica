/**
 * Gmail Connector — loads emails via Gmail API.
 * Supports: LoadConnector, PollConnector.
 */

import type { BaseConnectorConfig, LoadConnector, PollConnector } from "../interfaces.js";
import type { ConnectorDocument, ConnectorFailure } from "../models.js";
import { DocumentSource, SectionType } from "../models.js";

export class GmailConnector implements LoadConnector, PollConnector {
  readonly displayName = "Gmail";
  readonly sourceType = DocumentSource.GMAIL;

  private config!: BaseConnectorConfig;
  private accessToken!: string;
  private labelIds: string[] = [];
  private query = "";

  async init(config: BaseConnectorConfig): Promise<void> {
    this.config = config;
    this.labelIds = (config.settings.label_ids as string[]) ?? ["INBOX"];
    this.query = (config.settings.query as string) ?? "";
  }

  async loadCredentials(credentials: Record<string, unknown>): Promise<void> {
    this.accessToken = credentials.access_token as string;
  }

  async validateSettings(): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    if (!this.accessToken) errors.push("access_token is required");
    return { valid: errors.length === 0, errors };
  }

  async *loadFromState(): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    yield* this.fetchEmails();
  }

  async *pollSource(
    startEpochSecs: number,
  ): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    yield* this.fetchEmails(`after:${startEpochSecs}`);
  }

  private async *fetchEmails(
    additionalQuery?: string,
  ): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    let pageToken: string | undefined;
    const q = [this.query, additionalQuery].filter(Boolean).join(" ");

    do {
      try {
        const params: Record<string, string> = { maxResults: "100" };
        if (q) params.q = q;
        if (this.labelIds.length > 0) params.labelIds = this.labelIds.join(",");
        if (pageToken) params.pageToken = pageToken;

        const list = await this.gmailApi("/messages", params);
        const messages = (list.messages ?? []) as Array<Record<string, unknown>>;
        if (messages.length === 0) break;

        const docs: ConnectorDocument[] = [];
        for (const msg of messages) {
          try {
            const full = await this.gmailApi(`/messages/${msg.id}`, { format: "full" });
            const headers = (full.payload as Record<string, unknown>)?.headers as Array<Record<string, string>> ?? [];
            const subject = headers.find((h) => h.name === "Subject")?.value ?? "(no subject)";
            const from = headers.find((h) => h.name === "From")?.value ?? "";
            const date = headers.find((h) => h.name === "Date")?.value ?? "";
            const snippet = full.snippet as string ?? "";

            docs.push({
              id: `gmail:${msg.id}`,
              source: DocumentSource.GMAIL,
              title: subject,
              sections: [{
                type: SectionType.TEXT,
                content: `From: ${from}\nDate: ${date}\nSubject: ${subject}\n\n${snippet}`,
              }],
              metadata: { type: "email", from, threadId: msg.threadId, labelIds: full.labelIds },
              lastModifiedEpochSecs: full.internalDate
                ? Math.floor(Number(full.internalDate) / 1000)
                : undefined,
              owners: from ? [{ email: from }] : undefined,
            });
          } catch {
            // Skip individual message errors
          }
        }

        if (docs.length > 0) yield docs;
        pageToken = list.nextPageToken as string | undefined;
      } catch (err) {
        yield { error: `Gmail fetch failed: ${(err as Error).message}` };
        break;
      }
    } while (pageToken);
  }

  private async gmailApi(path: string, params?: Record<string, string>): Promise<Record<string, unknown>> {
    const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me${path}`);
    if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const resp = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${this.accessToken}`, Accept: "application/json" },
    });
    if (!resp.ok) throw new Error(`Gmail API error: ${resp.status} ${resp.statusText}`);
    return resp.json() as Promise<Record<string, unknown>>;
  }
}
