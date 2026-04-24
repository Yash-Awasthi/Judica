/**
 * GitLab Connector — loads projects, issues, merge requests.
 * Supports: LoadConnector (full sync), PollConnector (incremental).
 */

import type { BaseConnectorConfig, LoadConnector, PollConnector } from "../interfaces.js";
import type { ConnectorDocument, ConnectorFailure } from "../models.js";
import { DocumentSource, SectionType } from "../models.js";

export class GitLabConnector implements LoadConnector, PollConnector {
  readonly displayName = "GitLab";
  readonly sourceType = DocumentSource.GITLAB;

  private config!: BaseConnectorConfig;
  private token!: string;
  private baseUrl = "https://gitlab.com";
  private projectIds: string[] = [];
  private includeIssues = true;
  private includeMRs = true;

  async init(config: BaseConnectorConfig): Promise<void> {
    this.config = config;
    const s = config.settings;
    this.baseUrl = (s.base_url as string) ?? "https://gitlab.com";
    this.projectIds = (s.project_ids as string[]) ?? [];
    this.includeIssues = (s.include_issues as boolean) ?? true;
    this.includeMRs = (s.include_merge_requests as boolean) ?? true;
  }

  async loadCredentials(credentials: Record<string, unknown>): Promise<void> {
    this.token = (credentials.private_token ?? credentials.access_token) as string;
  }

  async validateSettings(): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    if (!this.token) errors.push("private_token or access_token is required");
    if (this.projectIds.length === 0) errors.push("At least one project_id is required");
    return { valid: errors.length === 0, errors };
  }

  async *loadFromState(): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    for (const projectId of this.projectIds) {
      yield* this.fetchProject(projectId);
    }
  }

  async *pollSource(
    startEpochSecs: number,
    _endEpochSecs: number,
  ): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    const since = new Date(startEpochSecs * 1000).toISOString();
    for (const projectId of this.projectIds) {
      yield* this.fetchProject(projectId, since);
    }
  }

  private async *fetchProject(
    projectId: string,
    updatedAfter?: string,
  ): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    if (this.includeIssues) {
      let page = 1;
      let hasMore = true;
      while (hasMore) {
        try {
          const params: Record<string, string> = { per_page: "100", page: String(page) };
          if (updatedAfter) params.updated_after = updatedAfter;
          const issues = await this.glApi(`/projects/${encodeURIComponent(projectId)}/issues`, params);
          if (!Array.isArray(issues) || issues.length === 0) break;

          const docs: ConnectorDocument[] = issues.map((issue: Record<string, unknown>) => ({
            id: `gitlab:${projectId}:issue:${issue.iid}`,
            source: DocumentSource.GITLAB,
            title: `${projectId} #${issue.iid}: ${issue.title}`,
            sourceUrl: issue.web_url as string,
            sections: [{ type: SectionType.TEXT as const, content: (issue.description as string) ?? "" }],
            metadata: { type: "issue", project: projectId, state: issue.state, labels: issue.labels },
            lastModifiedEpochSecs: issue.updated_at
              ? Math.floor(new Date(issue.updated_at as string).getTime() / 1000)
              : undefined,
            owners: issue.author ? [{ name: (issue.author as Record<string, unknown>).username as string }] : undefined,
          }));

          if (docs.length > 0) yield docs;
          hasMore = issues.length === 100;
          page++;
        } catch (err) {
          yield { error: `GitLab issue fetch failed for ${projectId}: ${(err as Error).message}` };
          break;
        }
      }
    }

    if (this.includeMRs) {
      let page = 1;
      let hasMore = true;
      while (hasMore) {
        try {
          const params: Record<string, string> = { per_page: "100", page: String(page) };
          if (updatedAfter) params.updated_after = updatedAfter;
          const mrs = await this.glApi(`/projects/${encodeURIComponent(projectId)}/merge_requests`, params);
          if (!Array.isArray(mrs) || mrs.length === 0) break;

          const docs: ConnectorDocument[] = mrs.map((mr: Record<string, unknown>) => ({
            id: `gitlab:${projectId}:mr:${mr.iid}`,
            source: DocumentSource.GITLAB,
            title: `${projectId} MR !${mr.iid}: ${mr.title}`,
            sourceUrl: mr.web_url as string,
            sections: [{ type: SectionType.TEXT as const, content: (mr.description as string) ?? "" }],
            metadata: { type: "merge_request", project: projectId, state: mr.state, merged: mr.merged_at !== null },
            lastModifiedEpochSecs: mr.updated_at
              ? Math.floor(new Date(mr.updated_at as string).getTime() / 1000)
              : undefined,
            owners: mr.author ? [{ name: (mr.author as Record<string, unknown>).username as string }] : undefined,
          }));

          if (docs.length > 0) yield docs;
          hasMore = mrs.length === 100;
          page++;
        } catch (err) {
          yield { error: `GitLab MR fetch failed for ${projectId}: ${(err as Error).message}` };
          break;
        }
      }
    }
  }

  private async glApi(path: string, params?: Record<string, string>): Promise<unknown> {
    const url = new URL(`${this.baseUrl}/api/v4${path}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    }
    const resp = await fetch(url.toString(), {
      headers: { "PRIVATE-TOKEN": this.token },
    });
    if (!resp.ok) throw new Error(`GitLab API error: ${resp.status} ${resp.statusText}`);
    return resp.json();
  }
}
