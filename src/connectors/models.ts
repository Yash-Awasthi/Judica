/**
 * Connector Data Models — document, section, and credential types
 * used across all connector implementations.
 */

// ─── Document Source Enum ─────────────────────────────────────────────────────

/** All supported data source types. Maps 1:1 with the connector registry. */
export enum DocumentSource {
  // Cloud Storage
  GOOGLE_DRIVE = "google_drive",
  DROPBOX = "dropbox",
  SHAREPOINT = "sharepoint",
  S3 = "s3",
  R2 = "r2",
  GCS = "gcs",

  // Collaboration
  SLACK = "slack",
  DISCORD = "discord",
  TEAMS = "teams",

  // Knowledge Bases
  NOTION = "notion",
  CONFLUENCE = "confluence",
  BOOKSTACK = "bookstack",
  GITBOOK = "gitbook",
  OUTLINE = "outline",
  GURU = "guru",
  SLAB = "slab",
  CODA = "coda",
  DOCUMENT360 = "document360",

  // Project Management
  JIRA = "jira",
  LINEAR = "linear",
  ASANA = "asana",
  CLICKUP = "clickup",

  // Code
  GITHUB = "github",
  GITLAB = "gitlab",
  BITBUCKET = "bitbucket",

  // CRM / Sales
  SALESFORCE = "salesforce",
  HUBSPOT = "hubspot",

  // Support
  ZENDESK = "zendesk",
  FRESHDESK = "freshdesk",

  // Communication
  GMAIL = "gmail",
  IMAP = "imap",

  // Community
  DISCOURSE = "discourse",
  XENFORO = "xenforo",
  MEDIAWIKI = "mediawiki",
  WIKIPEDIA = "wikipedia",

  // Misc
  WEB = "web",
  FILE = "file",

  // Recording / Meetings
  GONG = "gong",
  FIREFLIES = "fireflies",

  // Enterprise
  AIRTABLE = "airtable",
  GOOGLE_SITES = "google_sites",

  // Messaging
  TELEGRAM = "telegram",
  ZULIP = "zulip",

  // Education
  CANVAS = "canvas",

  // CMS
  DRUPAL = "drupal",

  // RFP / Sales Enablement
  LOOPIO = "loopio",
  HIGHSPOT = "highspot",

  // Intranet
  AXERO = "axero",

  // Product Management
  PRODUCTBOARD = "productboard",

  // File Storage
  EGNYTE = "egnyte",
  ONEDRIVE = "onedrive",
}

// ─── Input Type ───────────────────────────────────────────────────────────────

/** How the connector ingests data. */
export enum InputType {
  LOAD_STATE = "load_state",
  POLL = "poll",
  EVENT = "event",
  SLIM_RETRIEVAL = "slim_retrieval",
}

// ─── Section Types ────────────────────────────────────────────────────────────

export enum SectionType {
  TEXT = "text",
  IMAGE = "image",
  TABULAR = "tabular",
}

export interface TextSection {
  type: SectionType.TEXT;
  content: string;
  link?: string;
}

export interface ImageSection {
  type: SectionType.IMAGE;
  imageUrl: string;
  altText?: string;
  link?: string;
}

export interface TabularSection {
  type: SectionType.TABULAR;
  headers: string[];
  rows: string[][];
  link?: string;
}

export type DocumentSection = TextSection | ImageSection | TabularSection;

// ─── Document Models ──────────────────────────────────────────────────────────

export interface BasicExpertInfo {
  email?: string;
  name?: string;
}

export interface ConnectorDocument {
  /** Globally unique document ID (source-specific format). */
  id: string;
  /** Source type. */
  source: DocumentSource;
  /** Document sections (text, image, tabular). */
  sections: DocumentSection[];
  /** Arbitrary metadata from the source. */
  metadata: Record<string, unknown>;
  /** Document title / name. */
  title?: string;
  /** Direct link to the source document. */
  sourceUrl?: string;
  /** Last modified timestamp (epoch seconds). */
  lastModifiedEpochSecs?: number;
  /** People associated with this document (authors, editors). */
  owners?: BasicExpertInfo[];
  /** Primary owner. */
  primaryOwner?: BasicExpertInfo;
}

/** Minimal document representation for permission sync. */
export interface SlimDocument {
  id: string;
  permGroupIds?: string[];
}

/** Tracks per-document or per-entity failures during a connector run. */
export interface ConnectorFailure {
  failedDocId?: string;
  failedEntityId?: string;
  error: string;
  exception?: string;
}

// ─── Credential Models ────────────────────────────────────────────────────────

export interface ConnectorCredential {
  id: string;
  source: DocumentSource;
  /** Encrypted credential blob (decrypted at runtime). */
  credentialJson: Record<string, unknown>;
  userId: number;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Connector Run Status ─────────────────────────────────────────────────────

export enum ConnectorRunStatus {
  PENDING = "pending",
  IN_PROGRESS = "in_progress",
  SUCCESS = "success",
  FAILED = "failed",
  CANCELLED = "cancelled",
}

export interface ConnectorRun {
  id: string;
  connectorId: string;
  status: ConnectorRunStatus;
  inputType: InputType;
  docsProcessed: number;
  docsFailed: number;
  errorMessage?: string;
  checkpointData?: Record<string, unknown>;
  startedAt: Date;
  completedAt?: Date;
}
