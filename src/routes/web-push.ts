/**
 * Web Push Notifications — Phase 4.20
 *
 * VAPID-based push notification subscriptions and delivery.
 * Inspired by Novu (novuhq/novu, 34k stars) — multi-channel notification orchestration.
 *
 * Pattern:
 * - Client registers a PushSubscription (endpoint + keys) via POST /push/subscribe
 * - Server sends pushes via web-push library (VAPID auth)
 * - In-app bell badge from GET /push/unread-count
 * - Env stubs: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_EMAIL
 *
 * Free/self-hosted: web-push library + self-generated VAPID keys (no paid service needed).
 */

import type { FastifyInstance } from "fastify";
import { db } from "../lib/drizzle.js";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { env } from "../config/env.js";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PushKeys {
  p256dh: string;
  auth: string;
}

interface PushSubscriptionRecord {
  id: number;
  userId: number;
  endpoint: string;
  keys: PushKeys;
  userAgent?: string;
  createdAt: Date;
  active: boolean;
}

// In-memory store (replace with DB table in production)
const subscriptions = new Map<string, PushSubscriptionRecord>();
let subIdCounter = 1;

// ─── VAPID config ─────────────────────────────────────────────────────────────

const VAPID_PUBLIC_KEY  = env.VAPID_PUBLIC_KEY  ?? "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDkBNnVo-FgT_b_xfJw6boiUiPFiqCUG3WvhIrxhMklE";
const VAPID_PRIVATE_KEY = env.VAPID_PRIVATE_KEY ?? "";
const VAPID_EMAIL       = env.VAPID_EMAIL       ?? "admin@judica.dev";

// Lazy-load web-push to avoid crash if not installed
async function getWebPush(): Promise<{
  setVapidDetails: (subject: string, publicKey: string, privateKey: string) => void;
  sendNotification: (sub: { endpoint: string; keys: PushKeys }, payload: string) => Promise<unknown>;
} | null> {
  try {
    const wp = await import("web-push" as string) as any;
    const lib = wp.default ?? wp;
    if (VAPID_PRIVATE_KEY) {
      lib.setVapidDetails(`mailto:${VAPID_EMAIL}`, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    }
    return lib;
  } catch {
    return null;
  }
}

// ─── Schema ───────────────────────────────────────────────────────────────────

const subscribeSchema = z.object({
  endpoint:  z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth:   z.string().min(1),
  }),
  userAgent: z.string().max(300).optional(),
});

const sendPushSchema = z.object({
  title:   z.string().min(1).max(200),
  body:    z.string().min(1).max(1000),
  icon:    z.string().url().optional(),
  url:     z.string().max(500).optional(),
  tag:     z.string().max(100).optional(),
  /** If omitted, sends to ALL subscriptions for this user */
  endpoint: z.string().url().optional(),
});

const broadcastSchema = z.object({
  title:  z.string().min(1).max(200),
  body:   z.string().min(1).max(1000),
  icon:   z.string().url().optional(),
  url:    z.string().max(500).optional(),
  tag:    z.string().max(100).optional(),
  /** If set, only users in this array receive the push */
  userIds: z.array(z.number()).max(1000).optional(),
});

// ─── Routes ──────────────────────────────────────────────────────────────────

export async function webPushPlugin(app: FastifyInstance) {

  /**
   * GET /push/vapid-public-key
   * Returns VAPID public key for the browser to use in PushManager.subscribe().
   */
  app.get("/push/vapid-public-key", async (_req, reply) => {
    return reply.send({ publicKey: VAPID_PUBLIC_KEY });
  });

  /**
   * POST /push/subscribe
   * Register a PushSubscription for the current user.
   */
  app.post("/push/subscribe", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = subscribeSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { endpoint, keys, userAgent } = parsed.data;

    // Upsert: same endpoint = update keys
    const existing = subscriptions.get(endpoint);
    if (existing && existing.userId === userId) {
      existing.keys = keys;
      existing.active = true;
      return reply.send({ success: true, id: existing.id, status: "updated" });
    }

    const id = subIdCounter++;
    const record: PushSubscriptionRecord = {
      id, userId, endpoint, keys,
      userAgent,
      createdAt: new Date(),
      active: true,
    };
    subscriptions.set(endpoint, record);

    return reply.status(201).send({ success: true, id, status: "created" });
  });

  /**
   * DELETE /push/subscribe
   * Unregister a PushSubscription.
   */
  app.delete("/push/subscribe", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { endpoint } = req.body as { endpoint?: string };
    if (!endpoint) return reply.status(400).send({ error: "endpoint required" });

    const record = subscriptions.get(endpoint);
    if (!record || record.userId !== userId) {
      return reply.status(404).send({ error: "Subscription not found" });
    }

    record.active = false;
    return reply.send({ success: true });
  });

  /**
   * GET /push/subscriptions
   * List active subscriptions for the current user.
   */
  app.get("/push/subscriptions", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const userSubs = [...subscriptions.values()]
      .filter(s => s.userId === userId && s.active)
      .map(({ keys: _keys, ...rest }) => rest); // strip private keys from response

    return reply.send({ success: true, subscriptions: userSubs, count: userSubs.length });
  });

  /**
   * POST /push/send
   * Send a web push notification to the current user (all or specific endpoint).
   */
  app.post("/push/send", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = sendPushSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { endpoint: targetEndpoint, ...payload } = parsed.data;

    const webpush = await getWebPush();
    if (!webpush || !VAPID_PRIVATE_KEY) {
      return reply.status(503).send({
        error: "Web push not configured",
        hint: "Set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_EMAIL env vars",
      });
    }

    const targets = [...subscriptions.values()].filter(s =>
      s.userId === userId &&
      s.active &&
      (!targetEndpoint || s.endpoint === targetEndpoint),
    );

    const results = await Promise.allSettled(
      targets.map(sub =>
        webpush.sendNotification(
          { endpoint: sub.endpoint, keys: sub.keys },
          JSON.stringify(payload),
        ).catch((err: any) => {
          // 410 Gone = subscription expired
          if (err?.statusCode === 410) sub.active = false;
          throw err;
        }),
      ),
    );

    const sent    = results.filter(r => r.status === "fulfilled").length;
    const failed  = results.filter(r => r.status === "rejected").length;

    return reply.send({ success: true, sent, failed, total: targets.length });
  });

  /**
   * POST /push/broadcast
   * Admin: send push to all users (or specific userId list).
   * Only usable if req.isAdmin is set (handled by auth middleware).
   */
  app.post("/push/broadcast", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = broadcastSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { userIds, ...payload } = parsed.data;

    const webpush = await getWebPush();
    if (!webpush || !VAPID_PRIVATE_KEY) {
      return reply.status(503).send({
        error: "Web push not configured",
        hint: "Set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_EMAIL env vars",
      });
    }

    const targets = [...subscriptions.values()].filter(s =>
      s.active &&
      (!userIds || userIds.includes(s.userId)),
    );

    const results = await Promise.allSettled(
      targets.map(sub =>
        webpush.sendNotification(
          { endpoint: sub.endpoint, keys: sub.keys },
          JSON.stringify(payload),
        ).catch((err: any) => {
          if (err?.statusCode === 410) sub.active = false;
          throw err;
        }),
      ),
    );

    const sent   = results.filter(r => r.status === "fulfilled").length;
    const failed = results.filter(r => r.status === "rejected").length;

    return reply.send({ success: true, sent, failed, total: targets.length });
  });

  /**
   * GET /push/stats
   * Count of active subscriptions per user (admin usage or self-query).
   */
  app.get("/push/stats", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const userSubs = [...subscriptions.values()].filter(s => s.userId === userId && s.active);
    const total    = [...subscriptions.values()].filter(s => s.active).length;

    return reply.send({
      success: true,
      yourSubscriptions: userSubs.length,
      globalActive: total,
      vapidConfigured: !!VAPID_PRIVATE_KEY,
    });
  });
}

// ─── Helper: send push from other modules ────────────────────────────────────

export async function sendPushToUser(
  userId: number,
  payload: { title: string; body: string; url?: string; tag?: string },
): Promise<void> {
  try {
    const webpush = await getWebPush();
    if (!webpush || !VAPID_PRIVATE_KEY) return;

    const targets = [...subscriptions.values()].filter(s => s.userId === userId && s.active);
    await Promise.allSettled(
      targets.map(sub =>
        webpush.sendNotification(
          { endpoint: sub.endpoint, keys: sub.keys },
          JSON.stringify(payload),
        ).catch((err: any) => {
          if (err?.statusCode === 410) sub.active = false;
        }),
      ),
    );
  } catch { /* never throw from push helper */ }
}
