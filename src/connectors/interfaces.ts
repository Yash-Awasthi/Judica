/**
 * Connector Interfaces — Polymorphic connector hierarchy modeled after Onyx.
 *
 * Hierarchy:
 *   BaseConnector
 *     ├── LoadConnector      (full sync — pull everything)
 *     ├── PollConnector      (incremental — time-range polls)
 *     ├── CheckpointedConnector (resumable — checkpoint-based)
 *     ├── SlimConnector      (ID-only — lightweight permission sync)
 *     ├── OAuthConnector     (OAuth2 credential flow)
 *     └── EventConnector     (webhook/event-driven)
 */

import type { ConnectorDocument, SlimDocument, ConnectorFailure } from "./models.js";

// ─── Credential Provider ──────────────────────────────────────────────────────

/** Injected into connectors that need dynamic credential resolution. */
export interface CredentialsProvider {
  getCredentials(): Promise<Record<string, unknown>>;
}

// ─── Base Connector ───────────────────────────────────────────────────────────

export interface BaseConnectorConfig {
  /** Unique identifier for this connector instance. */
  connectorId: string;
  /** Source type (e.g., "google_drive", "slack", "notion"). */
  source: string;
  /** Arbitrary source-specific settings. */
  settings: Record<string, unknown>;
}

/**
 * Base interface all connectors must implement.
 * Concrete connectors extend this + one of the input-type interfaces.
 */
export interface BaseConnector {
  /** Initialize with configuration; called once before any data methods. */
  init(config: BaseConnectorConfig): Promise<void>;

  /** Load credentials — called after init, before data methods. */
  loadCredentials(credentials: Record<string, unknown>): Promise<void>;

  /** Validate that the connector settings are well-formed. */
  validateSettings(): Promise<{ valid: boolean; errors: string[] }>;

  /** Human-readable source name (e.g., "Google Drive"). */
  readonly displayName: string;

  /** Source identifier matching DocumentSource enum. */
  readonly sourceType: string;
}

// ─── Load Connector ───────────────────────────────────────────────────────────

/** Full-sync connector — pulls all documents from the source. */
export interface LoadConnector extends BaseConnector {
  loadFromState(): AsyncGenerator<ConnectorDocument[] | ConnectorFailure>;
}

// ─── Poll Connector ───────────────────────────────────────────────────────────

/** Incremental connector — polls for changes within a time range. */
export interface PollConnector extends BaseConnector {
  pollSource(
    startEpochSecs: number,
    endEpochSecs: number,
  ): AsyncGenerator<ConnectorDocument[] | ConnectorFailure>;
}

// ─── Checkpointed Connector ──────────────────────────────────────────────────

/** Checkpoint type — connectors define their own checkpoint shape. */
export interface CheckpointData {
  [key: string]: unknown;
}

/** Resumable connector — saves/restores progress via checkpoints. */
export interface CheckpointedConnector<C extends CheckpointData = CheckpointData>
  extends BaseConnector {
  loadFromCheckpoint(
    checkpoint: C | null,
  ): AsyncGenerator<ConnectorDocument[] | ConnectorFailure, C>;
}

// ─── Slim Connector ───────────────────────────────────────────────────────────

/** Lightweight connector — returns only document IDs for permission sync. */
export interface SlimConnector extends BaseConnector {
  retrieveAllSlimDocs(): AsyncGenerator<SlimDocument[]>;
}

// ─── OAuth Connector ──────────────────────────────────────────────────────────

/** Connector with OAuth2 credential acquisition. */
export interface OAuthConnector extends BaseConnector {
  /** Unique OAuth identifier (used in callback routes). */
  oauthId(): string;

  /** Build the authorization URL the user should be redirected to. */
  oauthAuthorizationUrl(
    redirectUri: string,
    state: string,
  ): string;

  /** Exchange the authorization code for tokens. */
  oauthCodeToToken(
    code: string,
    redirectUri: string,
  ): Promise<Record<string, unknown>>;
}

// ─── Event Connector ──────────────────────────────────────────────────────────

/** Webhook/event-driven connector — handles incoming events. */
export interface EventConnector extends BaseConnector {
  handleEvent(
    event: Record<string, unknown>,
  ): AsyncGenerator<ConnectorDocument[] | ConnectorFailure>;
}

// ─── Type Guards ──────────────────────────────────────────────────────────────

export function isLoadConnector(c: BaseConnector): c is LoadConnector {
  return "loadFromState" in c && typeof (c as LoadConnector).loadFromState === "function";
}

export function isPollConnector(c: BaseConnector): c is PollConnector {
  return "pollSource" in c && typeof (c as PollConnector).pollSource === "function";
}

export function isCheckpointedConnector(c: BaseConnector): c is CheckpointedConnector {
  return "loadFromCheckpoint" in c && typeof (c as CheckpointedConnector).loadFromCheckpoint === "function";
}

export function isSlimConnector(c: BaseConnector): c is SlimConnector {
  return "retrieveAllSlimDocs" in c && typeof (c as SlimConnector).retrieveAllSlimDocs === "function";
}

export function isOAuthConnector(c: BaseConnector): c is OAuthConnector {
  return "oauthId" in c && typeof (c as OAuthConnector).oauthId === "function";
}

export function isEventConnector(c: BaseConnector): c is EventConnector {
  return "handleEvent" in c && typeof (c as EventConnector).handleEvent === "function";
}
