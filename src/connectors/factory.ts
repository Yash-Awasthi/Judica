/**
 * Connector Factory — instantiates, configures, and runs connectors.
 * Handles credential injection, validation, and the ConnectorRunner wrapper.
 */

import type {
  BaseConnector,
  BaseConnectorConfig,
  LoadConnector,
  PollConnector,
  CheckpointedConnector,
  SlimConnector,
  EventConnector,
} from "./interfaces.js";
import {
  isLoadConnector,
  isPollConnector,
  isCheckpointedConnector,
  isSlimConnector,
  isEventConnector,
} from "./interfaces.js";
import type {
  ConnectorDocument,
  ConnectorFailure,
} from "./models.js";
import type { CheckpointData } from "./interfaces.js";
import { DocumentSource, InputType } from "./models.js";
import { loadConnectorClass } from "./registry.js";
import logger from "../lib/logger.js";

// ─── Factory ──────────────────────────────────────────────────────────────────

export interface InstantiateConnectorOptions {
  source: DocumentSource;
  connectorId: string;
  settings: Record<string, unknown>;
  credentials: Record<string, unknown>;
}

/**
 * Instantiate a connector: load class → init → inject credentials → validate.
 */
export async function instantiateConnector(
  opts: InstantiateConnectorOptions,
): Promise<BaseConnector> {
  const ConnectorClass = await loadConnectorClass(opts.source);
  const connector = new ConnectorClass();

  const config: BaseConnectorConfig = {
    connectorId: opts.connectorId,
    source: opts.source,
    settings: opts.settings,
  };

  await connector.init(config);
  await connector.loadCredentials(opts.credentials);

  const validation = await connector.validateSettings();
  if (!validation.valid) {
    throw new Error(
      `Connector validation failed for ${opts.source}: ${validation.errors.join(", ")}`,
    );
  }

  return connector;
}

/**
 * Validate that a connector supports the requested input type.
 */
export function validateConnectorInputType(
  connector: BaseConnector,
  inputType: InputType,
): void {
  switch (inputType) {
    case InputType.LOAD_STATE:
      if (!isLoadConnector(connector) && !isCheckpointedConnector(connector)) {
        throw new Error(
          `Connector ${connector.sourceType} does not support LOAD_STATE`,
        );
      }
      break;
    case InputType.POLL:
      if (!isPollConnector(connector)) {
        throw new Error(
          `Connector ${connector.sourceType} does not support POLL`,
        );
      }
      break;
    case InputType.EVENT:
      if (!isEventConnector(connector)) {
        throw new Error(
          `Connector ${connector.sourceType} does not support EVENT`,
        );
      }
      break;
    case InputType.SLIM_RETRIEVAL:
      if (!isSlimConnector(connector)) {
        throw new Error(
          `Connector ${connector.sourceType} does not support SLIM_RETRIEVAL`,
        );
      }
      break;
  }
}

// ─── Connector Runner ─────────────────────────────────────────────────────────

export interface ConnectorRunResult {
  documents: ConnectorDocument[];
  failures: ConnectorFailure[];
  checkpoint?: CheckpointData;
}

/**
 * ConnectorRunner — unifies all connector types into a single execution interface.
 * Handles batching, failure tracking, and checkpoint management.
 */
export async function runConnector(
  connector: BaseConnector,
  inputType: InputType,
  options: {
    startEpochSecs?: number;
    endEpochSecs?: number;
    checkpoint?: CheckpointData | null;
    event?: Record<string, unknown>;
    batchSize?: number;
  } = {},
): Promise<ConnectorRunResult> {
  const documents: ConnectorDocument[] = [];
  const failures: ConnectorFailure[] = [];
  let finalCheckpoint: CheckpointData | undefined;

  const log = logger.child({ connectorId: connector.sourceType, inputType });

  try {
    switch (inputType) {
      case InputType.LOAD_STATE: {
        if (isCheckpointedConnector(connector)) {
          const gen = (connector as CheckpointedConnector).loadFromCheckpoint(
            options.checkpoint ?? null,
          );
          let result = await gen.next();
          while (!result.done) {
            const batch = result.value;
            if (isConnectorFailure(batch)) {
              failures.push(batch);
            } else {
              documents.push(...batch);
            }
            result = await gen.next();
          }
          finalCheckpoint = result.value;
        } else if (isLoadConnector(connector)) {
          const gen = (connector as LoadConnector).loadFromState();
          for await (const batch of gen) {
            if (isConnectorFailure(batch)) {
              failures.push(batch);
            } else {
              documents.push(...batch);
            }
          }
        }
        break;
      }
      case InputType.POLL: {
        const poll = connector as PollConnector;
        const start = options.startEpochSecs ?? 0;
        const end = options.endEpochSecs ?? Math.floor(Date.now() / 1000);
        for await (const batch of poll.pollSource(start, end)) {
          if (isConnectorFailure(batch)) {
            failures.push(batch);
          } else {
            documents.push(...batch);
          }
        }
        break;
      }
      case InputType.EVENT: {
        const ev = connector as EventConnector;
        if (!options.event) throw new Error("Event data required for EVENT input type");
        for await (const batch of ev.handleEvent(options.event)) {
          if (isConnectorFailure(batch)) {
            failures.push(batch);
          } else {
            documents.push(...batch);
          }
        }
        break;
      }
      case InputType.SLIM_RETRIEVAL: {
        // Slim retrieval returns SlimDocuments, not full ConnectorDocuments.
        // This path is handled separately in permission sync flows.
        log.warn("SLIM_RETRIEVAL should be invoked via runSlimConnector()");
        break;
      }
    }
  } catch (err) {
    log.error({ err }, "Connector run failed");
    failures.push({
      error: (err as Error).message,
      exception: (err as Error).stack,
    });
  }

  log.info(
    { docsProcessed: documents.length, docsFailed: failures.length },
    "Connector run complete",
  );

  return { documents, failures, checkpoint: finalCheckpoint };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isConnectorFailure(
  batch: ConnectorDocument[] | ConnectorFailure,
): batch is ConnectorFailure {
  return "error" in batch && typeof (batch as ConnectorFailure).error === "string";
}
