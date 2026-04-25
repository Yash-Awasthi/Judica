/**
 * Bitbucket Connector — loads repositories, pull requests, issues.
 * Supports: LoadConnector, PollConnector.
 */

import type { BaseConnectorConfig, LoadConnector, PollConnector } from "../interfaces.js";
import type { ConnectorDocument, ConnectorFailure } from "../models.js";
import { DocumentSource, SectionType } from "../models.js";

export class BitbucketConnector implements LoadConnector, PollConnector {
  readonly displayName = "Bitbucket";
  readonly sourceType = DocumentSource.BITBUCKET;

  private config!: BaseConnectorConfig;
  private username!: string;
  private appPassword!: string;
  private workspaces: string[] = [];
  private repos: string[] = [];

  async init(config: BaseConnectorConfig): Promise<void> {
    this.config = config;
    const s = config.settings;
    this.workspaces = (s.workspaces as string[]) ?? [];
    this.repos = (s.repos as string[]) ?? [];
  }

  async loadCredentials(credentials: Record<string, unknown>): Promise<void> {
    this.username = credentials.username as string;
    this.appPassword = credentials.app_password as string;
  }

  async validateSettings(): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    if (!this.username) errors.push("username is required");
    if (!this.appPassword) errors.push("app_password is required");
    if (this.workspaces.length === 0 && this.repos.length === 0)
      errors.push("At least one workspace or repo is required");
    return { valid: errors.length === 0, errors };
  }

  async *loadFromState(): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    const repoSlugs = await this.resolveRepos();
    for (const slug of repoSlugs) {
      yield* this.fetchPullRequests(slug);
    }
  }

  async *pollSource(
    startEpochSecs: number,
    _endEpochSecs: number,
  ): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    const repoSlugs = await this.resolveRepos();
    for (const slug of repoSlugs) {
      yield* this.fetchPullRequests(slug, new Date(startEpochSecs * 1000).toISOString());
    }
  }

  private async resolveRepos(): Promise<string[]> {
    if (this.repos.length > 0) return this.repos;
    const allRepos: string[] = [];
    for (const ws of this.workspaces) {
      let url: string | null = `/repositories/${ws}?pagelen=100`;
      while (url) {
        const data = (await this.bbApi(url)) as Record<string, unknown>;
        const values = (data.values ?? []) as Array<Record<string, unknown>>;
        allRepos.push(...values.map((r) => r.full_name as string));
        url = (data.next as string) ?? null;
        if (url) url = url.replace("https://api.bitbucket.org/2.0", "");
      }
    }
    return allRepos;
  }

  private async *fetchPullRequests(
    repoSlug: string,
    updatedAfter?: string,
  ): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    let url: string | null = `/repositories/${repoSlug}/pullrequests?pagelen=50&state=MERGED&state=OPEN&state=DECLINED`;
    while (url) {
      try {
        const data = (await this.bbApi(url)) as Record<string, unknown>;
        const prs = (data.values ?? []) as Array<Record<string, unknown>>;
        if (prs.length === 0) break;

        const docs: ConnectorDocument[] = [];
        for (const pr of prs) {
          const updatedAt = pr.updated_on as string;
          if (updatedAfter && updatedAt < updatedAfter) continue;
          docs.push({
            id: `bitbucket:${repoSlug}:pr:${pr.id}`,
            source: DocumentSource.BITBUCKET,
            title: `${repoSlug} PR #${pr.id}: ${(pr.title as string) ?? ""}`,
            sourceUrl: ((pr.links as Record<string, Record<string, string>>)?.html?.href) ?? "",
            sections: [{ type: SectionType.TEXT, content: (pr.description as string) ?? "" }],
            metadata: { type: "pull_request", repo: repoSlug, state: pr.state },
            lastModifiedEpochSecs: updatedAt ? Math.floor(new Date(updatedAt).getTime() / 1000) : undefined,
            owners: pr.author ? [{ name: (pr.author as Record<string, unknown>).display_name as string }] : undefined,
          });
        }
        if (docs.length > 0) yield docs;
        url = (data.next as string) ?? null;
        if (url) url = url.replace("https://api.bitbucket.org/2.0", "");
      } catch (err) {
        yield { error: `Bitbucket PR fetch failed for ${repoSlug}: ${(err as Error).message}` };
        break;
      }
    }
  }

  private async bbApi(path: string): Promise<unknown> {
    const base = "https://api.bitbucket.org/2.0";
    const url = path.startsWith("http") ? path : `${base}${path}`;
    const resp = await fetch(url, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.username}:${this.appPassword}`).toString("base64")}`,
        Accept: "application/json",
      },
    });
    if (!resp.ok) throw new Error(`Bitbucket API error: ${resp.status} ${resp.statusText}`);
    return resp.json();
  }
}
