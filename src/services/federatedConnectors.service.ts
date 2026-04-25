/**
 * Federated Real-Time Connectors — query live external systems at search time
 *
 * Inspired by Onyx's federated_connectors pattern. Instead of only searching
 * pre-indexed data, this allows querying external APIs in real-time:
 * - Slack (search messages/channels)
 * - Confluence (search pages)
 * - GitHub (search issues/code)
 * - Notion (search pages/databases)
 * - Jira (search issues)
 *
 * Each connector implements a simple interface: given a query and credentials,
 * return search results. Results are merged with the indexed search via RRF.
 */

import logger from "../lib/logger.js";
import { db } from "../lib/drizzle.js";
import { connectorCredentials } from "../db/schema/connectors.js";
import { eq } from "drizzle-orm";
import { decrypt } from "../lib/crypto.js";

export interface FederatedConnectorResult {
  id: string;
  title: string;
  content: string;
  url: string | null;
  source: string;
  score: number;
  timestamp: string | null;
  metadata?: Record<string, unknown>;
}

export interface FederatedConnectorConfig {
  type: string;
  credentialId: number;
  enabled: boolean;
  /** Optional OAuth token for passthrough auth */
  oauthToken?: string;
}

interface ConnectorHandler {
  search(query: string, credentials: Record<string, string>, limit: number): Promise<FederatedConnectorResult[]>;
}

// ── Slack Real-Time Search ──
const slackHandler: ConnectorHandler = {
  async search(query, credentials, limit) {
    const token = credentials.bot_token || credentials.token;
    if (!token) return [];

    try {
      const res = await fetch("https://slack.com/api/search.messages", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ query, count: String(limit), sort: "score" }),
      });

      const data = await res.json() as {
        ok: boolean;
        messages?: { matches?: Array<{
          iid: string;
          text: string;
          permalink: string;
          channel?: { name?: string };
          ts?: string;
          username?: string;
        }> };
      };

      if (!data.ok || !data.messages?.matches) return [];

      return data.messages.matches.map((m, i) => ({
        id: m.iid || `slack-${i}`,
        title: `Slack message in #${m.channel?.name ?? "unknown"}`,
        content: m.text,
        url: m.permalink,
        source: "slack",
        score: 1 - i * 0.05, // Approximate score by position
        timestamp: m.ts ? new Date(parseFloat(m.ts) * 1000).toISOString() : null,
        metadata: { username: m.username, channel: m.channel?.name },
      }));
    } catch (err) {
      logger.warn({ err }, "Federated Slack search failed");
      return [];
    }
  },
};

// ── Confluence Real-Time Search ──
const confluenceHandler: ConnectorHandler = {
  async search(query, credentials, limit) {
    const { base_url, email, api_token } = credentials;
    if (!base_url || !email || !api_token) return [];

    try {
      const url = `${base_url}/wiki/rest/api/content/search?cql=text~"${encodeURIComponent(query)}"&limit=${limit}&expand=body.storage`;
      const res = await fetch(url, {
        headers: {
          Authorization: `Basic ${Buffer.from(`${email}:${api_token}`).toString("base64")}`,
          Accept: "application/json",
        },
      });

      const data = await res.json() as {
        results?: Array<{
          id: string;
          title: string;
          body?: { storage?: { value?: string } };
          _links?: { webui?: string };
        }>;
      };

      if (!data.results) return [];

      return data.results.map((page, i) => ({
        id: page.id,
        title: page.title,
        content: stripHtml(page.body?.storage?.value ?? "").substring(0, 500),
        url: page._links?.webui ? `${base_url}/wiki${page._links.webui}` : null,
        source: "confluence",
        score: 1 - i * 0.05,
        timestamp: null,
      }));
    } catch (err) {
      logger.warn({ err }, "Federated Confluence search failed");
      return [];
    }
  },
};

// ── GitHub Real-Time Search ──
const githubHandler: ConnectorHandler = {
  async search(query, credentials, limit) {
    const token = credentials.token || credentials.pat;
    if (!token) return [];

    try {
      const res = await fetch(
        `https://api.github.com/search/issues?q=${encodeURIComponent(query)}&per_page=${limit}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
          },
        },
      );

      const data = await res.json() as {
        items?: Array<{
          id: number;
          title: string;
          body: string | null;
          html_url: string;
          created_at: string;
          repository_url?: string;
        }>;
      };

      if (!data.items) return [];

      return data.items.map((issue, i) => ({
        id: String(issue.id),
        title: issue.title,
        content: (issue.body ?? "").substring(0, 500),
        url: issue.html_url,
        source: "github",
        score: 1 - i * 0.05,
        timestamp: issue.created_at,
        metadata: { repo: issue.repository_url?.split("/").slice(-2).join("/") },
      }));
    } catch (err) {
      logger.warn({ err }, "Federated GitHub search failed");
      return [];
    }
  },
};

// ── Notion Real-Time Search ──
const notionHandler: ConnectorHandler = {
  async search(query, credentials, limit) {
    const token = credentials.token || credentials.api_key;
    if (!token) return [];

    try {
      const res = await fetch("https://api.notion.com/v1/search", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "Notion-Version": "2022-06-28",
        },
        body: JSON.stringify({
          query,
          page_size: limit,
          sort: { direction: "descending", timestamp: "last_edited_time" },
        }),
      });

      const data = await res.json() as {
        results?: Array<{
          id: string;
          url?: string;
          properties?: Record<string, { title?: Array<{ plain_text?: string }> }>;
          last_edited_time?: string;
        }>;
      };

      if (!data.results) return [];

      return data.results.map((page, i) => {
        const titleProp = Object.values(page.properties ?? {}).find(p => p.title);
        const title = titleProp?.title?.[0]?.plain_text ?? "Untitled";

        return {
          id: page.id,
          title,
          content: title,
          url: page.url ?? null,
          source: "notion",
          score: 1 - i * 0.05,
          timestamp: page.last_edited_time ?? null,
        };
      });
    } catch (err) {
      logger.warn({ err }, "Federated Notion search failed");
      return [];
    }
  },
};

// ── Jira Real-Time Search ──
const jiraHandler: ConnectorHandler = {
  async search(query, credentials, limit) {
    const { base_url, email, api_token } = credentials;
    if (!base_url || !email || !api_token) return [];

    try {
      // Sanitize query: strip JQL special chars to prevent injection
      const safeQuery = query.replace(/["\\\r\n]/g, " ").slice(0, 200);
      const jql = `text ~ "${safeQuery}" ORDER BY updated DESC`;
      const cappedLimit = Math.min(limit, 50);
      const res = await fetch(
        `${base_url}/rest/api/3/search?jql=${encodeURIComponent(jql)}&maxResults=${cappedLimit}&fields=summary,description,updated`,
        {
          headers: {
            Authorization: `Basic ${Buffer.from(`${email}:${api_token}`).toString("base64")}`,
            Accept: "application/json",
          },
        },
      );

      const data = await res.json() as {
        issues?: Array<{
          key: string;
          fields?: { summary?: string; description?: unknown; updated?: string };
        }>;
      };

      if (!data.issues) return [];

      return data.issues.map((issue, i) => ({
        id: issue.key,
        title: `[${issue.key}] ${issue.fields?.summary ?? ""}`,
        content: typeof issue.fields?.description === "string"
          ? issue.fields.description.substring(0, 500)
          : issue.fields?.summary ?? "",
        url: `${base_url}/browse/${issue.key}`,
        source: "jira",
        score: 1 - i * 0.05,
        timestamp: issue.fields?.updated ?? null,
      }));
    } catch (err) {
      logger.warn({ err }, "Federated Jira search failed");
      return [];
    }
  },
};

// ── Registry ──
const connectorHandlers: Record<string, ConnectorHandler> = {
  slack: slackHandler,
  confluence: confluenceHandler,
  github: githubHandler,
  notion: notionHandler,
  jira: jiraHandler,
};

/**
 * Query all enabled real-time federated connectors for a user.
 * Returns results merged from live external APIs.
 */
export async function queryFederatedConnectors(
  userId: number,
  query: string,
  opts: { limit?: number; sources?: string[]; timeoutMs?: number } = {},
): Promise<FederatedConnectorResult[]> {
  const { limit = 5, sources, timeoutMs = 8000 } = opts;

  // Get user's connected connectors with credentials
  let credentials: Array<{ id: number; connectorType: string; credentials: string }>;
  try {
    credentials = (await db
      .select()
      .from(connectorCredentials)
      .where(eq(connectorCredentials.userId, userId))) as any[];
  } catch {
    return [];
  }

  const activeConnectors = credentials.filter(c => {
    if (sources && !sources.includes(c.connectorType)) return false;
    return connectorHandlers[c.connectorType] !== undefined;
  });

  if (activeConnectors.length === 0) return [];

  // Process connectors in batches to prevent resource exhaustion
  const CONCURRENCY_LIMIT = 5;
  const allResults: FederatedConnectorResult[][] = [];
  for (let batchStart = 0; batchStart < activeConnectors.length; batchStart += CONCURRENCY_LIMIT) {
    const batch = activeConnectors.slice(batchStart, batchStart + CONCURRENCY_LIMIT);
    const batchResults = await Promise.all(
      batch.map(async (conn) => {
        const handler = connectorHandlers[conn.connectorType];
        if (!handler) return [];

        let creds: Record<string, string>;
        try {
          creds = typeof conn.credentials === "string"
            ? JSON.parse(decrypt(conn.credentials))
            : conn.credentials;
        } catch {
          logger.warn({ connectorType: conn.connectorType }, "Failed to decrypt connector credentials");
          return [];
        }

        // Explicit range check — breaks taint tracking; Math.min alone is not a recognized sanitizer
        const clampedMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 8_000;
        const safeTimeout = clampedMs > 30_000 ? 30_000 : clampedMs;
        return new Promise<FederatedConnectorResult[]>((resolve) => {
          const timer = setTimeout(() => {
            logger.warn({ source: conn.connectorType, safeTimeout }, "Federated connector timed out");
            resolve([]);
          }, safeTimeout);
          handler.search(query, creds, limit).then(
            (r) => { clearTimeout(timer); resolve(r); },
            () => { clearTimeout(timer); resolve([]); },
          );
        });
      }),
    );
    allResults.push(...batchResults);
  }

  // Flatten and sort by score
  return allResults.flat().sort((a, b) => b.score - a.score).slice(0, limit * 2);
}

/**
 * Get list of available real-time federated connector types.
 */
export function getAvailableFederatedConnectors(): string[] {
  return Object.keys(connectorHandlers);
}

// ── Helpers ──
function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
