/**
 * Slack Connector — Phase 3.4
 *
 * Read channel history for context, post AI summaries and responses.
 * Webhook-based + OAuth2 / Bot Token.
 *
 * Inspired by:
 * - Bolt for JavaScript (MIT, slackapi/bolt-js, 3k stars) — official Slack app framework
 * - Slack Web API — events, conversations, and message posting
 *
 * Auth modes:
 * 1. Bot Token — simplest, set SLACK_BOT_TOKEN env var
 * 2. Per-user OAuth2 token via POST /api/slack/token
 */

import { FastifyInstance } from "fastify";

const SLACK_API = "https://slack.com/api";

const userTokens = new Map<number, string>();

function getToken(userId: number): string | null {
  return userTokens.get(userId) ?? process.env.SLACK_BOT_TOKEN ?? null;
}

async function slackPost(token: string, method: string, body: unknown): Promise<any> {
  const res = await fetch(`${SLACK_API}/${method}`, {
    method: "POST",
    headers: {
      Authorization:  `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Slack API error ${res.status}`);
  const data = await res.json();
  if (!data.ok) throw new Error(`Slack error: ${data.error}`);
  return data;
}

async function slackGet(token: string, method: string, params: Record<string, string> = {}): Promise<any> {
  const url = `${SLACK_API}/${method}?${new URLSearchParams(params)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Slack API error ${res.status}`);
  const data = await res.json();
  if (!data.ok) throw new Error(`Slack error: ${data.error}`);
  return data;
}

export async function slackPlugin(app: FastifyInstance) {
  // POST /slack/token — store per-user bot token
  app.post("/slack/token", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { token } = req.body as { token?: string };
    if (!token) return reply.status(400).send({ error: "token required" });

    userTokens.set(userId, token);
    return { success: true };
  });

  // GET /slack/status — check connection
  app.get("/slack/status", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const token = getToken(userId);
    if (!token) return { success: true, connected: false };

    const authTest = await slackGet(token, "auth.test").catch(() => null);
    return {
      success:   true,
      connected: !!authTest,
      team:      authTest?.team,
      user:      authTest?.user,
    };
  });

  // GET /slack/channels — list public channels
  app.get("/slack/channels", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const token = getToken(userId);
    if (!token) return reply.status(503).send({ error: "Slack not connected" });

    const data = await slackGet(token, "conversations.list", {
      types: "public_channel,private_channel",
      limit: "100",
      exclude_archived: "true",
    }).catch(() => ({ channels: [] }));

    return { success: true, channels: data.channels ?? [] };
  });

  // GET /slack/channels/:channelId/history?limit=50 — read channel messages
  app.get("/slack/channels/:channelId/history", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const token = getToken(userId);
    if (!token) return reply.status(503).send({ error: "Slack not connected" });

    const channelId = (req.params as any).channelId;
    const { limit = "50" } = req.query as Record<string, string>;

    const data = await slackGet(token, "conversations.history", { channel: channelId, limit }).catch(() => null);
    return { success: true, messages: data?.messages ?? [] };
  });

  // POST /slack/messages — post a message to a channel
  app.post("/slack/messages", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const token = getToken(userId);
    if (!token) return reply.status(503).send({ error: "Slack not connected" });

    const { channel, text, thread_ts } = req.body as { channel?: string; text?: string; thread_ts?: string };
    if (!channel || !text) return reply.status(400).send({ error: "channel and text required" });

    const body: Record<string, unknown> = { channel, text };
    if (thread_ts) body.thread_ts = thread_ts;

    const result = await slackPost(token, "chat.postMessage", body).catch(e => ({ error: (e as Error).message }));
    return { success: !(result as any).error, ...result };
  });

  // GET /slack/users/:userId — get user info
  app.get("/slack/users/:slackUserId", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const token = getToken(userId);
    if (!token) return reply.status(503).send({ error: "Slack not connected" });

    const slackUserId = (req.params as any).slackUserId;
    const data = await slackGet(token, "users.info", { user: slackUserId }).catch(() => null);
    return { success: true, user: data?.user ?? null };
  });

  // POST /slack/webhook — receive Slack webhook events (for real-time integration)
  app.post("/slack/webhook", async (req, reply) => {
    const body = req.body as any;

    // URL verification challenge
    if (body?.type === "url_verification") {
      return { challenge: body.challenge };
    }

    // Log events (production: process and store)
    if (body?.event) {
      // TODO: queue event for processing
    }

    return reply.status(200).send({ ok: true });
  });
}
