/**
 * Linear / Jira Connector — Phase 3.5
 *
 * Read issues, create issues from council output, link conversations to tickets.
 *
 * Inspired by:
 * - Linear SDK (MIT, linear/linear) — official Linear API client with GraphQL
 * - Jira REST API — Atlassian's issue tracker REST API v3
 * - Nango — pre-built Linear and Jira integrations
 *
 * Linear: GraphQL API + personal API key (no OAuth required for personal use)
 * Jira: REST v3 + API token (Basic auth with email:token)
 */

import { FastifyInstance } from "fastify";
import { z } from "zod";

// ─── Linear ──────────────────────────────────────────────────────────────────

const LINEAR_API = "https://api.linear.app/graphql";

const linearTokens = new Map<number, string>();
const jiraConfigs  = new Map<number, { baseUrl: string; email: string; token: string }>();

function getLinearToken(userId: number): string | null {
  return linearTokens.get(userId) ?? process.env.LINEAR_API_KEY ?? null;
}

async function linearQuery(token: string, query: string, variables: Record<string, unknown> = {}): Promise<any> {
  const res = await fetch(LINEAR_API, {
    method:  "POST",
    headers: {
      Authorization:  token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Linear API error ${res.status}`);
  const data = await res.json() as { data?: unknown; errors?: unknown[] };
  if (data.errors) throw new Error(JSON.stringify(data.errors));
  return data.data;
}

// ─── Jira ────────────────────────────────────────────────────────────────────

function getJiraConfig(userId: number) {
  const stored = jiraConfigs.get(userId);
  if (stored) return stored;
  if (process.env.JIRA_BASE_URL && process.env.JIRA_EMAIL && process.env.JIRA_API_TOKEN) {
    return { baseUrl: process.env.JIRA_BASE_URL, email: process.env.JIRA_EMAIL, token: process.env.JIRA_API_TOKEN };
  }
  return null;
}

async function jiraGet(cfg: { baseUrl: string; email: string; token: string }, path: string): Promise<any> {
  const res = await fetch(`${cfg.baseUrl}/rest/api/3${path}`, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${cfg.email}:${cfg.token}`).toString("base64")}`,
      Accept:        "application/json",
    },
  });
  if (!res.ok) throw new Error(`Jira API error ${res.status}`);
  return res.json();
}

async function jiraPost(cfg: { baseUrl: string; email: string; token: string }, path: string, body: unknown): Promise<any> {
  const res = await fetch(`${cfg.baseUrl}/rest/api/3${path}`, {
    method:  "POST",
    headers: {
      Authorization:  `Basic ${Buffer.from(`${cfg.email}:${cfg.token}`).toString("base64")}`,
      "Content-Type": "application/json",
      Accept:         "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Jira API error ${res.status}: ${await res.text()}`);
  return res.json();
}

// ─── Schemas ─────────────────────────────────────────────────────────────────

const linearTokenSchema = z.object({ apiKey: z.string().min(1) });
const jiraConfigSchema  = z.object({
  baseUrl: z.string().url(),
  email:   z.string().email(),
  token:   z.string().min(1),
});
const createIssueSchema = z.object({
  title:       z.string().min(1),
  description: z.string().optional(),
  teamId:      z.string().optional(),  // Linear
  projectId:   z.string().optional(),  // Jira
  priority:    z.number().min(0).max(4).optional(), // Linear 0-4
});

export async function linearJiraPlugin(app: FastifyInstance) {
  // ── Linear ────────────────────────────────────────────────────────────────

  // POST /linear/token — store Linear API key
  app.post("/linear/token", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = linearTokenSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: "apiKey required" });

    linearTokens.set(userId, parsed.data.apiKey);
    return { success: true };
  });

  // GET /linear/teams — list teams
  app.get("/linear/teams", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const token = getLinearToken(userId);
    if (!token) return reply.status(503).send({ error: "Linear not configured (set LINEAR_API_KEY)" });

    const data = await linearQuery(token, `{ teams { nodes { id name key } } }`).catch(() => null);
    return { success: true, teams: data?.teams?.nodes ?? [] };
  });

  // GET /linear/issues?teamId=&limit=20 — list issues
  app.get("/linear/issues", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const token = getLinearToken(userId);
    if (!token) return reply.status(503).send({ error: "Linear not configured" });

    const { teamId, limit = "20" } = req.query as Record<string, string>;
    const filter = teamId ? `filter: { team: { id: { eq: "${teamId}" } } }` : "";

    const data = await linearQuery(token, `{ issues(first: ${limit} ${filter}) { nodes { id title state { name } priority url createdAt } } }`).catch(() => null);
    return { success: true, issues: data?.issues?.nodes ?? [] };
  });

  // POST /linear/issues — create issue
  app.post("/linear/issues", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const token = getLinearToken(userId);
    if (!token) return reply.status(503).send({ error: "Linear not configured" });

    const parsed = createIssueSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { title, description = "", teamId, priority } = parsed.data;
    if (!teamId) return reply.status(400).send({ error: "teamId required for Linear" });

    const variables: Record<string, unknown> = { title, description, teamId };
    if (priority !== undefined) variables.priority = priority;

    const data = await linearQuery(token, `
      mutation CreateIssue($title: String!, $description: String, $teamId: String!, $priority: Int) {
        issueCreate(input: { title: $title, description: $description, teamId: $teamId, priority: $priority }) {
          success issue { id title url }
        }
      }
    `, variables);

    return { success: data?.issueCreate?.success, issue: data?.issueCreate?.issue };
  });

  // ── Jira ──────────────────────────────────────────────────────────────────

  // POST /jira/config — store Jira connection config
  app.post("/jira/config", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = jiraConfigSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    jiraConfigs.set(userId, parsed.data);
    return { success: true };
  });

  // GET /jira/projects — list Jira projects
  app.get("/jira/projects", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const cfg = getJiraConfig(userId);
    if (!cfg) return reply.status(503).send({ error: "Jira not configured (set JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN)" });

    const data = await jiraGet(cfg, "/project/search?maxResults=50").catch(() => null);
    return { success: true, projects: data?.values ?? [] };
  });

  // GET /jira/issues?jql=&maxResults=20 — search issues
  app.get("/jira/issues", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const cfg = getJiraConfig(userId);
    if (!cfg) return reply.status(503).send({ error: "Jira not configured" });

    const { jql = "order by updated DESC", maxResults = "20" } = req.query as Record<string, string>;
    const data = await jiraGet(cfg, `/search?jql=${encodeURIComponent(jql)}&maxResults=${maxResults}&fields=summary,status,priority,assignee,created,updated`).catch(() => null);
    return { success: true, issues: data?.issues ?? [] };
  });

  // POST /jira/issues — create Jira issue
  app.post("/jira/issues", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const cfg = getJiraConfig(userId);
    if (!cfg) return reply.status(503).send({ error: "Jira not configured" });

    const parsed = createIssueSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { title, description, projectId } = parsed.data;
    if (!projectId) return reply.status(400).send({ error: "projectId required for Jira" });

    const issue = await jiraPost(cfg, "/issue", {
      fields: {
        project:   { key: projectId },
        summary:   title,
        issuetype: { name: "Task" },
        description: description ? {
          type:    "doc",
          version: 1,
          content: [{ type: "paragraph", content: [{ type: "text", text: description }] }],
        } : undefined,
      },
    }).catch(e => ({ error: (e as Error).message }));

    return { success: !(issue as any).error, issue };
  });
}
