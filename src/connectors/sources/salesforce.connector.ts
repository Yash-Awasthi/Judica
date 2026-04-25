/**
 * Salesforce Connector — loads records via Salesforce REST API (SOQL).
 * Supports: LoadConnector, PollConnector.
 */

import type { BaseConnectorConfig, LoadConnector, PollConnector } from "../interfaces.js";
import type { ConnectorDocument, ConnectorFailure } from "../models.js";
import { DocumentSource, SectionType } from "../models.js";

export class SalesforceConnector implements LoadConnector, PollConnector {
  readonly displayName = "Salesforce";
  readonly sourceType = DocumentSource.SALESFORCE;

  private config!: BaseConnectorConfig;
  private accessToken!: string;
  private instanceUrl!: string;
  private objectTypes: string[] = [];

  async init(config: BaseConnectorConfig): Promise<void> {
    this.config = config;
    this.objectTypes = (config.settings.object_types as string[]) ?? ["Account", "Contact", "Opportunity", "Case", "KnowledgeArticle"];
  }

  async loadCredentials(credentials: Record<string, unknown>): Promise<void> {
    this.accessToken = credentials.access_token as string;
    this.instanceUrl = (credentials.instance_url as string) ?? "";
  }

  async validateSettings(): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    if (!this.accessToken) errors.push("access_token is required");
    if (!this.instanceUrl) errors.push("instance_url is required");
    return { valid: errors.length === 0, errors };
  }

  async *loadFromState(): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    for (const objType of this.objectTypes) {
      yield* this.fetchRecords(objType);
    }
  }

  async *pollSource(startEpochSecs: number): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    const since = new Date(startEpochSecs * 1000).toISOString();
    for (const objType of this.objectTypes) {
      yield* this.fetchRecords(objType, since);
    }
  }

  private async *fetchRecords(
    objectType: string,
    since?: string,
  ): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    try {
      let soql = `SELECT Id, Name, CreatedDate, LastModifiedDate FROM ${objectType}`;
      if (since) soql += ` WHERE LastModifiedDate > ${since}`;
      soql += " ORDER BY LastModifiedDate DESC LIMIT 200";

      let url: string | null = `/services/data/v59.0/query?q=${encodeURIComponent(soql)}`;

      while (url) {
        const data = await this.sfApi(url);
        const records = (data.records ?? []) as Array<Record<string, unknown>>;

        const docs: ConnectorDocument[] = records.map((rec) => ({
          id: `salesforce:${objectType}:${rec.Id}`,
          source: DocumentSource.SALESFORCE,
          title: `${objectType}: ${(rec.Name as string) ?? rec.Id}`,
          sourceUrl: `${this.instanceUrl}/${rec.Id}`,
          sections: [{
            type: SectionType.TEXT as const,
            content: Object.entries(rec)
              .filter(([k]) => !k.startsWith("attributes"))
              .map(([k, v]) => `${k}: ${v}`)
              .join("\n"),
          }],
          metadata: { type: objectType.toLowerCase(), objectType },
          lastModifiedEpochSecs: rec.LastModifiedDate
            ? Math.floor(new Date(rec.LastModifiedDate as string).getTime() / 1000)
            : undefined,
        }));

        if (docs.length > 0) yield docs;
        url = (data.nextRecordsUrl as string) ?? null;
      }
    } catch (err) {
      yield { error: `Salesforce ${objectType} fetch failed: ${(err as Error).message}` };
    }
  }

  private async sfApi(path: string): Promise<Record<string, unknown>> {
    const url = path.startsWith("http") ? path : `${this.instanceUrl}${path}`;
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${this.accessToken}`, Accept: "application/json" },
    });
    if (!resp.ok) throw new Error(`Salesforce API error: ${resp.status} ${resp.statusText}`);
    return resp.json() as Promise<Record<string, unknown>>;
  }
}
