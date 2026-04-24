/**
 * Jira Connector — loads issues from Atlassian Jira.
 * Supports: PollConnector (incremental by updatedDate).
 */

import type { BaseConnectorConfig, PollConnector } from "../interfaces.js";
import type { ConnectorDocument, ConnectorFailure } from "../models.js";
import { DocumentSource, SectionType } from "../models.js";

export class JiraConnector implements PollConnector {
  readonly displayName = "Jira";
  readonly sourceType = DocumentSource.JIRA;

  private config!: BaseConnectorConfig;
  private baseUrl!: string;
  private email!: string;
  private apiToken!: string;
  private projectKeys: string[] = [];

  async init(config: BaseConnectorConfig): Promise<void> {
    this.config = config;
    this.baseUrl = (config.settings.base_url as string) ?? "";
    this.projectKeys = (config.settings.project_keys as string[]) ?? [];
  }

  async loadCredentials(credentials: Record<string, unknown>): Promise<void> {
    this.email = credentials.email as string;
    this.apiToken = credentials.api_token as string;
  }

  async validateSettings(): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    if (!this.baseUrl) errors.push("base_url (Jira instance URL) is required");
    if (!this.email) errors.push("email is required");
    if (!this.apiToken) errors.push("api_token is required");
    return { valid: errors.length === 0, errors };
  }

  async *pollSource(
    startEpochSecs: number,
    _endEpochSecs: number,
  ): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    const sinceDate = new Date(startEpochSecs * 1000)
      .toISOString()
      .split("T")[0];

    let projectFilter = "";
    if (this.projectKeys.length > 0) {
      projectFilter = ` AND project IN (${this.projectKeys.map((k) => `"${k}"`).join(",")})`;
    }

    const jql = `updated >= "${sinceDate}"${projectFilter} ORDER BY updated DESC`;
    let startAt = 0;
    const maxResults = 50;
    let hasMore = true;

    while (hasMore) {
      try {
        const resp = await this.jiraApi("/rest/api/3/search", {
          jql,
          startAt: String(startAt),
          maxResults: String(maxResults),
          fields: "summary,description,status,assignee,reporter,labels,priority,updated,created,project,issuetype,comment",
        });

        const issues = resp.issues as Array<{
          key: string;
          self: string;
          fields: {
            summary: string;
            description?: { content?: Array<Record<string, unknown>> };
            status?: { name: string };
            assignee?: { emailAddress?: string; displayName?: string };
            reporter?: { emailAddress?: string; displayName?: string };
            labels?: string[];
            priority?: { name: string };
            updated?: string;
            created?: string;
            project?: { key: string; name: string };
            issuetype?: { name: string };
            comment?: { comments?: Array<{ body?: { content?: Array<Record<string, unknown>> }; author?: { displayName?: string } }> };
          };
        }> | undefined;

        if (!issues || issues.length === 0) break;

        const docs: ConnectorDocument[] = issues.map((issue) => {
          const descText = this.adfToText(issue.fields.description);
          const comments = issue.fields.comment?.comments?.map((c) => {
            const body = this.adfToText(c.body);
            return `[${c.author?.displayName ?? "Unknown"}]: ${body}`;
          }) ?? [];

          const fullContent = [
            descText,
            comments.length > 0 ? `\n\nComments:\n${comments.join("\n\n")}` : "",
          ].join("");

          return {
            id: `jira:${issue.key}`,
            source: DocumentSource.JIRA,
            title: `${issue.key}: ${issue.fields.summary}`,
            sourceUrl: `${this.baseUrl}/browse/${issue.key}`,
            sections: [{
              type: SectionType.TEXT as const,
              content: fullContent,
              link: `${this.baseUrl}/browse/${issue.key}`,
            }],
            metadata: {
              project: issue.fields.project?.key,
              issueType: issue.fields.issuetype?.name,
              status: issue.fields.status?.name,
              priority: issue.fields.priority?.name,
              labels: issue.fields.labels,
            },
            lastModifiedEpochSecs: issue.fields.updated
              ? Math.floor(new Date(issue.fields.updated).getTime() / 1000)
              : undefined,
            owners: [
              issue.fields.assignee && {
                email: issue.fields.assignee.emailAddress,
                name: issue.fields.assignee.displayName,
              },
              issue.fields.reporter && {
                email: issue.fields.reporter.emailAddress,
                name: issue.fields.reporter.displayName,
              },
            ].filter(Boolean) as Array<{ email?: string; name?: string }>,
          };
        });

        if (docs.length > 0) yield docs;

        hasMore = issues.length === maxResults;
        startAt += maxResults;
      } catch (err) {
        yield { error: `Jira fetch failed: ${(err as Error).message}` };
        return;
      }
    }
  }

  private async jiraApi(
    path: string,
    params?: Record<string, string>,
  ): Promise<Record<string, unknown>> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    }

    const auth = Buffer.from(`${this.email}:${this.apiToken}`).toString("base64");
    const resp = await fetch(url.toString(), {
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
      },
    });

    if (!resp.ok) {
      throw new Error(`Jira API error: ${resp.status} ${resp.statusText}`);
    }

    return resp.json() as Promise<Record<string, unknown>>;
  }

  /** Convert Atlassian Document Format (ADF) to plain text. */
  private adfToText(adf?: { content?: Array<Record<string, unknown>> }): string {
    if (!adf?.content) return "";
    return adf.content
      .map((node) => this.adfNodeToText(node))
      .filter(Boolean)
      .join("\n");
  }

  private adfNodeToText(node: Record<string, unknown>): string {
    if (node.type === "text") return (node.text as string) ?? "";
    if (node.type === "hardBreak") return "\n";

    const children = node.content as Array<Record<string, unknown>> | undefined;
    if (!children) return "";
    return children.map((c) => this.adfNodeToText(c)).join("");
  }
}
