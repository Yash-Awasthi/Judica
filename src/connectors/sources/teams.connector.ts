/**
 * Microsoft Teams Connector — loads messages from Teams channels via Microsoft Graph.
 * Supports: LoadConnector, PollConnector.
 */

import type { BaseConnectorConfig, LoadConnector, PollConnector } from "../interfaces.js";
import type { ConnectorDocument, ConnectorFailure } from "../models.js";
import { DocumentSource, SectionType } from "../models.js";

export class TeamsConnector implements LoadConnector, PollConnector {
  readonly displayName = "Microsoft Teams";
  readonly sourceType = DocumentSource.TEAMS;

  private config!: BaseConnectorConfig;
  private accessToken!: string;
  private teamIds: string[] = [];

  async init(config: BaseConnectorConfig): Promise<void> {
    this.config = config;
    this.teamIds = (config.settings.team_ids as string[]) ?? [];
  }

  async loadCredentials(credentials: Record<string, unknown>): Promise<void> {
    this.accessToken = credentials.access_token as string;
  }

  async validateSettings(): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    if (!this.accessToken) errors.push("access_token is required");
    if (this.teamIds.length === 0) errors.push("At least one team_id is required");
    return { valid: errors.length === 0, errors };
  }

  async *loadFromState(): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    for (const teamId of this.teamIds) {
      yield* this.fetchTeamMessages(teamId);
    }
  }

  async *pollSource(
    startEpochSecs: number,
  ): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    const since = new Date(startEpochSecs * 1000).toISOString();
    for (const teamId of this.teamIds) {
      yield* this.fetchTeamMessages(teamId, since);
    }
  }

  private async *fetchTeamMessages(
    teamId: string,
    since?: string,
  ): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    try {
      const channels = await this.graphApi(`/teams/${teamId}/channels`);
      const channelList = (channels.value ?? []) as Array<Record<string, unknown>>;

      for (const channel of channelList) {
        const channelId = channel.id as string;
        const channelName = channel.displayName as string;
        let url: string | null = `/teams/${teamId}/channels/${channelId}/messages?$top=50`;
        if (since) url += `&$filter=lastModifiedDateTime gt ${since}`;

        while (url) {
          const data = await this.graphApi(url);
          const messages = (data.value ?? []) as Array<Record<string, unknown>>;

          const docs: ConnectorDocument[] = messages
            .filter((m) => (m.body as Record<string, unknown>)?.content)
            .map((msg) => ({
              id: `teams:${teamId}:${channelId}:${msg.id}`,
              source: DocumentSource.TEAMS,
              title: `Teams — ${channelName}: ${((msg.from as Record<string, Record<string, string>>)?.user?.displayName) ?? "unknown"}`,
              sourceUrl: msg.webUrl as string,
              sections: [{
                type: SectionType.TEXT as const,
                content: (msg.body as Record<string, unknown>)?.content as string,
              }],
              metadata: { type: "message", teamId, channelId, channelName },
              lastModifiedEpochSecs: msg.lastModifiedDateTime
                ? Math.floor(new Date(msg.lastModifiedDateTime as string).getTime() / 1000)
                : undefined,
              owners: (msg.from as Record<string, Record<string, string>>)?.user
                ? [{ name: (msg.from as Record<string, Record<string, string>>).user.displayName }]
                : undefined,
            }));

          if (docs.length > 0) yield docs;
          url = (data["@odata.nextLink"] as string) ?? null;
          if (url) url = url.replace("https://graph.microsoft.com/v1.0", "");
        }
      }
    } catch (err) {
      yield { error: `Teams fetch failed for team ${teamId}: ${(err as Error).message}` };
    }
  }

  private async graphApi(path: string): Promise<Record<string, unknown>> {
    const base = "https://graph.microsoft.com/v1.0";
    const url = path.startsWith("http") ? path : `${base}${path}`;
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${this.accessToken}`, Accept: "application/json" },
    });
    if (!resp.ok) throw new Error(`Graph API error: ${resp.status} ${resp.statusText}`);
    return resp.json() as Promise<Record<string, unknown>>;
  }
}
