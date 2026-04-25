/**
 * Canvas LMS Connector — loads courses, pages, files, announcements, and discussions
 * from Canvas (Instructure) via REST API.
 * Supports: LoadConnector.
 */

import type { BaseConnectorConfig, LoadConnector } from "../interfaces.js";
import type { ConnectorDocument, ConnectorFailure } from "../models.js";
import { DocumentSource, SectionType } from "../models.js";

export class CanvasConnector implements LoadConnector {
  readonly displayName = "Canvas LMS";
  readonly sourceType = DocumentSource.CANVAS;

  private config!: BaseConnectorConfig;
  private domain!: string;
  private accessToken!: string;
  private courseIds: string[] = [];

  async init(config: BaseConnectorConfig): Promise<void> {
    this.config = config;
    this.domain = config.settings.domain as string;
    this.courseIds = (config.settings.course_ids as string[]) ?? [];
  }

  async loadCredentials(credentials: Record<string, unknown>): Promise<void> {
    this.accessToken = credentials.access_token as string;
  }

  async validateSettings(): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    if (!this.domain) errors.push("domain is required");
    if (!this.accessToken) errors.push("access_token is required");
    return { valid: errors.length === 0, errors };
  }

  async *loadFromState(): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    // If no course IDs specified, fetch all enrolled courses
    let courseIds = this.courseIds;
    if (courseIds.length === 0) {
      try {
        const courses = (await this.canvasPaginatedGet("/api/v1/courses?per_page=100")) as Array<Record<string, unknown>>;
        courseIds = courses.map((c) => String(c.id));
      } catch (err) {
        yield { error: `Canvas course list failed: ${(err as Error).message}` };
        return;
      }
    }

    for (const courseId of courseIds) {
      yield* this.fetchCourseContent(courseId);
    }
  }

  private async *fetchCourseContent(
    courseId: string,
  ): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    // Fetch pages
    try {
      const pages = (await this.canvasPaginatedGet(
        `/api/v1/courses/${courseId}/pages?per_page=100`,
      )) as Array<Record<string, unknown>>;
      const docs: ConnectorDocument[] = pages.map((page) => ({
        id: `canvas:course:${courseId}:page:${page.url}`,
        source: DocumentSource.CANVAS,
        title: (page.title as string) ?? "Untitled Page",
        sourceUrl: (page.html_url as string) ?? `https://${this.domain}/courses/${courseId}/pages/${page.url}`,
        sections: [{ type: SectionType.TEXT as const, content: (page.body as string) ?? "" }],
        metadata: { courseId, type: "page", pageUrl: page.url },
        lastModifiedEpochSecs: page.updated_at
          ? Math.floor(new Date(page.updated_at as string).getTime() / 1000)
          : undefined,
      }));
      if (docs.length > 0) yield docs;
    } catch (err) {
      yield { error: `Canvas pages fetch failed for course ${courseId}: ${(err as Error).message}` };
    }

    // Fetch announcements
    try {
      const announcements = (await this.canvasPaginatedGet(
        `/api/v1/courses/${courseId}/discussion_topics?only_announcements=true&per_page=100`,
      )) as Array<Record<string, unknown>>;
      const docs: ConnectorDocument[] = announcements.map((ann) => ({
        id: `canvas:course:${courseId}:announcement:${ann.id}`,
        source: DocumentSource.CANVAS,
        title: (ann.title as string) ?? "Untitled Announcement",
        sourceUrl: (ann.html_url as string) ?? `https://${this.domain}/courses/${courseId}/announcements/${ann.id}`,
        sections: [{ type: SectionType.TEXT as const, content: (ann.message as string) ?? "" }],
        metadata: { courseId, type: "announcement" },
        lastModifiedEpochSecs: ann.posted_at
          ? Math.floor(new Date(ann.posted_at as string).getTime() / 1000)
          : undefined,
      }));
      if (docs.length > 0) yield docs;
    } catch (err) {
      yield { error: `Canvas announcements fetch failed for course ${courseId}: ${(err as Error).message}` };
    }

    // Fetch discussion topics
    try {
      const discussions = (await this.canvasPaginatedGet(
        `/api/v1/courses/${courseId}/discussion_topics?per_page=100`,
      )) as Array<Record<string, unknown>>;
      const docs: ConnectorDocument[] = discussions.map((disc) => ({
        id: `canvas:course:${courseId}:discussion:${disc.id}`,
        source: DocumentSource.CANVAS,
        title: (disc.title as string) ?? "Untitled Discussion",
        sourceUrl: (disc.html_url as string) ?? `https://${this.domain}/courses/${courseId}/discussion_topics/${disc.id}`,
        sections: [{ type: SectionType.TEXT as const, content: (disc.message as string) ?? "" }],
        metadata: { courseId, type: "discussion" },
        lastModifiedEpochSecs: disc.last_reply_at
          ? Math.floor(new Date(disc.last_reply_at as string).getTime() / 1000)
          : undefined,
      }));
      if (docs.length > 0) yield docs;
    } catch (err) {
      yield { error: `Canvas discussions fetch failed for course ${courseId}: ${(err as Error).message}` };
    }
  }

  private async canvasPaginatedGet(path: string): Promise<unknown[]> {
    const results: unknown[] = [];
    let url: string | null = `https://${this.domain}${path}`;

    while (url) {
      const resp: Response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          Accept: "application/json",
        },
      });
      if (resp.status === 401 || resp.status === 403) {
        console.warn(`Canvas API auth error: ${resp.status}`);
        return results;
      }
      if (!resp.ok) throw new Error(`Canvas API error: ${resp.status} ${resp.statusText}`);

      const data = (await resp.json()) as unknown[];
      results.push(...data);

      // Parse Link header for next page
      const linkHeader: string = resp.headers.get("Link") ?? "";
      const nextMatch: RegExpMatchArray | null = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
      url = nextMatch ? nextMatch[1] : null;
    }

    return results;
  }
}
