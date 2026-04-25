/**
 * Connector Service — orchestrates connector runs, scheduling, and status tracking.
 */

import { randomUUID } from "node:crypto";
import { db } from "../lib/drizzle.js";
import {
  connectorInstances,
  connectorCredentials,
  connectorRuns,
} from "../db/schema/connectors.js";
import { eq, and, lte } from "drizzle-orm";
import {
  instantiateConnector,
  runConnector,
  DocumentSource,
  InputType,
  ConnectorRunStatus,
} from "../connectors/index.js";
import logger from "../lib/logger.js";
import { lightQueue } from "../queue/specializedQueues.js";

const log = logger.child({ service: "connector" });

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export interface CreateConnectorInput {
  userId: number;
  source: DocumentSource;
  name: string;
  description?: string;
  settings: Record<string, unknown>;
  inputType: InputType;
  credentials: Record<string, unknown>;
  refreshIntervalMins?: number;
}

export async function createConnector(input: CreateConnectorInput) {
  const connectorId = randomUUID();
  const credentialId = randomUUID();

  await db.insert(connectorInstances).values({
    id: connectorId,
    userId: input.userId,
    source: input.source,
    name: input.name,
    description: input.description,
    settings: input.settings,
    inputType: input.inputType,
    refreshIntervalMins: input.refreshIntervalMins ?? 60,
  });

  await db.insert(connectorCredentials).values({
    id: credentialId,
    userId: input.userId,
    connectorId,
    source: input.source,
    credentialJson: input.credentials,
  });

  log.info({ connectorId, source: input.source }, "Connector created");
  return { connectorId, credentialId };
}

export async function listConnectors(userId: number) {
  return db
    .select()
    .from(connectorInstances)
    .where(eq(connectorInstances.userId, userId));
}

export async function getConnector(connectorId: string) {
  const rows = await db
    .select()
    .from(connectorInstances)
    .where(eq(connectorInstances.id, connectorId))
    .limit(1);
  return rows[0] ?? null;
}

export async function deleteConnector(connectorId: string) {
  await db.delete(connectorInstances).where(eq(connectorInstances.id, connectorId));
  log.info({ connectorId }, "Connector deleted");
}

// ─── Run Execution ────────────────────────────────────────────────────────────

export async function executeConnectorRun(connectorId: string) {
  const connector = await getConnector(connectorId);
  if (!connector) throw new Error(`Connector ${connectorId} not found`);

  // Fetch credentials
  const creds = await db
    .select()
    .from(connectorCredentials)
    .where(eq(connectorCredentials.connectorId, connectorId))
    .limit(1);

  if (creds.length === 0) {
    throw new Error(`No credentials found for connector ${connectorId}`);
  }

  // Create run record
  const runId = randomUUID();
  await db.insert(connectorRuns).values({
    id: runId,
    connectorId,
    status: ConnectorRunStatus.IN_PROGRESS,
    inputType: connector.inputType,
  });

  try {
    // Instantiate and run
    const instance = await instantiateConnector({
      source: connector.source as DocumentSource,
      connectorId,
      settings: connector.settings as Record<string, unknown>,
      credentials: creds[0].credentialJson as Record<string, unknown>,
    });

    const result = await runConnector(
      instance,
      connector.inputType as InputType,
      {
        startEpochSecs: connector.lastSyncAt
          ? Math.floor(connector.lastSyncAt.getTime() / 1000)
          : undefined,
      },
    );

    // Update run record
    await db
      .update(connectorRuns)
      .set({
        status: result.failures.length > 0 && result.documents.length === 0
          ? ConnectorRunStatus.FAILED
          : ConnectorRunStatus.SUCCESS,
        docsProcessed: result.documents.length,
        docsFailed: result.failures.length,
        errorMessage: result.failures.length > 0
          ? result.failures.map((f) => f.error).join("; ")
          : undefined,
        checkpointData: result.checkpoint,
        completedAt: new Date(),
      })
      .where(eq(connectorRuns.id, runId));

    // Update connector sync timestamps
    const now = new Date();
    const nextSync = new Date(now.getTime() + (connector.refreshIntervalMins ?? 60) * 60_000);
    await db
      .update(connectorInstances)
      .set({
        lastSyncAt: now,
        nextSyncAt: nextSync,
        updatedAt: now,
      })
      .where(eq(connectorInstances.id, connectorId));

    log.info(
      { runId, connectorId, docsProcessed: result.documents.length, docsFailed: result.failures.length },
      "Connector run complete",
    );

    // Enqueue permission sync after ingestion completes
    await lightQueue.add(
      "connector-acl-refresh",
      { connectorId },
      { priority: 5 },
    );

    return { runId, result };
  } catch (err) {
    await db
      .update(connectorRuns)
      .set({
        status: ConnectorRunStatus.FAILED,
        errorMessage: (err as Error).message,
        completedAt: new Date(),
      })
      .where(eq(connectorRuns.id, runId));

    log.error({ runId, connectorId, err }, "Connector run failed");
    throw err;
  }
}

// ─── Scheduling ───────────────────────────────────────────────────────────────

export async function getConnectorsDueForSync(): Promise<
  Array<typeof connectorInstances.$inferSelect>
> {
  return db
    .select()
    .from(connectorInstances)
    .where(
      and(
        eq(connectorInstances.enabled, true),
        lte(connectorInstances.nextSyncAt, new Date()),
      ),
    );
}

export async function getConnectorRuns(connectorId: string, limit = 10) {
  return db
    .select()
    .from(connectorRuns)
    .where(eq(connectorRuns.connectorId, connectorId))
    .orderBy(connectorRuns.startedAt)
    .limit(limit);
}
