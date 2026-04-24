/**
 * Fireflies Connector — loads meeting transcripts from Fireflies.ai.
 * Supports: LoadConnector, PollConnector.
 */
import type { BaseConnectorConfig, LoadConnector, PollConnector } from "../interfaces.js";
import type { ConnectorDocument, ConnectorFailure } from "../models.js";
import { DocumentSource, SectionType } from "../models.js";

export class FirefliesConnector implements LoadConnector, PollConnector {
  readonly displayName = "Fireflies";
  readonly sourceType = DocumentSource.FIREFLIES;
  private config!: BaseConnectorConfig;
  private apiKey!: string;

  async init(config: BaseConnectorConfig): Promise<void> { this.config = config; }
  async loadCredentials(credentials: Record<string, unknown>): Promise<void> { this.apiKey = credentials.api_key as string; }
  async validateSettings(): Promise<{ valid: boolean; errors: string[] }> {
    return { valid: !!this.apiKey, errors: this.apiKey ? [] : ["api_key is required"] };
  }

  async *loadFromState(): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> { yield* this.fetchTranscripts(); }
  async *pollSource(startEpochSecs: number): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> { yield* this.fetchTranscripts(startEpochSecs); }

  private async *fetchTranscripts(sinceEpoch?: number): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    try {
      const query = `query { transcripts { id title date duration organizer_email participants sentences { speaker_name text } summary { overview } } }`;
      const data = await this.ffGql(query);
      const transcripts = (data.data?.transcripts ?? []) as Array<Record<string, unknown>>;

      const docs: ConnectorDocument[] = [];
      for (const t of transcripts) {
        if (sinceEpoch && t.date) {
          if (Math.floor(new Date(t.date as string).getTime() / 1000) < sinceEpoch) continue;
        }
        const sentences = (t.sentences ?? []) as Array<Record<string, unknown>>;
        const text = sentences.map((s) => `${s.speaker_name}: ${s.text}`).join("\n");
        const summary = (t.summary as Record<string, unknown>)?.overview as string ?? "";

        docs.push({
          id: `fireflies:${t.id}`, source: DocumentSource.FIREFLIES, title: (t.title as string) ?? `Meeting ${t.id}`,
          sections: [{ type: SectionType.TEXT as const, content: summary ? `Summary: ${summary}\n\n---\n\n${text}` : text }],
          metadata: { type: "transcript", duration: t.duration, organizer: t.organizer_email, participants: t.participants },
          lastModifiedEpochSecs: t.date ? Math.floor(new Date(t.date as string).getTime() / 1000) : undefined,
        });
      }
      if (docs.length > 0) yield docs;
    } catch (err) { yield { error: `Fireflies fetch failed: ${(err as Error).message}` }; }
  }

  private async ffGql(query: string): Promise<Record<string, unknown>> {
    const resp = await fetch("https://api.fireflies.ai/graphql", {
      method: "POST", headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    if (!resp.ok) throw new Error(`Fireflies API error: ${resp.status}`);
    return resp.json() as Promise<Record<string, unknown>>;
  }
}
