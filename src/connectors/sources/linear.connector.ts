/**
 * Linear Connector — loads issues and projects from Linear.
 * Supports: LoadConnector, PollConnector.
 */

import type { BaseConnectorConfig, LoadConnector, PollConnector } from "../interfaces.js";
import type { ConnectorDocument, ConnectorFailure } from "../models.js";
import { DocumentSource, SectionType } from "../models.js";

export class LinearConnector implements LoadConnector, PollConnector {
  readonly displayName = "Linear";
  readonly sourceType = DocumentSource.LINEAR;

  private config!: BaseConnectorConfig;
  private apiKey!: string;
  private teamIds: string[] = [];

  async init(config: BaseConnectorConfig): Promise<void> {
    this.config = config;
    this.teamIds = (config.settings.team_ids as string[]) ?? [];
  }

  async loadCredentials(credentials: Record<string, unknown>): Promise<void> {
    this.apiKey = credentials.api_key as string;
  }

  async validateSettings(): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    if (!this.apiKey) errors.push("api_key is required");
    return { valid: errors.length === 0, errors };
  }

  async *loadFromState(): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    yield* this.fetchIssues();
  }

  async *pollSource(startEpochSecs: number): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    const since = new Date(startEpochSecs * 1000).toISOString();
    yield* this.fetchIssues(since);
  }

  private async *fetchIssues(updatedAfter?: string): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    let hasMore = true;
    let endCursor: string | null = null;

    while (hasMore) {
      try {
        const filter: Record<string, unknown> = {};
        if (updatedAfter) filter.updatedAt = { gte: updatedAfter };
        if (this.teamIds.length > 0) filter.team = { id: { in: this.teamIds } };

        const query = `query($after: String, $filter: IssueFilter) {
          issues(first: 100, after: $after, filter: $filter) {
            nodes { id identifier title description url state { name } priority team { name } assignee { name email } updatedAt }
            pageInfo { hasNextPage endCursor }
          }
        }`;

        const data = await this.linearGql(query, { after: endCursor, filter: Object.keys(filter).length > 0 ? filter : undefined });
        const issues = data.data?.issues as Record<string, unknown>;
        const nodes = (issues?.nodes ?? []) as Array<Record<string, unknown>>;

        const docs: ConnectorDocument[] = nodes.map((issue) => ({
          id: `linear:${issue.id}`,
          source: DocumentSource.LINEAR,
          title: `${issue.identifier}: ${issue.title}`,
          sourceUrl: issue.url as string,
          sections: [{ type: SectionType.TEXT as const, content: (issue.description as string) ?? "" }],
          metadata: {
            type: "issue",
            state: (issue.state as Record<string, unknown>)?.name,
            priority: issue.priority,
            team: (issue.team as Record<string, unknown>)?.name,
          },
          lastModifiedEpochSecs: issue.updatedAt
            ? Math.floor(new Date(issue.updatedAt as string).getTime() / 1000)
            : undefined,
          owners: issue.assignee
            ? [{ name: (issue.assignee as Record<string, unknown>).name as string, email: (issue.assignee as Record<string, unknown>).email as string }]
            : undefined,
        }));

        if (docs.length > 0) yield docs;
        const pageInfo = issues?.pageInfo as Record<string, unknown>;
        hasMore = (pageInfo?.hasNextPage as boolean) ?? false;
        endCursor = (pageInfo?.endCursor as string) ?? null;
      } catch (err) {
        yield { error: `Linear fetch failed: ${(err as Error).message}` };
        break;
      }
    }
  }

  private async linearGql(query: string, variables: Record<string, unknown>): Promise<Record<string, unknown>> {
    const resp = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: { Authorization: this.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    if (!resp.ok) throw new Error(`Linear API error: ${resp.status}`);
    return resp.json() as Promise<Record<string, unknown>>;
  }
}
