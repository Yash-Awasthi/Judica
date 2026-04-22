import crypto from "crypto";
import logger from "../lib/logger.js";
import { isPrivateIP } from "../lib/ssrf.js";


/**
 * Webhook Triggers: fire HTTP callbacks on deliberation events.
 * Supports filtering by event type, retry logic, and secret signing.
 */

export type WebhookEvent =
  | "deliberation.started"
  | "deliberation.completed"
  | "deliberation.conflict"
  | "verdict.reached"
  | "confidence.threshold"
  | "agent.error"
  | "task.completed"
  | "task.failed";

export interface WebhookConfig {
  id: string;
  url: string;
  events: WebhookEvent[];
  secret?: string;
  enabled: boolean;
  retries: number;
  createdAt: string;
}

export interface WebhookPayload {
  event: WebhookEvent;
  timestamp: string;
  data: Record<string, unknown>;
}

export interface WebhookDelivery {
  webhookId: string;
  event: WebhookEvent;
  statusCode: number | null;
  success: boolean;
  error?: string;
  attempts: number;
  deliveredAt: string;
}

// ─── Webhook Registry ───────────────────────────────────────────────────────

// P23-09: Cap webhook registry to prevent unbounded memory growth
const MAX_WEBHOOKS = 200;
const webhooks = new Map<string, WebhookConfig>();
// P23-02: Cap delivery log to prevent unbounded memory growth
const MAX_DELIVERY_LOG = 5000;
const deliveryLog: WebhookDelivery[] = [];

/**
 * Register a webhook.
 */
export function registerWebhook(config: Omit<WebhookConfig, "id" | "createdAt">): WebhookConfig {
  // R2-02: Replace manual hostname list with isPrivateIP (covers all RFC-1918/loopback/link-local)
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(config.url);
  } catch {
    throw new Error("Invalid webhook URL");
  }
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error("Webhook URL must use http or https protocol");
  }
  const hostname = parsedUrl.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    hostname === "localhost" ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname === "metadata.google.internal" ||
    isPrivateIP(hostname)
  ) {
    throw new Error("Webhook URL targets a restricted hostname");
  }

  const webhook: WebhookConfig = {
    ...config,
    // P23-03: Use crypto.randomUUID for collision-resistant IDs instead of Math.random
    id: `wh_${randomUUID()}`,
    createdAt: new Date().toISOString(),
  };
  webhooks.set(webhook.id, webhook);
  logger.info({ webhookId: webhook.id, events: webhook.events }, "Webhook registered");
  return webhook;
}

/**
 * Remove a webhook.
 */
export function removeWebhook(id: string): boolean {
  return webhooks.delete(id);
}

/**
 * List all webhooks.
 */
export function listWebhooks(): WebhookConfig[] {
  return [...webhooks.values()];
}

/**
 * Get webhook by ID.
 */
export function getWebhook(id: string): WebhookConfig | undefined {
  return webhooks.get(id);
}

/**
 * Clear all webhooks (for testing).
 */
export function clearWebhooks(): void {
  webhooks.clear();
  deliveryLog.length = 0;
}

/**
 * Get recent delivery log entries.
 */
export function getDeliveryLog(limit: number = 50): WebhookDelivery[] {
  return deliveryLog.slice(-limit);
}

/**
 * P4-31: Get failed deliveries (dead-letter queue) for inspection and retry.
 */
export function getFailedDeliveries(limit: number = 50): WebhookDelivery[] {
  return deliveryLog
    .filter((d) => !d.success)
    .slice(-limit);
}

/**
 * P4-31: Retry a specific failed delivery by webhookId + event.
 * Re-fires the event to the webhook with the original data.
 */
export async function retryFailedDelivery(
  webhookId: string,
  event: WebhookEvent,
  data: Record<string, unknown>,
): Promise<WebhookDelivery | null> {
  const wh = webhooks.get(webhookId);
  if (!wh || !wh.enabled) return null;

  const payload: WebhookPayload = {
    event,
    timestamp: new Date().toISOString(),
    data,
  };

  const delivery = await deliverWebhook(wh, payload, fetch as unknown as (url: string, init: RequestInit) => Promise<{ status: number }>);
  deliveryLog.push(delivery);
  // P23-02: Evict oldest entries when log exceeds cap
  if (deliveryLog.length > MAX_DELIVERY_LOG) {
    deliveryLog.splice(0, deliveryLog.length - MAX_DELIVERY_LOG);
  }
  return delivery;
}

// ─── Webhook Signing ────────────────────────────────────────────────────────

/**
 * Compute HMAC-SHA256 signature for payload verification.
 * Format matches GitHub/Stripe webhook conventions: "sha256=<hex>"
 */
export function computeSignature(payload: string, secret: string): string {
  // R2-01: Use proper HMAC-SHA256 — the previous djb2-style hash was trivially forgeable
  return "sha256=" + crypto.createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

// ─── Event Firing ───────────────────────────────────────────────────────────

/**
 * Fire a webhook event to all matching subscribers.
 */
export async function fireEvent(
  event: WebhookEvent,
  data: Record<string, unknown>,
  fetchFn: (url: string, init: RequestInit) => Promise<{ status: number }> = fetch as unknown as (url: string, init: RequestInit) => Promise<{ status: number }>,
): Promise<WebhookDelivery[]> {
  const payload: WebhookPayload = {
    event,
    timestamp: new Date().toISOString(),
    data,
  };

  const matchingWebhooks = [...webhooks.values()].filter(
    (wh) => wh.enabled && wh.events.includes(event),
  );

  const deliveries = await Promise.all(
    matchingWebhooks.map((wh) => deliverWebhook(wh, payload, fetchFn)),
  );

  deliveryLog.push(...deliveries);

  // Keep delivery log bounded
  if (deliveryLog.length > 1000) {
    deliveryLog.splice(0, deliveryLog.length - 1000);
  }

  return deliveries;
}

/**
 * Deliver a webhook with retry logic.
 */
async function deliverWebhook(
  webhook: WebhookConfig,
  payload: WebhookPayload,
  fetchFn: (url: string, init: RequestInit) => Promise<{ status: number }>,
): Promise<WebhookDelivery> {
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  if (webhook.secret) {
    headers["X-Webhook-Signature"] = computeSignature(body, webhook.secret);
  }

  let lastError: string | undefined;
  let statusCode: number | null = null;

  for (let attempt = 0; attempt <= webhook.retries; attempt++) {
    try {
      const response = await fetchFn(webhook.url, {
        method: "POST",
        headers,
        body,
      });

      statusCode = response.status;

      if (statusCode >= 200 && statusCode < 300) {
        return {
          webhookId: webhook.id,
          event: payload.event,
          statusCode,
          success: true,
          attempts: attempt + 1,
          deliveredAt: new Date().toISOString(),
        };
      }

      lastError = `HTTP ${statusCode}`;
    } catch (err) {
      lastError = (err as Error).message;
    }
  }

  logger.warn({ webhookId: webhook.id, event: payload.event, error: lastError }, "Webhook delivery failed");

  return {
    webhookId: webhook.id,
    event: payload.event,
    statusCode,
    success: false,
    error: lastError,
    attempts: webhook.retries + 1,
    deliveredAt: new Date().toISOString(),
  };
}
