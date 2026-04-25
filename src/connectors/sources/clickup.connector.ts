/**
 * ClickUp Connector — loads tasks from ClickUp workspaces.
 * Supports: LoadConnector, PollConnector.
 */

import type { BaseConnectorConfig, LoadConnector, PollConnector } from "../interfaces.js";
import type { ConnectorDocument, ConnectorFailure } from "../models.js";
import { DocumentSource, SectionType } from "../models.js";

export class ClickUpConnector implements LoadConnector, PollConnector {
  readonly displayName = "ClickUp";
  readonly sourceType = DocumentSource.CLICKUP;

  private config!: BaseConnectorConfig;
  private apiToken!: string;
  private teamId!: string;

  async init(config: BaseConnectorConfig): Promise<void> {
    this.config = config;
    this.teamId = config.settings.team_id as string;
  }

  async loadCredentials(credentials: Record<string, unknown>): Promise<void> {
    this.apiToken = credentials.api_token as string;
  }

  async validateSettings(): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    if (!this.apiToken) errors.push("api_token is required");
    if (!this.teamId) errors.push("team_id is required");
    return { valid: errors.length === 0, errors };
  }

  async *loadFromState(): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    yield* this.fetchTasks();
  }

  async *pollSource(startEpochSecs: number): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    yield* this.fetchTasks(startEpochSecs * 1000);
  }

  private async *fetchTasks(dateUpdatedGt?: number): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    try {
      const spaces = await this.cuApi(`/team/${this.teamId}/space`);
      const spaceList = ((spaces as Record<string, unknown>).spaces ?? []) as Array<Record<string, unknown>>;

      for (const space of spaceList) {
        const folders = await this.cuApi(`/space/${space.id}/folder`);
        const folderList = ((folders as Record<string, unknown>).folders ?? []) as Array<Record<string, unknown>>;

        for (const folder of folderList) {
          const lists = ((folder.lists ?? []) as Array<Record<string, unknown>>);
          for (const list of lists) {
            yield* this.fetchTasksFromList(list.id as string, dateUpdatedGt);
          }
        }

        // Folderless lists
        const folderlessLists = await this.cuApi(`/space/${space.id}/list`);
        for (const list of ((folderlessLists as Record<string, unknown>).lists ?? []) as Array<Record<string, unknown>>) {
          yield* this.fetchTasksFromList(list.id as string, dateUpdatedGt);
        }
      }
    } catch (err) {
      yield { error: `ClickUp fetch failed: ${(err as Error).message}` };
    }
  }

  private async *fetchTasksFromList(listId: string, dateUpdatedGt?: number): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    let page = 0;
    let hasMore = true;

    while (hasMore) {
      try {
        const params: Record<string, string> = { page: String(page) };
        if (dateUpdatedGt) params.date_updated_gt = String(dateUpdatedGt);

        const url = new URL(`https://api.clickup.com/api/v2/list/${listId}/task`);
        for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

        const data = (await this.cuApi(url.pathname + url.search)) as Record<string, unknown>;
        const tasks = (data.tasks ?? []) as Array<Record<string, unknown>>;
        if (tasks.length === 0) break;

        const docs: ConnectorDocument[] = tasks.map((t) => ({
          id: `clickup:${t.id}`,
          source: DocumentSource.CLICKUP,
          title: (t.name as string) ?? "",
          sourceUrl: t.url as string,
          sections: [{
            type: SectionType.TEXT as const,
            content: (t.text_content as string) ?? (t.description as string) ?? "",
          }],
          metadata: { type: "task", status: (t.status as Record<string, unknown>)?.status, priority: (t.priority as Record<string, unknown>)?.priority, listId },
          lastModifiedEpochSecs: t.date_updated
            ? Math.floor(Number(t.date_updated) / 1000)
            : undefined,
          owners: t.assignees
            ? (t.assignees as Array<Record<string, unknown>>).map((a) => ({ name: a.username as string, email: a.email as string }))
            : undefined,
        }));

        if (docs.length > 0) yield docs;
        hasMore = !data.last_page;
        page++;
      } catch (err) {
        yield { error: `ClickUp list ${listId} fetch failed: ${(err as Error).message}` };
        break;
      }
    }
  }

  private async cuApi(path: string): Promise<unknown> {
    const url = path.startsWith("http") ? path : `https://api.clickup.com/api/v2${path}`;
    const resp = await fetch(url, {
      headers: { Authorization: this.apiToken, Accept: "application/json" },
    });
    if (!resp.ok) throw new Error(`ClickUp API error: ${resp.status} ${resp.statusText}`);
    return resp.json();
  }
}
