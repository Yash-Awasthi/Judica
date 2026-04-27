/**
 * Connector Webhook Routes — receives real-time change notifications from
 * Slack, Confluence, GitHub, Notion, and Google Drive.
 *
 * Each handler:
 * 1. Verifies the source-specific signature
 * 2. Parses the event type
 * 3. Enqueues an incremental sync job for the changed document
 * 4. Returns 200 immediately
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import crypto from "node:crypto";
import { env } from "../config/env.js";
import { processWebhookEvent, type WebhookEvent } from "../services/webhookIngestion.service.js";
import logger from "../lib/logger.js";

const log = logger.child({ route: "webhooks" });

// ─── Signature Verification Helpers ──────────────────────────────────────────

/**
 * Verify Slack request signature (HMAC-SHA256).
 * https://api.slack.com/authentication/verifying-requests-from-slack
 */
function verifySlackSignature(
  rawBody: Buffer,
  timestamp: string,
  signature: string,
  secret: string,
): boolean {
  // Reject requests older than 5 minutes to prevent replay attacks
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp, 10)) > 300) return false;

  const baseString = `v0:${timestamp}:${rawBody.toString("utf8")}`;
  const expected = "v0=" + crypto.createHmac("sha256", secret).update(baseString).digest("hex");

  // Constant-time comparison to prevent timing attacks
  if (expected.length !== signature.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

/**
 * Verify GitHub webhook signature (HMAC-SHA256).
 * https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries
 */
function verifyGitHubSignature(
  rawBody: Buffer,
  signature: string,
  secret: string,
): boolean {
  const expected =
    "sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex");

  if (expected.length !== signature.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

/**
 * Verify a simple bearer/token header for Confluence and Notion.
 */
function verifyTokenHeader(providedToken: string, expectedToken: string): boolean {
  if (providedToken.length !== expectedToken.length) return false;
  return crypto.timingSafeEqual(
    Buffer.from(providedToken),
    Buffer.from(expectedToken),
  );
}

// ─── Route Plugin ─────────────────────────────────────────────────────────────

const webhooksPlugin: FastifyPluginAsync = async (fastify) => {
  // Webhook endpoints need raw body access for signature verification.
  // Add a content-type parser that preserves the raw buffer.
  fastify.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    (_req, body, done) => {
      done(null, body);
    },
  );

  // ─── Slack Events API ───────────────────────────────────────────────────────
  // POST /api/webhooks/slack/events
  fastify.post(
    "/slack/events",
    {
      config: { rateLimit: { max: 200, timeWindow: "1 minute" } },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const rawBody = request.body as Buffer;
      const signingSecret = env.SLACK_SIGNING_SECRET;

      if (signingSecret) {
        const timestamp = (request.headers["x-slack-request-timestamp"] as string) ?? "";
        const signature = (request.headers["x-slack-signature"] as string) ?? "";

        if (!verifySlackSignature(rawBody, timestamp, signature, signingSecret)) {
          log.warn("Slack webhook signature verification failed");
          reply.code(401).send({ error: "Invalid signature" });
          return;
        }
      }

      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(rawBody.toString("utf8"));
      } catch {
        reply.code(400).send({ error: "Invalid JSON" });
        return;
      }

      // Slack URL verification challenge
      if (payload.type === "url_verification") {
        return { challenge: payload.challenge };
      }

      // Handle event callbacks
      if (payload.type === "event_callback") {
        const slackEvent = payload.event as Record<string, unknown> | undefined;
        if (slackEvent) {
          const eventType = (slackEvent.type as string) ?? "unknown";
          const channelId = (slackEvent.channel as string) ?? "";
          const ts = (slackEvent.ts as string) ?? "";
          const connectorId = payload.connector_id as string | undefined;

          const webhookEvent: WebhookEvent = {
            source: "slack",
            eventType,
            entityId: ts ? `${channelId}:${ts}` : channelId,
            changedAt: ts ? new Date(parseFloat(ts) * 1000) : new Date(),
            connectorId,
          };

          // Fire-and-forget — respond 200 immediately
          processWebhookEvent("slack", webhookEvent).catch((err) => {
            log.error({ err, eventType }, "Failed to process Slack webhook event");
          });
        }
      }

      reply.code(200).send({ ok: true });
    },
  );

  // ─── Confluence Webhook ──────────────────────────────────────────────────────
  // POST /api/webhooks/confluence
  fastify.post(
    "/confluence",
    {
      config: { rateLimit: { max: 200, timeWindow: "1 minute" } },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const rawBody = request.body as Buffer;
      const webhookToken = env.CONFLUENCE_WEBHOOK_TOKEN;

      if (webhookToken) {
        const providedToken =
          (request.headers["x-confluence-webhook-token"] as string) ??
          (request.headers["authorization"] as string)?.replace(/^Bearer\s+/i, "") ??
          "";

        if (!providedToken || !verifyTokenHeader(providedToken, webhookToken)) {
          log.warn("Confluence webhook token verification failed");
          reply.code(401).send({ error: "Invalid token" });
          return;
        }
      }

      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(rawBody.toString("utf8"));
      } catch {
        reply.code(400).send({ error: "Invalid JSON" });
        return;
      }

      // Confluence webhook payload has "event" and "page" / "blogPost" fields
      const eventType = (payload.event as string) ?? "unknown";
      const pageData = (payload.page ?? payload.blogPost) as Record<string, unknown> | undefined;
      const pageId = (pageData?.id as string) ?? (payload.pageId as string) ?? "";
      const connectorId = payload.connector_id as string | undefined;

      if (pageId) {
        const webhookEvent: WebhookEvent = {
          source: "confluence",
          eventType,
          entityId: pageId,
          entityUrl: pageData?.self as string | undefined,
          changedAt: new Date(),
          connectorId,
        };

        processWebhookEvent("confluence", webhookEvent).catch((err) => {
          log.error({ err, eventType, pageId }, "Failed to process Confluence webhook event");
        });
      }

      reply.code(200).send({ ok: true });
    },
  );

  // ─── GitHub Webhook ──────────────────────────────────────────────────────────
  // POST /api/webhooks/github
  fastify.post(
    "/github",
    {
      config: { rateLimit: { max: 200, timeWindow: "1 minute" } },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const rawBody = request.body as Buffer;
      const webhookSecret = env.GITHUB_WEBHOOK_SECRET;

      if (webhookSecret) {
        const signature = (request.headers["x-hub-signature-256"] as string) ?? "";

        if (!signature || !verifyGitHubSignature(rawBody, signature, webhookSecret)) {
          log.warn("GitHub webhook signature verification failed");
          reply.code(401).send({ error: "Invalid signature" });
          return;
        }
      }

      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(rawBody.toString("utf8"));
      } catch {
        reply.code(400).send({ error: "Invalid JSON" });
        return;
      }

      const eventType = (request.headers["x-github-event"] as string) ?? "unknown";
      const connectorId = payload.connector_id as string | undefined;

      // Build entity ID from repo + relevant ref/PR/issue
      const repo = payload.repository as Record<string, unknown> | undefined;
      const repoFullName = (repo?.full_name as string) ?? "";
      const ref = (payload.ref as string) ?? "";
      const prNumber = (payload.number as number) ?? 0;

      let entityId = repoFullName;
      if (eventType === "push" && ref) {
        entityId = `${repoFullName}:${ref}`;
      } else if ((eventType === "pull_request" || eventType === "issues") && prNumber) {
        entityId = `${repoFullName}:${eventType}:${prNumber}`;
      }

      if (entityId) {
        const webhookEvent: WebhookEvent = {
          source: "github",
          eventType,
          entityId,
          changedAt: new Date(),
          connectorId,
        };

        processWebhookEvent("github", webhookEvent).catch((err) => {
          log.error({ err, eventType, entityId }, "Failed to process GitHub webhook event");
        });
      }

      reply.code(200).send({ ok: true });
    },
  );

  // ─── Notion Webhook ──────────────────────────────────────────────────────────
  // POST /api/webhooks/notion
  fastify.post(
    "/notion",
    {
      config: { rateLimit: { max: 200, timeWindow: "1 minute" } },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const rawBody = request.body as Buffer;

      // Notion uses a verification token in the Authorization header
      const notionToken = env.NOTION_WEBHOOK_TOKEN;
      if (notionToken) {
        const providedToken =
          (request.headers["authorization"] as string)?.replace(/^Bearer\s+/i, "") ?? "";

        if (!providedToken || !verifyTokenHeader(providedToken, notionToken)) {
          log.warn("Notion webhook token verification failed");
          reply.code(401).send({ error: "Invalid token" });
          return;
        }
      }

      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(rawBody.toString("utf8"));
      } catch {
        reply.code(400).send({ error: "Invalid JSON" });
        return;
      }

      const eventType = (payload.type as string) ?? "unknown";
      const entity = (payload.entity ?? payload.data) as Record<string, unknown> | undefined;
      const entityId = (entity?.id as string) ?? (payload.id as string) ?? "";
      const connectorId = payload.connector_id as string | undefined;

      if (entityId) {
        const webhookEvent: WebhookEvent = {
          source: "notion",
          eventType,
          entityId,
          changedAt: new Date(),
          connectorId,
        };

        processWebhookEvent("notion", webhookEvent).catch((err) => {
          log.error({ err, eventType, entityId }, "Failed to process Notion webhook event");
        });
      }

      reply.code(200).send({ ok: true });
    },
  );

  // ─── Google Drive Push Notifications ─────────────────────────────────────────
  // POST /api/webhooks/google-drive
  fastify.post(
    "/google-drive",
    {
      config: { rateLimit: { max: 200, timeWindow: "1 minute" } },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Google Drive push notifications use a channel token for verification
      const channelToken = env.GOOGLE_DRIVE_WEBHOOK_TOKEN;
      if (channelToken) {
        const providedToken = (request.headers["x-goog-channel-token"] as string) ?? "";

        if (!providedToken || !verifyTokenHeader(providedToken, channelToken)) {
          log.warn("Google Drive webhook token verification failed");
          reply.code(401).send({ error: "Invalid token" });
          return;
        }
      }

      // Google Drive notifications carry metadata in headers, not body
      const resourceId = (request.headers["x-goog-resource-id"] as string) ?? "";
      const resourceUri = (request.headers["x-goog-resource-uri"] as string) ?? "";
      const resourceState = (request.headers["x-goog-resource-state"] as string) ?? "change";
      const connectorId = (request.headers["x-judica-connector-id"] as string) ?? undefined;

      // Extract file ID from resource URI if available
      const fileIdMatch = resourceUri.match(/\/files\/([^/?]+)/);
      const entityId = fileIdMatch ? fileIdMatch[1] : resourceId;

      if (entityId) {
        const webhookEvent: WebhookEvent = {
          source: "google_drive",
          eventType: resourceState,
          entityId,
          entityUrl: resourceUri || undefined,
          changedAt: new Date(),
          connectorId,
        };

        processWebhookEvent("google_drive", webhookEvent).catch((err) => {
          log.error({ err, entityId }, "Failed to process Google Drive webhook event");
        });
      }

      // Google Drive expects 200 immediately
      reply.code(200).send();
    },
  );
};

export default webhooksPlugin;
