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
 * 30+ connectors covering all major data source categories.
 */
export const CONNECTOR_CLASS_MAP: Partial<Record<DocumentSource, ConnectorMapping>> = {
  // ─── Cloud Storage ──────────────────────────────────────────────────────────
  [DocumentSource.GOOGLE_DRIVE]: { modulePath: "./sources/google_drive.connector", className: "GoogleDriveConnector" },
  [DocumentSource.DROPBOX]:      { modulePath: "./sources/dropbox.connector",      className: "DropboxConnector" },
  [DocumentSource.SHAREPOINT]:   { modulePath: "./sources/sharepoint.connector",   className: "SharePointConnector" },
  [DocumentSource.S3]:           { modulePath: "./sources/s3.connector",           className: "S3Connector" },
  [DocumentSource.R2]:           { modulePath: "./sources/r2.connector",           className: "R2Connector" },
  [DocumentSource.GCS]:          { modulePath: "./sources/gcs.connector",          className: "GCSConnector" },

  // ─── Collaboration / Messaging ──────────────────────────────────────────────
  [DocumentSource.SLACK]:        { modulePath: "./sources/slack.connector",        className: "SlackConnector" },
  [DocumentSource.DISCORD]:      { modulePath: "./sources/discord.connector",      className: "DiscordConnector" },
  [DocumentSource.TEAMS]:        { modulePath: "./sources/teams.connector",        className: "TeamsConnector" },

  // ─── Knowledge Bases / Wikis ────────────────────────────────────────────────
  [DocumentSource.NOTION]:       { modulePath: "./sources/notion.connector",       className: "NotionConnector" },
  [DocumentSource.CONFLUENCE]:   { modulePath: "./sources/confluence.connector",   className: "ConfluenceConnector" },
  [DocumentSource.BOOKSTACK]:    { modulePath: "./sources/bookstack.connector",    className: "BookStackConnector" },
  [DocumentSource.GITBOOK]:      { modulePath: "./sources/gitbook.connector",      className: "GitBookConnector" },
  [DocumentSource.OUTLINE]:      { modulePath: "./sources/outline.connector",      className: "OutlineConnector" },
  [DocumentSource.GURU]:         { modulePath: "./sources/guru.connector",         className: "GuruConnector" },
  [DocumentSource.SLAB]:         { modulePath: "./sources/slab.connector",         className: "SlabConnector" },
  [DocumentSource.CODA]:         { modulePath: "./sources/coda.connector",         className: "CodaConnector" },
  [DocumentSource.DOCUMENT360]:  { modulePath: "./sources/document360.connector",  className: "Document360Connector" },

  // ─── Project Management ─────────────────────────────────────────────────────
  [DocumentSource.JIRA]:         { modulePath: "./sources/jira.connector",         className: "JiraConnector" },
  [DocumentSource.LINEAR]:       { modulePath: "./sources/linear.connector",       className: "LinearConnector" },
  [DocumentSource.ASANA]:        { modulePath: "./sources/asana.connector",        className: "AsanaConnector" },
  [DocumentSource.CLICKUP]:      { modulePath: "./sources/clickup.connector",      className: "ClickUpConnector" },

  // ─── Code Repositories ─────────────────────────────────────────────────────
  [DocumentSource.GITHUB]:       { modulePath: "./sources/github.connector",       className: "GitHubConnector" },
  [DocumentSource.GITLAB]:       { modulePath: "./sources/gitlab.connector",       className: "GitLabConnector" },
  [DocumentSource.BITBUCKET]:    { modulePath: "./sources/bitbucket.connector",    className: "BitbucketConnector" },

  // ─── CRM / Sales ───────────────────────────────────────────────────────────
  [DocumentSource.SALESFORCE]:   { modulePath: "./sources/salesforce.connector",   className: "SalesforceConnector" },
  [DocumentSource.HUBSPOT]:      { modulePath: "./sources/hubspot.connector",      className: "HubSpotConnector" },

  // ─── Support / Ticketing ────────────────────────────────────────────────────
  [DocumentSource.ZENDESK]:      { modulePath: "./sources/zendesk.connector",      className: "ZendeskConnector" },
  [DocumentSource.FRESHDESK]:    { modulePath: "./sources/freshdesk.connector",    className: "FreshdeskConnector" },

  // ─── Communication / Email ──────────────────────────────────────────────────
  [DocumentSource.GMAIL]:        { modulePath: "./sources/gmail.connector",        className: "GmailConnector" },
  [DocumentSource.IMAP]:         { modulePath: "./sources/imap.connector",         className: "ImapConnector" },

  // ─── Community / Forums ─────────────────────────────────────────────────────
  [DocumentSource.DISCOURSE]:    { modulePath: "./sources/discourse.connector",    className: "DiscourseConnector" },
  [DocumentSource.XENFORO]:      { modulePath: "./sources/xenforo.connector",      className: "XenForoConnector" },
  [DocumentSource.MEDIAWIKI]:    { modulePath: "./sources/mediawiki.connector",    className: "MediaWikiConnector" },
  [DocumentSource.WIKIPEDIA]:    { modulePath: "./sources/wikipedia.connector",    className: "WikipediaConnector" },

  // ─── Enterprise / Misc ─────────────────────────────────────────────────────
  [DocumentSource.AIRTABLE]:     { modulePath: "./sources/airtable.connector",     className: "AirtableConnector" },
  [DocumentSource.GOOGLE_SITES]: { modulePath: "./sources/google_sites.connector", className: "GoogleSitesConnector" },

  // ─── Recording / Meetings ──────────────────────────────────────────────────
  [DocumentSource.GONG]:         { modulePath: "./sources/gong.connector",         className: "GongConnector" },
  [DocumentSource.FIREFLIES]:    { modulePath: "./sources/fireflies.connector",    className: "FirefliesConnector" },

  // ─── Web / File ─────────────────────────────────────────────────────────────
  [DocumentSource.WEB]:          { modulePath: "./sources/web.connector",          className: "WebConnector" },
  [DocumentSource.FILE]:         { modulePath: "./sources/file.connector",         className: "FileConnector" },

  // ─── Messaging ──────────────────────────────────────────────────────────────
  [DocumentSource.TELEGRAM]:     { modulePath: "./sources/telegram.connector",     className: "TelegramConnector" },
  [DocumentSource.ZULIP]:        { modulePath: "./sources/zulip.connector",        className: "ZulipConnector" },

  // ─── Education ──────────────────────────────────────────────────────────────
  [DocumentSource.CANVAS]:       { modulePath: "./sources/canvas.connector",       className: "CanvasConnector" },

  // ─── CMS ────────────────────────────────────────────────────────────────────
  [DocumentSource.DRUPAL]:       { modulePath: "./sources/drupal.connector",       className: "DrupalConnector" },

  // ─── RFP / Sales Enablement ─────────────────────────────────────────────────
  [DocumentSource.LOOPIO]:       { modulePath: "./sources/loopio.connector",       className: "LoopioConnector" },
  [DocumentSource.HIGHSPOT]:     { modulePath: "./sources/highspot.connector",     className: "HighspotConnector" },

  // ─── Intranet ───────────────────────────────────────────────────────────────
  [DocumentSource.AXERO]:        { modulePath: "./sources/axero.connector",        className: "AxeroConnector" },

  // ─── Product Management ─────────────────────────────────────────────────────
  [DocumentSource.PRODUCTBOARD]: { modulePath: "./sources/productboard.connector", className: "ProductBoardConnector" },

  // ─── File Storage ───────────────────────────────────────────────────────────
  [DocumentSource.EGNYTE]:       { modulePath: "./sources/egnyte.connector",       className: "EgnyteConnector" },
  [DocumentSource.ONEDRIVE]:     { modulePath: "./sources/onedrive.connector",     className: "OneDriveConnector" },
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
