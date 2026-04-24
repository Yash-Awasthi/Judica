/**
 * Connector Registry — maps DocumentSource to lazy-loaded connector classes.
 * Modeled after Onyx's CONNECTOR_CLASS_MAP with importlib-style lazy loading.
 */

import type { BaseConnector } from "./interfaces.js";
import { DocumentSource } from "./models.js";

// ─── Registry Entry ───────────────────────────────────────────────────────────

export interface ConnectorMapping {
  /** Module path relative to src/connectors/ (without extension). */
  modulePath: string;
  /** Named export from the module. */
  className: string;
}

// ─── Connector Class Map ──────────────────────────────────────────────────────

/**
 * Maps each DocumentSource to a module + class name.
 * Connectors are loaded lazily on first use — this avoids importing
 * heavy SDKs (Google, Slack, etc.) at startup.
 *
 * Start with the 6 highest-impact sources:
 *   Google Drive, Slack, Notion, GitHub, Confluence, Jira
 * The rest are stubbed for future implementation.
 */
export const CONNECTOR_CLASS_MAP: Partial<Record<DocumentSource, ConnectorMapping>> = {
  [DocumentSource.GOOGLE_DRIVE]: {
    modulePath: "./sources/google_drive.connector",
    className: "GoogleDriveConnector",
  },
  [DocumentSource.SLACK]: {
    modulePath: "./sources/slack.connector",
    className: "SlackConnector",
  },
  [DocumentSource.NOTION]: {
    modulePath: "./sources/notion.connector",
    className: "NotionConnector",
  },
  [DocumentSource.GITHUB]: {
    modulePath: "./sources/github.connector",
    className: "GitHubConnector",
  },
  [DocumentSource.CONFLUENCE]: {
    modulePath: "./sources/confluence.connector",
    className: "ConfluenceConnector",
  },
  [DocumentSource.JIRA]: {
    modulePath: "./sources/jira.connector",
    className: "JiraConnector",
  },
  [DocumentSource.WEB]: {
    modulePath: "./sources/web.connector",
    className: "WebConnector",
  },
  [DocumentSource.FILE]: {
    modulePath: "./sources/file.connector",
    className: "FileConnector",
  },
};

// ─── Lazy-Loading Cache ───────────────────────────────────────────────────────

const connectorClassCache = new Map<DocumentSource, new () => BaseConnector>();

/**
 * Lazily load and cache a connector class by source type.
 * Uses dynamic import() for tree-shaking and startup performance.
 */
export async function loadConnectorClass(
  source: DocumentSource,
): Promise<new () => BaseConnector> {
  const cached = connectorClassCache.get(source);
  if (cached) return cached;

  const mapping = CONNECTOR_CLASS_MAP[source];
  if (!mapping) {
    throw new Error(`No connector registered for source: ${source}`);
  }

  const mod = await import(mapping.modulePath);
  const ConnectorClass = mod[mapping.className];
  if (!ConnectorClass) {
    throw new Error(
      `Module ${mapping.modulePath} does not export ${mapping.className}`,
    );
  }

  connectorClassCache.set(source, ConnectorClass);
  return ConnectorClass;
}

/**
 * List all registered source types.
 */
export function getRegisteredSources(): DocumentSource[] {
  return Object.keys(CONNECTOR_CLASS_MAP) as DocumentSource[];
}

/**
 * Check if a source type has a registered connector.
 */
export function isSourceRegistered(source: DocumentSource): boolean {
  return source in CONNECTOR_CLASS_MAP;
}
