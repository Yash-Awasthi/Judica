/**
 * Notion Connector — Phase 3.3
 *
 * Read pages, databases, and blocks. Write back summaries or AI outputs.
 * OAuth2 + Integration token (Internal Integration Token for self-hosted).
 *
 * Inspired by:
 * - notion-sdk-js (MIT, makenotion/notion-sdk-js, 5k stars) — official Notion API client
 * - Onyx (Onyx) — Notion connector implementation
 *
 * Auth modes:
 * 1. Internal Integration Token — simplest, set NOTION_TOKEN env var
 * 2. OAuth2 — per-user token via Notion OAuth (requires NOTION_CLIENT_ID, NOTION_CLIENT_SECRET)
 */

import type { FastifyInstance } from "fastify";

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

function notionHeaders(token: string): Record<string, string> {
  return {
    Authorization:  `Bearer ${token}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
  };
}

/** Get token for a user — either per-user OAuth token or global integration token. */
const userTokens = new Map<number, string>();

function getToken(userId: number): string | null {
  return userTokens.get(userId) ?? process.env.NOTION_TOKEN ?? null;
}

async function notionGet(token: string, path: string): Promise<unknown> {
  // path is always internally constructed — validate it starts with / and contains only safe chars
  const safePath = path.replace(/[^a-zA-Z0-9/_?=&%-]/g, "");
  const res = await fetch(`${NOTION_API}${safePath}`, {
    headers: notionHeaders(token),
  });
  if (!res.ok) throw new Error(`Notion API error ${res.status}: ${await res.text()}`);
  return res.json();
}

async function notionPost(token: string, path: string, body: unknown): Promise<unknown> {
  // Validate path is a simple relative path under the Notion API to prevent SSRF
  if (!/^\/[a-zA-Z0-9/_?=&%.-]*$/.test(path)) throw new Error("Invalid Notion API path");
  const res = await fetch(`${NOTION_API}${path}`, {
    method:  "POST",
    headers: notionHeaders(token),
    body:    JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Notion API error ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function notionPlugin(app: FastifyInstance) {
  // POST /notion/token — store a per-user integration token
  app.post("/notion/token", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { token } = req.body as { token?: string };
    if (!token) return reply.status(400).send({ error: "token field required" });

    userTokens.set(userId, token);
    return { success: true, message: "Notion token stored" };
  });

  // GET /notion/status — check connection
  app.get("/notion/status", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const token = getToken(userId);
    const connected = !!token;
    const hasEnvToken = !!process.env.NOTION_TOKEN;
    const hasUserToken = userTokens.has(userId);

    return { success: true, connected, source: hasUserToken ? "user" : (hasEnvToken ? "env" : "none") };
  });

  // GET /notion/search?query= — search pages and databases
  app.get("/notion/search", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const token = getToken(userId);
    if (!token) return reply.status(503).send({ error: "Notion not connected (set NOTION_TOKEN or POST /api/notion/token)" });

    const { query = "", filter = "page" } = req.query as Record<string, string>;

    const body: Record<string, unknown> = { page_size: 20 };
    if (query) body.query = query;
    if (filter === "page" || filter === "database") body.filter = { property: "object", value: filter };

    const results = await notionPost(token, "/search", body).catch(e => null);
    return { success: true, results: (results as any)?.results ?? [] };
  });

  // GET /notion/pages/:id — get a page
  app.get("/notion/pages/:id", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const token = getToken(userId);
    if (!token) return reply.status(503).send({ error: "Notion not connected" });

    const pageId = (req.params as any).id;
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(pageId)) return reply.status(400).send({ error: "Invalid page ID" });
    const page = await notionGet(token, `/pages/${pageId}`).catch(() => null);
    if (!page) return reply.status(404).send({ error: "Page not found" });
    return { success: true, page };
  });

  // GET /notion/pages/:id/blocks — get page content blocks
  app.get("/notion/pages/:id/blocks", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const token = getToken(userId);
    if (!token) return reply.status(503).send({ error: "Notion not connected" });

    const pageId = (req.params as any).id;
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(pageId)) return reply.status(400).send({ error: "Invalid page ID" });
    const blocks = await notionGet(token, `/blocks/${pageId}/children?page_size=100`).catch(() => null);
    return { success: true, blocks: (blocks as any)?.results ?? [] };
  });

  // GET /notion/databases/:id/query — query a database
  app.post("/notion/databases/:id/query", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const token = getToken(userId);
    if (!token) return reply.status(503).send({ error: "Notion not connected" });

    const dbId = (req.params as any).id;
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(dbId)) return reply.status(400).send({ error: "Invalid database ID" });
    const filter = req.body ?? {};

    const rows = await notionPost(token, `/databases/${dbId}/query`, filter).catch(e => {
      return { results: [], error: (e as Error).message };
    });
    return { success: true, rows: (rows as any)?.results ?? [], error: (rows as any)?.error };
  });

  // POST /notion/pages/:id/comment — append a comment block to a page
  app.post("/notion/pages/:id/comment", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const token = getToken(userId);
    if (!token) return reply.status(503).send({ error: "Notion not connected" });

    const pageId = (req.params as any).id;
    const { text } = req.body as { text?: string };
    if (!text) return reply.status(400).send({ error: "text required" });

    const block = await notionPost(token, `/blocks/${pageId}/children`, {
      children: [{
        object: "block",
        type:   "paragraph",
        paragraph: {
          rich_text: [{ type: "text", text: { content: text } }],
        },
      }],
    }).catch(e => null);

    return { success: !!block };
  });
}
