/**
 * HubSpot Connector — loads contacts, companies, deals, tickets, knowledge articles.
 * Supports: LoadConnector, PollConnector.
 */

import type { BaseConnectorConfig, LoadConnector, PollConnector } from "../interfaces.js";
import type { ConnectorDocument, ConnectorFailure } from "../models.js";
import { DocumentSource, SectionType } from "../models.js";

export class HubSpotConnector implements LoadConnector, PollConnector {
  readonly displayName = "HubSpot";
  readonly sourceType = DocumentSource.HUBSPOT;

  private config!: BaseConnectorConfig;
  private accessToken!: string;
  private objectTypes: string[] = [];

  async init(config: BaseConnectorConfig): Promise<void> {
    this.config = config;
    this.objectTypes = (config.settings.object_types as string[]) ?? ["contacts", "companies", "deals", "tickets"];
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
    for (const objType of this.objectTypes) {
      yield* this.fetchObjects(objType);
    }
  }

  async *pollSource(startEpochSecs: number): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    for (const objType of this.objectTypes) {
      yield* this.fetchObjects(objType, startEpochSecs);
    }
  }

  private async *fetchObjects(
    objectType: string,
    sinceEpoch?: number,
  ): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    let after: string | undefined;

    do {
      try {
        const params: Record<string, string> = { limit: "100" };
        if (after) params.after = after;

        const data = await this.hsApi(`/crm/v3/objects/${objectType}`, params);
        const results = (data.results ?? []) as Array<Record<string, unknown>>;
        if (results.length === 0) break;

        const docs: ConnectorDocument[] = [];
        for (const obj of results) {
          const props = (obj.properties ?? {}) as Record<string, unknown>;
          const updatedAt = props.hs_lastmodifieddate as string ?? props.lastmodifieddate as string;
          if (sinceEpoch && updatedAt) {
            if (Math.floor(new Date(updatedAt).getTime() / 1000) < sinceEpoch) continue;
          }

          const name = (props.firstname ? `${props.firstname} ${props.lastname ?? ""}` : props.name ?? props.subject ?? obj.id) as string;
          docs.push({
            id: `hubspot:${objectType}:${obj.id}`,
            source: DocumentSource.HUBSPOT,
            title: `${objectType}: ${name}`.trim(),
            sourceUrl: `https://app.hubspot.com/${objectType}/${obj.id}`,
            sections: [{
              type: SectionType.TEXT as const,
              content: Object.entries(props)
                .filter(([, v]) => v !== null && v !== "")
                .map(([k, v]) => `${k}: ${v}`)
                .join("\n"),
            }],
            metadata: { type: objectType, objectId: obj.id },
            lastModifiedEpochSecs: updatedAt
              ? Math.floor(new Date(updatedAt).getTime() / 1000)
              : undefined,
          });
        }

        if (docs.length > 0) yield docs;
        const paging = data.paging as Record<string, Record<string, string>> | undefined;
        after = paging?.next?.after;
      } catch (err) {
        yield { error: `HubSpot ${objectType} fetch failed: ${(err as Error).message}` };
        break;
      }
    } while (after);
  }

  private async hsApi(path: string, params?: Record<string, string>): Promise<Record<string, unknown>> {
    const url = new URL(`https://api.hubapi.com${path}`);
    if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const resp = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${this.accessToken}`, Accept: "application/json" },
    });
    if (!resp.ok) throw new Error(`HubSpot API error: ${resp.status} ${resp.statusText}`);
    return resp.json() as Promise<Record<string, unknown>>;
  }
}
