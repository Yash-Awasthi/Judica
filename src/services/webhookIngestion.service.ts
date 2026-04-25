/**
 * Webhook Ingestion Service — processes incoming webhook events from external connectors
 * (Slack, Confluence, GitHub, Notion, Google Drive) and enqueues targeted ingestion jobs.
 */

import { docfetchQueue } from "../queue/specializedQueues.js";
import { lightQueue } from "../queue/specializedQueues.js";
import { QUEUE_PRIORITY } from "../queue/queues.js";
import { db } from "../lib/drizzle.js";
import { connectorInstances, connectorCredentials } from "../db/schema/connectors.js";
import { eq } from "drizzle-orm";
import logger from "../lib/logger.js";

const log = logger.child({ service: "webhookIngestion" });

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WebhookEvent {
  /** Source system: "slack" | "confluence" | "github" | "notion" | "google_drive" */
  source: string;
  /** Event type as reported by the source (e.g. "page_update", "push", "file_shared") */
  eventType: string;
  /** Page ID, file ID, repo+path, channel+ts, etc. */
  entityId: string;
  /** Direct URL to the entity (optional) */
  entityUrl?: string;
  /** When the change occurred */
  changedAt: Date;
  /** Which connector instance to use for fetching (optional — resolved by source if omitted) */
  connectorId?: string;
}

// ─── Main Handler ─────────────────────────────────────────────────────────────

/**
 * Process a webhook event: determine which documents changed and enqueue
 * targeted ingestion jobs for them.
 */
export async function processWebhookEvent(
  source: string,
  event: WebhookEvent,
): Promise<void> {
  log.info(
    { source, eventType: event.eventType, entityId: event.entityId },
    "Processing webhook event",
  );

  // Resolve connector for this source (use provided connectorId or auto-detect by source)
  const connectorId = event.connectorId ?? (await resolveConnectorBySource(source));

  if (!connectorId) {
    log.warn({ source, entityId: event.entityId }, "No connector found for webhook source — skipping");
    return;
  }

  switch (source) {
    case "slack":
      await handleSlackWebhookEvent(event, connectorId);
      break;

    case "confluence":
      await handleConfluenceWebhookEvent(event, connectorId);
      break;

    case "github":
      await handleGitHubWebhookEvent(event, connectorId);
      break;

    case "notion":
      await handleNotionWebhookEvent(event, connectorId);
      break;

    case "google_drive":
      await handleGoogleDriveWebhookEvent(event, connectorId);
      break;

    default:
      log.warn({ source }, "Unknown webhook source");
  }
}

// ─── Source-Specific Handlers ─────────────────────────────────────────────────

async function handleSlackWebhookEvent(
  event: WebhookEvent,
  connectorId: string,
): Promise<void> {
  const { eventType, entityId } = event;

  // Slack events: message, file_shared, channel_archive, channel_unarchive, etc.
  const ingestableEvents = [
    "message",
    "file_shared",
    "file_created",
    "message.channels",
    "message.groups",
    "message.im",
    "message.mpim",
  ];

  if (!ingestableEvents.some((e) => eventType.startsWith(e))) {
    log.debug({ eventType }, "Slack event type not ingestable — skipping");
    return;
  }

  // entityId format: "channelId:ts" or just "channelId"
  const [channelId, ts] = entityId.split(":");

  await docfetchQueue.add(
    "connector-pull",
    {
      connectorId,
      source: "slack",
      targetEntityId: entityId,
      channelId,
      messageTs: ts,
      triggeredByWebhook: true,
      changedAt: event.changedAt.toISOString(),
    },
    { priority: QUEUE_PRIORITY.HIGH },
  );

  log.info({ channelId, ts, connectorId }, "Enqueued Slack incremental sync");
}

async function handleConfluenceWebhookEvent(
  event: WebhookEvent,
  connectorId: string,
): Promise<void> {
  const { eventType, entityId } = event;

  // Confluence events: page_created, page_updated, page_deleted, blog_created, etc.
  if (eventType === "page_deleted" || eventType === "blog_deleted") {
    // For deletions, enqueue a cleanup job
    await lightQueue.add(
      "connector-acl-refresh",
      {
        connectorId,
        source: "confluence",
        action: "delete",
        entityId,
        triggeredByWebhook: true,
      },
      { priority: QUEUE_PRIORITY.NORMAL },
    );
    return;
  }

  const ingestableEvents = ["page_created", "page_updated", "blog_created", "blog_updated"];
  if (!ingestableEvents.includes(eventType)) {
    log.debug({ eventType }, "Confluence event type not ingestable — skipping");
    return;
  }

  await docfetchQueue.add(
    "connector-pull",
    {
      connectorId,
      source: "confluence",
      targetEntityId: entityId,
      triggeredByWebhook: true,
      changedAt: event.changedAt.toISOString(),
    },
    { priority: QUEUE_PRIORITY.HIGH },
  );

  log.info({ pageId: entityId, connectorId }, "Enqueued Confluence incremental sync");
}

async function handleGitHubWebhookEvent(
  event: WebhookEvent,
  connectorId: string,
): Promise<void> {
  const { eventType, entityId } = event;

  // GitHub events: push, pull_request, issues, create, delete
  const ingestableEvents = ["push", "pull_request", "issue_comment", "issues", "create"];

  if (!ingestableEvents.includes(eventType)) {
    log.debug({ eventType }, "GitHub event type not ingestable — skipping");
    return;
  }

  await docfetchQueue.add(
    "connector-pull",
    {
      connectorId,
      source: "github",
      targetEntityId: entityId,
      eventType,
      triggeredByWebhook: true,
      changedAt: event.changedAt.toISOString(),
    },
    { priority: QUEUE_PRIORITY.HIGH },
  );

  log.info({ entityId, eventType, connectorId }, "Enqueued GitHub incremental sync");
}

async function handleNotionWebhookEvent(
  event: WebhookEvent,
  connectorId: string,
): Promise<void> {
  const { eventType, entityId } = event;

  // Notion events: page.updated, page.created, database.updated
  const ingestableEvents = ["page.updated", "page.created", "database.updated"];

  if (!ingestableEvents.includes(eventType)) {
    log.debug({ eventType }, "Notion event type not ingestable — skipping");
    return;
  }

  await docfetchQueue.add(
    "connector-pull",
    {
      connectorId,
      source: "notion",
      targetEntityId: entityId,
      triggeredByWebhook: true,
      changedAt: event.changedAt.toISOString(),
    },
    { priority: QUEUE_PRIORITY.HIGH },
  );

  log.info({ pageId: entityId, connectorId }, "Enqueued Notion incremental sync");
}

async function handleGoogleDriveWebhookEvent(
  event: WebhookEvent,
  connectorId: string,
): Promise<void> {
  const { entityId } = event;

  // Google Drive uses push notifications — any notification means the resource changed
  await docfetchQueue.add(
    "connector-pull",
    {
      connectorId,
      source: "google_drive",
      targetEntityId: entityId,
      triggeredByWebhook: true,
      changedAt: event.changedAt.toISOString(),
    },
    { priority: QUEUE_PRIORITY.HIGH },
  );

  log.info({ fileId: entityId, connectorId }, "Enqueued Google Drive incremental sync");
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Find the first enabled connector for a given source.
 * Used when a webhook doesn't specify a connectorId.
 */
async function resolveConnectorBySource(source: string): Promise<string | null> {
  const [connector] = await db
    .select({ id: connectorInstances.id })
    .from(connectorInstances)
    .where(eq(connectorInstances.source, source))
    .limit(1);

  return connector?.id ?? null;
}
