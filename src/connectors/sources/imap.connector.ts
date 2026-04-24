/**
 * IMAP Connector — loads emails via IMAP protocol.
 * Supports: LoadConnector.
 * Note: Requires a proper IMAP client library in production (e.g., imapflow).
 * This implementation provides the connector skeleton with API-based structure.
 */
import type { BaseConnectorConfig, LoadConnector } from "../interfaces.js";
import type { ConnectorDocument, ConnectorFailure } from "../models.js";
import { DocumentSource, SectionType } from "../models.js";

export class ImapConnector implements LoadConnector {
  readonly displayName = "IMAP Email";
  readonly sourceType = DocumentSource.IMAP;
  private config!: BaseConnectorConfig;
  private host!: string;
  private port = 993;
  private username!: string;
  private password!: string;
  private tls = true;
  private mailboxes: string[] = [];

  async init(config: BaseConnectorConfig): Promise<void> {
    this.config = config;
    const s = config.settings;
    this.host = s.host as string;
    this.port = (s.port as number) ?? 993;
    this.tls = (s.tls as boolean) ?? true;
    this.mailboxes = (s.mailboxes as string[]) ?? ["INBOX"];
  }
  async loadCredentials(credentials: Record<string, unknown>): Promise<void> {
    this.username = credentials.username as string;
    this.password = credentials.password as string;
  }
  async validateSettings(): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    if (!this.host) errors.push("host is required");
    if (!this.username) errors.push("username is required");
    if (!this.password) errors.push("password is required");
    return { valid: errors.length === 0, errors };
  }

  async *loadFromState(): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    // IMAP requires a TCP connection library. This skeleton provides the interface.
    // In production, use `imapflow` package:
    //   const { ImapFlow } = await import("imapflow");
    //   const client = new ImapFlow({ host, port, secure: tls, auth: { user, pass } });
    yield {
      error: "IMAP connector requires the 'imapflow' package. Install it with: npm install imapflow",
    };
  }
}
