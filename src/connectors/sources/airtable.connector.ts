/**
 * Airtable Connector — loads records from Airtable bases.
 * Supports: LoadConnector, PollConnector.
 */
import type { BaseConnectorConfig, LoadConnector, PollConnector } from "../interfaces.js";
import type { ConnectorDocument, ConnectorFailure } from "../models.js";
import { DocumentSource, SectionType } from "../models.js";

export class AirtableConnector implements LoadConnector, PollConnector {
  readonly displayName = "Airtable";
  readonly sourceType = DocumentSource.AIRTABLE;
  private config!: BaseConnectorConfig;
  private apiToken!: string;
  private baseId!: string;
  private tableIds: string[] = [];

  async init(config: BaseConnectorConfig): Promise<void> {
    this.config = config;
    this.baseId = config.settings.base_id as string;
    this.tableIds = (config.settings.table_ids as string[]) ?? [];
  }
  async loadCredentials(credentials: Record<string, unknown>): Promise<void> { this.apiToken = credentials.api_token as string; }
  async validateSettings(): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    if (!this.apiToken) errors.push("api_token is required");
    if (!this.baseId) errors.push("base_id is required");
    return { valid: errors.length === 0, errors };
  }

  async *loadFromState(): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    const tables = this.tableIds.length > 0 ? this.tableIds : await this.getTableIds();
    for (const tableId of tables) { yield* this.fetchRecords(tableId); }
  }

  async *pollSource(startEpochSecs: number): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    const tables = this.tableIds.length > 0 ? this.tableIds : await this.getTableIds();
    for (const tableId of tables) { yield* this.fetchRecords(tableId, startEpochSecs); }
  }

  private async getTableIds(): Promise<string[]> {
    const data = await this.atApi(`/meta/bases/${this.baseId}/tables`);
    return ((data.tables ?? []) as Array<Record<string, unknown>>).map((t) => t.id as string);
  }

  private async *fetchRecords(tableId: string, sinceEpoch?: number): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    let offset: string | undefined;
    do {
      try {
        const params: Record<string, string> = { pageSize: "100" };
        if (offset) params.offset = offset;
        const url = new URL(`https://api.airtable.com/v0/${this.baseId}/${tableId}`);
        for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
        const resp = await fetch(url.toString(), { headers: { Authorization: `Bearer ${this.apiToken}` } });
        if (!resp.ok) throw new Error(`Airtable API error: ${resp.status}`);
        const data = (await resp.json()) as Record<string, unknown>;
        const records = (data.records ?? []) as Array<Record<string, unknown>>;

        const docs: ConnectorDocument[] = records.map((r) => {
          const fields = (r.fields ?? {}) as Record<string, unknown>;
          return {
            id: `airtable:${this.baseId}:${tableId}:${r.id}`, source: DocumentSource.AIRTABLE,
            title: (fields.Name ?? fields.name ?? fields.Title ?? fields.title ?? r.id) as string,
            sections: [{
              type: SectionType.TEXT as const,
              content: Object.entries(fields).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`).join("\n"),
            }],
            metadata: { type: "record", tableId, baseId: this.baseId },
            lastModifiedEpochSecs: r.createdTime ? Math.floor(new Date(r.createdTime as string).getTime() / 1000) : undefined,
          };
        });
        if (docs.length > 0) yield docs;
        offset = data.offset as string | undefined;
      } catch (err) { yield { error: `Airtable fetch failed for table ${tableId}: ${(err as Error).message}` }; break; }
    } while (offset);
  }

  private async atApi(path: string): Promise<Record<string, unknown>> {
    const resp = await fetch(`https://api.airtable.com/v0${path}`, {
      headers: { Authorization: `Bearer ${this.apiToken}`, Accept: "application/json" },
    });
    if (!resp.ok) throw new Error(`Airtable API error: ${resp.status}`);
    return resp.json() as Promise<Record<string, unknown>>;
  }
}
