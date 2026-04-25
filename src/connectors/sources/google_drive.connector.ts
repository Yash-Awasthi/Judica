/**
 * Google Drive Connector — polls Google Drive for documents.
 * Supports: LoadConnector (full sync), PollConnector (incremental).
 */

import type { BaseConnectorConfig, LoadConnector, PollConnector } from "../interfaces.js";
import type { ConnectorDocument, ConnectorFailure } from "../models.js";
import { DocumentSource, SectionType } from "../models.js";

export class GoogleDriveConnector implements LoadConnector, PollConnector {
  readonly displayName = "Google Drive";
  readonly sourceType = DocumentSource.GOOGLE_DRIVE;

  private config!: BaseConnectorConfig;
  private credentials!: Record<string, unknown>;
  private accessToken?: string;

  async init(config: BaseConnectorConfig): Promise<void> {
    this.config = config;
  }

  async loadCredentials(credentials: Record<string, unknown>): Promise<void> {
    this.credentials = credentials;
    this.accessToken = credentials.access_token as string | undefined;
  }

  async validateSettings(): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    if (!this.credentials.access_token && !this.credentials.refresh_token) {
      errors.push("Either access_token or refresh_token is required");
    }
    return { valid: errors.length === 0, errors };
  }

  async *loadFromState(): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    const token = await this.resolveToken();
    if (!token) {
      yield { error: "No valid access token available" };
      return;
    }

    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({
        pageSize: "100",
        fields: "nextPageToken,files(id,name,mimeType,modifiedTime,webViewLink,owners,description)",
        q: "trashed=false",
      });
      if (pageToken) params.set("pageToken", pageToken);

      const resp = await fetch(
        `https://www.googleapis.com/drive/v3/files?${params}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );

      if (!resp.ok) {
        yield { error: `Google Drive API error: ${resp.status} ${resp.statusText}` };
        return;
      }

      const data = (await resp.json()) as {
        files: Array<{
          id: string;
          name: string;
          mimeType: string;
          modifiedTime?: string;
          webViewLink?: string;
          owners?: Array<{ emailAddress?: string; displayName?: string }>;
          description?: string;
        }>;
        nextPageToken?: string;
      };

      const docs: ConnectorDocument[] = [];
      for (const file of data.files) {
        const content = await this.extractFileContent(token, file.id, file.mimeType);
        if (content === null) continue;

        docs.push({
          id: `gdrive:${file.id}`,
          source: DocumentSource.GOOGLE_DRIVE,
          title: file.name,
          sourceUrl: file.webViewLink,
          sections: [{ type: SectionType.TEXT, content, link: file.webViewLink }],
          metadata: {
            mimeType: file.mimeType,
            description: file.description,
          },
          lastModifiedEpochSecs: file.modifiedTime
            ? Math.floor(new Date(file.modifiedTime).getTime() / 1000)
            : undefined,
          owners: file.owners?.map((o) => ({
            email: o.emailAddress,
            name: o.displayName,
          })),
        });
      }

      if (docs.length > 0) yield docs;
      pageToken = data.nextPageToken;
    } while (pageToken);
  }

  async *pollSource(
    startEpochSecs: number,
    endEpochSecs: number,
  ): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    const token = await this.resolveToken();
    if (!token) {
      yield { error: "No valid access token available" };
      return;
    }

    const startTime = new Date(startEpochSecs * 1000).toISOString();
    const endTime = new Date(endEpochSecs * 1000).toISOString();

    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({
        pageSize: "100",
        fields: "nextPageToken,files(id,name,mimeType,modifiedTime,webViewLink,owners,description)",
        q: `trashed=false and modifiedTime >= '${startTime}' and modifiedTime <= '${endTime}'`,
      });
      if (pageToken) params.set("pageToken", pageToken);

      const resp = await fetch(
        `https://www.googleapis.com/drive/v3/files?${params}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );

      if (!resp.ok) {
        yield { error: `Google Drive API error: ${resp.status} ${resp.statusText}` };
        return;
      }

      const data = (await resp.json()) as {
        files: Array<{
          id: string;
          name: string;
          mimeType: string;
          modifiedTime?: string;
          webViewLink?: string;
          owners?: Array<{ emailAddress?: string; displayName?: string }>;
          description?: string;
        }>;
        nextPageToken?: string;
      };

      const docs: ConnectorDocument[] = [];
      for (const file of data.files) {
        const content = await this.extractFileContent(token, file.id, file.mimeType);
        if (content === null) continue;

        docs.push({
          id: `gdrive:${file.id}`,
          source: DocumentSource.GOOGLE_DRIVE,
          title: file.name,
          sourceUrl: file.webViewLink,
          sections: [{ type: SectionType.TEXT, content, link: file.webViewLink }],
          metadata: { mimeType: file.mimeType },
          lastModifiedEpochSecs: file.modifiedTime
            ? Math.floor(new Date(file.modifiedTime).getTime() / 1000)
            : undefined,
          owners: file.owners?.map((o) => ({
            email: o.emailAddress,
            name: o.displayName,
          })),
        });
      }

      if (docs.length > 0) yield docs;
      pageToken = data.nextPageToken;
    } while (pageToken);
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────

  private async resolveToken(): Promise<string | null> {
    if (this.accessToken) return this.accessToken;

    const refreshToken = this.credentials.refresh_token as string | undefined;
    const clientId = this.credentials.client_id as string | undefined;
    const clientSecret = this.credentials.client_secret as string | undefined;

    if (!refreshToken || !clientId || !clientSecret) return null;

    const resp = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    if (!resp.ok) return null;
    const data = (await resp.json()) as { access_token: string };
    this.accessToken = data.access_token;
    return this.accessToken;
  }

  private async extractFileContent(
    token: string,
    fileId: string,
    mimeType: string,
  ): Promise<string | null> {
    // Google Docs/Sheets/Slides — export as text
    const exportMimeMap: Record<string, string> = {
      "application/vnd.google-apps.document": "text/plain",
      "application/vnd.google-apps.spreadsheet": "text/csv",
      "application/vnd.google-apps.presentation": "text/plain",
    };

    const exportMime = exportMimeMap[mimeType];
    if (exportMime) {
      const resp = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=${encodeURIComponent(exportMime)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!resp.ok) return null;
      return resp.text();
    }

    // Plain text files — download directly
    if (mimeType.startsWith("text/")) {
      const resp = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!resp.ok) return null;
      return resp.text();
    }

    // Binary files (PDF, DOCX, etc.) — skip for now, to be handled via file processors
    return null;
  }
}
