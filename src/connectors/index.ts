/**
 * Connector System — barrel export.
 *
 * Usage:
 *   import { instantiateConnector, DocumentSource, ... } from "./connectors/index.js";
 */

// Interfaces
export type {
  BaseConnector,
  BaseConnectorConfig,
  LoadConnector,
  PollConnector,
  CheckpointedConnector,
  SlimConnector,
  OAuthConnector,
  EventConnector,
  CredentialsProvider,
  CheckpointData,
} from "./interfaces.js";

export {
  isLoadConnector,
  isPollConnector,
  isCheckpointedConnector,
  isSlimConnector,
  isOAuthConnector,
  isEventConnector,
} from "./interfaces.js";

// Models
export {
  DocumentSource,
  InputType,
  SectionType,
  ConnectorRunStatus,
} from "./models.js";

export type {
  ConnectorDocument,
  SlimDocument,
  ConnectorFailure,
  ConnectorCredential,
  ConnectorRun,
  DocumentSection,
  TextSection,
  ImageSection,
  TabularSection,
  BasicExpertInfo,
} from "./models.js";

// Factory
export {
  instantiateConnector,
  validateConnectorInputType,
  runConnector,
} from "./factory.js";

export type {
  InstantiateConnectorOptions,
  ConnectorRunResult,
} from "./factory.js";

// Registry
export {
  CONNECTOR_CLASS_MAP,
  loadConnectorClass,
  getRegisteredSources,
  isSourceRegistered,
} from "./registry.js";
