/**
 * Asana Connector — loads tasks and projects from Asana.
 * Supports: LoadConnector, PollConnector.
 */

import type { BaseConnectorConfig, LoadConnector, PollConnector } from "../interfaces.js";
import type { ConnectorDocument, ConnectorFailure } from "../models.js";
import { DocumentSource, SectionType } from "../models.js";

export class AsanaConnector implements LoadConnector, PollConnector {
  readonly displayName = "Asana";
  readonly sourceType = DocumentSource.ASANA;

  private config!: BaseConnectorConfig;
  private accessToken!: string;
  private workspaceId!: string;
  private projectIds: string[] = [];

  async init(config: BaseConnectorConfig): Promise<void> {
    this.config = config;
    this.workspaceId = config.settings.workspace_id as string;
    this.projectIds = (config.settings.project_ids as string[]) ?? [];
  }

  async loadCredentials(credentials: Record<string, unknown>): Promise<void> {
    this.accessToken = credentials.access_token as string;
  }

  async validateSettings(): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    if (!this.accessToken) errors.push("access_token is required");
    if (!this.workspaceId) errors.push("workspace_id is required");
    return { valid: errors.length === 0, errors };
  }

  async *loadFromState(): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    const projects = this.projectIds.length > 0 ? this.projectIds : await this.getProjectIds();
    for (const projectId of projects) {
      yield* this.fetchTasks(projectId);
    }
  }

  async *pollSource(startEpochSecs: number): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    const since = new Date(startEpochSecs * 1000).toISOString();
    const projects = this.projectIds.length > 0 ? this.projectIds : await this.getProjectIds();
    for (const projectId of projects) {
      yield* this.fetchTasks(projectId, since);
    }
  }

  private async getProjectIds(): Promise<string[]> {
    const data = await this.asanaApi(`/workspaces/${this.workspaceId}/projects`, { limit: "100" });
    return ((data.data ?? []) as Array<Record<string, unknown>>).map((p) => p.gid as string);
  }

  private async *fetchTasks(projectId: string, modifiedSince?: string): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    let offset: string | undefined;
    do {
      try {
        const params: Record<string, string> = {
          project: projectId,
          opt_fields: "gid,name,notes,completed,assignee.name,assignee.email,modified_at,permalink_url,tags.name",
          limit: "100",
        };
        if (modifiedSince) params.modified_since = modifiedSince;
        if (offset) params.offset = offset;

        const data = await this.asanaApi("/tasks", params);
        const tasks = (data.data ?? []) as Array<Record<string, unknown>>;

        const docs: ConnectorDocument[] = tasks.map((t) => ({
          id: `asana:${t.gid}`,
          source: DocumentSource.ASANA,
          title: (t.name as string) ?? "",
          sourceUrl: t.permalink_url as string,
          sections: [{ type: SectionType.TEXT as const, content: (t.notes as string) ?? "" }],
          metadata: { type: "task", completed: t.completed, projectId, tags: (t.tags as Array<Record<string, string>>)?.map((tg) => tg.name) },
          lastModifiedEpochSecs: t.modified_at
            ? Math.floor(new Date(t.modified_at as string).getTime() / 1000)
            : undefined,
          owners: t.assignee ? [{ name: (t.assignee as Record<string, unknown>).name as string, email: (t.assignee as Record<string, unknown>).email as string }] : undefined,
        }));

        if (docs.length > 0) yield docs;
        offset = (data.next_page as Record<string, string>)?.offset;
      } catch (err) {
        yield { error: `Asana task fetch failed for project ${projectId}: ${(err as Error).message}` };
        break;
      }
    } while (offset);
  }

  private async asanaApi(path: string, params?: Record<string, string>): Promise<Record<string, unknown>> {
    const url = new URL(`https://app.asana.com/api/1.0${path}`);
    if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const resp = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${this.accessToken}`, Accept: "application/json" },
    });
    if (!resp.ok) throw new Error(`Asana API error: ${resp.status} ${resp.statusText}`);
    return resp.json() as Promise<Record<string, unknown>>;
  }
}
