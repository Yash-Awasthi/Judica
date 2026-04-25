/**
 * Gong Connector — loads call recordings and transcripts from Gong.
 * Supports: LoadConnector, PollConnector.
 */
import type { BaseConnectorConfig, LoadConnector, PollConnector } from "../interfaces.js";
import type { ConnectorDocument, ConnectorFailure } from "../models.js";
import { DocumentSource, SectionType } from "../models.js";

export class GongConnector implements LoadConnector, PollConnector {
  readonly displayName = "Gong";
  readonly sourceType = DocumentSource.GONG;
  private config!: BaseConnectorConfig;
  private accessKey!: string;
  private accessKeySecret!: string;

  async init(config: BaseConnectorConfig): Promise<void> { this.config = config; }
  async loadCredentials(credentials: Record<string, unknown>): Promise<void> {
    this.accessKey = credentials.access_key as string;
    this.accessKeySecret = credentials.access_key_secret as string;
  }
  async validateSettings(): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    if (!this.accessKey || !this.accessKeySecret) errors.push("access_key and access_key_secret are required");
    return { valid: errors.length === 0, errors };
  }

  async *loadFromState(): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> { yield* this.fetchCalls(); }
  async *pollSource(startEpochSecs: number): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> { yield* this.fetchCalls(startEpochSecs); }

  private async *fetchCalls(sinceEpoch?: number): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    try {
      const body: Record<string, unknown> = {};
      if (sinceEpoch) body.filter = { fromDateTime: new Date(sinceEpoch * 1000).toISOString() };
      const data = await this.gongApi("/v2/calls", body);
      const calls = ((data.records as Record<string, unknown>)?.calls ?? data.calls ?? []) as Array<Record<string, unknown>>;

      for (const call of calls) {
        try {
          const transcript = await this.gongApi(`/v2/calls/transcript`, { filter: { callIds: [call.id] } });
          const sentences = ((transcript.callTranscripts as Array<Record<string, unknown>>)?.[0]?.transcript ?? []) as Array<Record<string, unknown>>;
          const text = sentences.map((s) => `${(s.speakerName ?? "Speaker")}: ${s.sentence ?? s.text ?? ""}`).join("\n");

          yield [{
            id: `gong:${call.id}`, source: DocumentSource.GONG, title: (call.title as string) ?? `Gong Call ${call.id}`,
            sourceUrl: call.url as string ?? "",
            sections: [{ type: SectionType.TEXT, content: text || `Call: ${call.title}\nDuration: ${call.duration}s` }],
            metadata: { type: "call", duration: call.duration, direction: call.direction },
            lastModifiedEpochSecs: call.started ? Math.floor(new Date(call.started as string).getTime() / 1000) : undefined,
          }];
        } catch { /* skip individual call transcript errors */ }
      }
    } catch (err) { yield { error: `Gong fetch failed: ${(err as Error).message}` }; }
  }

  private async gongApi(path: string, body?: Record<string, unknown>): Promise<Record<string, unknown>> {
    const auth = Buffer.from(`${this.accessKey}:${this.accessKeySecret}`).toString("base64");
    const resp = await fetch(`https://api.gong.io${path}`, {
      method: "POST", headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!resp.ok) throw new Error(`Gong API error: ${resp.status}`);
    return resp.json() as Promise<Record<string, unknown>>;
  }
}
