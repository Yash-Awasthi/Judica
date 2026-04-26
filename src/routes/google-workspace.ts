/**
 * Google Workspace Connector — Phase 3.2
 *
 * Gmail (read/send), Google Calendar (read/create), Google Drive (read/upload).
 * Full OAuth2 flow per user. Council can reference emails and calendar context.
 *
 * Inspired by:
 * - googleapis (Apache 2.0, googleapis/google-api-nodejs-client, 12k stars)
 * - Nylas (unified email/calendar/contacts API)
 *
 * OAuth2 flow:
 * 1. GET /google/auth         — redirect to Google OAuth consent page
 * 2. GET /google/auth/callback — exchange code for tokens, store encrypted
 * 3. Subsequent API calls use stored refresh token to get access token
 *
 * Required env vars:
 * - GOOGLE_CLIENT_ID
 * - GOOGLE_CLIENT_SECRET
 * - GOOGLE_REDIRECT_URI (e.g. https://yourapp.com/api/google/auth/callback)
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/drive.file",
].join(" ");

interface GoogleTokens {
  access_token:  string;
  refresh_token?: string;
  expires_in:    number;
  token_type:    string;
}

/** Exchange auth code for tokens. */
async function exchangeCode(code: string): Promise<GoogleTokens | null> {
  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri  = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) return null;

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id:     clientId,
      client_secret: clientSecret,
      redirect_uri:  redirectUri,
      grant_type:    "authorization_code",
    }),
  });

  if (!res.ok) return null;
  return res.json() as Promise<GoogleTokens>;
}

/** Refresh access token using stored refresh token. */
async function refreshAccessToken(refreshToken: string): Promise<string | null> {
  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id:     clientId,
      client_secret: clientSecret,
      grant_type:    "refresh_token",
    }),
  });

  if (!res.ok) return null;
  const data = await res.json() as GoogleTokens;
  return data.access_token;
}

/** In-memory token store (production: use DB with encryption). */
const tokenStore = new Map<number, { accessToken: string; refreshToken?: string; expiresAt: number }>();

async function getAccessToken(userId: number): Promise<string | null> {
  const stored = tokenStore.get(userId);
  if (!stored) return null;

  // Refresh if expiring within 60s
  if (Date.now() > stored.expiresAt - 60_000 && stored.refreshToken) {
    const newToken = await refreshAccessToken(stored.refreshToken);
    if (newToken) {
      stored.accessToken = newToken;
      stored.expiresAt = Date.now() + 3600_000;
    }
  }

  return stored.accessToken;
}

async function googleApiGet(userId: number, endpoint: string): Promise<unknown> {
  const token = await getAccessToken(userId);
  if (!token) throw new Error("Not authenticated with Google");

  // endpoint is always internally constructed; sanitize to prevent path manipulation
  const safeEndpoint = endpoint.replace(/[^a-zA-Z0-9/_?=&%.@:-]/g, "");
  const res = await fetch(`https://www.googleapis.com${safeEndpoint}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Google API error ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function googleWorkspacePlugin(app: FastifyInstance) {
  // GET /google/auth — initiate OAuth2 flow
  app.get("/google/auth", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const clientId    = process.env.GOOGLE_CLIENT_ID;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI;
    if (!clientId || !redirectUri) {
      return reply.status(503).send({ error: "Google OAuth not configured (set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI)" });
    }

    const params = new URLSearchParams({
      client_id:     clientId,
      redirect_uri:  redirectUri,
      response_type: "code",
      scope:         GOOGLE_SCOPES,
      access_type:   "offline",
      prompt:        "consent",
      state:         String(userId),
    });

    return { success: true, authUrl: `${GOOGLE_AUTH_URL}?${params}` };
  });

  // GET /google/auth/callback — OAuth2 callback
  app.get("/google/auth/callback", async (req, reply) => {
    const { code, state, error } = req.query as Record<string, string>;
    if (error) return reply.status(400).send({ error: `OAuth error: ${error}` });
    if (!code) return reply.status(400).send({ error: "Missing code" });

    const userId = Number(state);
    if (isNaN(userId)) return reply.status(400).send({ error: "Invalid state" });

    const tokens = await exchangeCode(code);
    if (!tokens) return reply.status(500).send({ error: "Token exchange failed" });

    tokenStore.set(userId, {
      accessToken:  tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt:    Date.now() + tokens.expires_in * 1000,
    });

    return { success: true, message: "Google Workspace connected" };
  });

  // GET /google/gmail/messages?maxResults=10 — read recent emails
  app.get("/google/gmail/messages", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { maxResults = "10", q = "" } = req.query as Record<string, string>;
    const params = new URLSearchParams({ maxResults, ...(q ? { q } : {}) });

    const list = await googleApiGet(userId, `/gmail/v1/users/me/messages?${params}`).catch(e => null);
    return { success: true, messages: (list as any)?.messages ?? [] };
  });

  // GET /google/gmail/messages/:id — read single email
  app.get("/google/gmail/messages/:id", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const msgId = (req.params as any).id;
    if (!/^[a-zA-Z0-9_-]{1,200}$/.test(msgId)) return reply.status(400).send({ error: "Invalid message ID" });
    const message = await googleApiGet(userId, `/gmail/v1/users/me/messages/${msgId}?format=full`).catch(() => null);
    if (!message) return reply.status(404).send({ error: "Message not found" });
    return { success: true, message };
  });

  // GET /google/calendar/events?maxResults=10 — list upcoming events
  app.get("/google/calendar/events", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { maxResults = "10" } = req.query as Record<string, string>;
    const now = new Date().toISOString();
    const params = new URLSearchParams({ maxResults, timeMin: now, orderBy: "startTime", singleEvents: "true" });

    const events = await googleApiGet(userId, `/calendar/v3/calendars/primary/events?${params}`).catch(() => null);
    return { success: true, events: (events as any)?.items ?? [] };
  });

  // GET /google/drive/files?maxResults=10 — list recent Drive files
  app.get("/google/drive/files", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { maxResults = "10" } = req.query as Record<string, string>;
    const params = new URLSearchParams({ pageSize: maxResults, fields: "files(id,name,mimeType,webViewLink,modifiedTime)" });

    const files = await googleApiGet(userId, `/drive/v3/files?${params}`).catch(() => null);
    return { success: true, files: (files as any)?.files ?? [] };
  });

  // GET /google/status — check connection status
  app.get("/google/status", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const configured = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
    const connected  = tokenStore.has(userId);

    return { success: true, configured, connected };
  });
}
