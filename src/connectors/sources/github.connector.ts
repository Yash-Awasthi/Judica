/**
 * GitHub Connector — loads repository content (issues, PRs, code, discussions).
 * Supports: PollConnector (incremental), LoadConnector (full sync).
 */

import type { BaseConnectorConfig, LoadConnector, PollConnector } from "../interfaces.js";
import type { ConnectorDocument, ConnectorFailure } from "../models.js";
import { DocumentSource, SectionType } from "../models.js";

interface GitHubRepo {
  owner: string;
  repo: string;
}

export class GitHubConnector implements LoadConnector, PollConnector {
  readonly displayName = "GitHub";
  readonly sourceType = DocumentSource.GITHUB;

  private config!: BaseConnectorConfig;
  private token!: string;
  private repos: GitHubRepo[] = [];
  private includeIssues = true;
  private includePRs = true;
  private includeReadme = true;

  async init(config: BaseConnectorConfig): Promise<void> {
    this.config = config;
    const settings = config.settings;
    this.repos = (settings.repos as GitHubRepo[]) ?? [];
    this.includeIssues = (settings.include_issues as boolean) ?? true;
    this.includePRs = (settings.include_prs as boolean) ?? true;
    this.includeReadme = (settings.include_readme as boolean) ?? true;
  }

  async loadCredentials(credentials: Record<string, unknown>): Promise<void> {
    this.token = (credentials.access_token ?? credentials.personal_access_token) as string;
  }

  async validateSettings(): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    if (!this.token) errors.push("access_token or personal_access_token is required");
    if (this.repos.length === 0) errors.push("At least one repository is required");
    return { valid: errors.length === 0, errors };
  }

  async *loadFromState(): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    for (const repo of this.repos) {
      yield* this.fetchRepo(repo);
    }
  }

  async *pollSource(
    startEpochSecs: number,
    _endEpochSecs: number,
  ): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    const since = new Date(startEpochSecs * 1000).toISOString();
    for (const repo of this.repos) {
      yield* this.fetchRepo(repo, since);
    }
  }

  private async *fetchRepo(
    repo: GitHubRepo,
    since?: string,
  ): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    const { owner, repo: repoName } = repo;

    // README
    if (this.includeReadme && !since) {
      try {
        const readme = await this.ghApi(`/repos/${owner}/${repoName}/readme`);
        if (readme.content) {
          const content = Buffer.from(readme.content as string, "base64").toString("utf-8");
          yield [{
            id: `github:${owner}/${repoName}:readme`,
            source: DocumentSource.GITHUB,
            title: `${owner}/${repoName} — README`,
            sourceUrl: readme.html_url as string,
            sections: [{ type: SectionType.TEXT, content }],
            metadata: { type: "readme", repo: `${owner}/${repoName}` },
          }];
        }
      } catch {
        // README not found — skip
      }
    }

    // Issues
    if (this.includeIssues) {
      let page = 1;
      let hasMore = true;
      while (hasMore) {
        const params: Record<string, string> = {
          state: "all",
          per_page: "100",
          page: String(page),
          sort: "updated",
        };
        if (since) params.since = since;

        const issues = await this.ghApi(`/repos/${owner}/${repoName}/issues`, params);
        if (!Array.isArray(issues) || issues.length === 0) break;

        const docs: ConnectorDocument[] = issues
          .filter((i: Record<string, unknown>) => !i.pull_request)
          .map((issue: Record<string, unknown>) => ({
            id: `github:${owner}/${repoName}:issue:${issue.number}`,
            source: DocumentSource.GITHUB,
            title: `${owner}/${repoName} #${issue.number}: ${issue.title}`,
            sourceUrl: issue.html_url as string,
            sections: [{
              type: SectionType.TEXT as const,
              content: (issue.body as string) ?? "",
              link: issue.html_url as string,
            }],
            metadata: {
              type: "issue",
              repo: `${owner}/${repoName}`,
              state: issue.state,
              labels: (issue.labels as Array<{ name: string }>)?.map((l) => l.name),
            },
            lastModifiedEpochSecs: issue.updated_at
              ? Math.floor(new Date(issue.updated_at as string).getTime() / 1000)
              : undefined,
            owners: issue.user ? [{ name: (issue.user as Record<string, unknown>).login as string }] : undefined,
          }));

        if (docs.length > 0) yield docs;
        hasMore = issues.length === 100;
        page++;
      }
    }

    // Pull Requests
    if (this.includePRs) {
      let page = 1;
      let hasMore = true;
      while (hasMore) {
        const params: Record<string, string> = {
          state: "all",
          per_page: "100",
          page: String(page),
          sort: "updated",
        };

        const prs = await this.ghApi(`/repos/${owner}/${repoName}/pulls`, params);
        if (!Array.isArray(prs) || prs.length === 0) break;

        // If polling, filter by updated_at
        const filtered = since
          ? prs.filter((pr: Record<string, unknown>) =>
              (pr.updated_at as string) >= since)
          : prs;

        const docs: ConnectorDocument[] = filtered.map((pr: Record<string, unknown>) => ({
          id: `github:${owner}/${repoName}:pr:${pr.number}`,
          source: DocumentSource.GITHUB,
          title: `${owner}/${repoName} PR #${pr.number}: ${pr.title}`,
          sourceUrl: pr.html_url as string,
          sections: [{
            type: SectionType.TEXT as const,
            content: (pr.body as string) ?? "",
            link: pr.html_url as string,
          }],
          metadata: {
            type: "pull_request",
            repo: `${owner}/${repoName}`,
            state: pr.state,
            merged: pr.merged_at !== null,
          },
          lastModifiedEpochSecs: pr.updated_at
            ? Math.floor(new Date(pr.updated_at as string).getTime() / 1000)
            : undefined,
          owners: pr.user ? [{ name: (pr.user as Record<string, unknown>).login as string }] : undefined,
        }));

        if (docs.length > 0) yield docs;
        hasMore = filtered.length === 100;
        page++;
      }
    }
  }

  private async ghApi(
    path: string,
    params?: Record<string, string>,
  ): Promise<Record<string, unknown>> {
    const url = new URL(`https://api.github.com${path}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    }

    const resp = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github.v3+json",
      },
    });

    if (!resp.ok) {
      throw new Error(`GitHub API error: ${resp.status} ${resp.statusText}`);
    }

    return resp.json() as Promise<Record<string, unknown>>;
  }
}
