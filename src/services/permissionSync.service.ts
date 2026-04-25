/**
 * Permission Sync Service — syncs document-level ACLs from source connectors
 * into aibyai's access control system (Memory.accessControlList).
 * Called by the connector sync worker after ingestion.
 *
 * Each connector source has its own permission model:
 * - Confluence: space permissions + page restrictions
 * - Google Drive: file sharing settings + folder permissions
 * - Slack: channel membership (public/private/DM)
 * - GitHub: repo visibility + team access
 * - Notion: page sharing settings
 */

import { randomUUID } from "node:crypto";
import { db } from "../lib/drizzle.js";
import {
  connectorInstances,
  connectorCredentials,
  permissionSyncAttempts,
} from "../db/schema/connectors.js";
import { memories } from "../db/schema/memory.js";
import { users } from "../db/schema/users.js";
import { eq, like, sql } from "drizzle-orm";
import { toAclList } from "../access/models.js";
import logger from "../lib/logger.js";

const log = logger.child({ service: "permissionSync" });

// ─── Public Types ─────────────────────────────────────────────────────────────

export interface DocumentACL {
  documentId: string;
  allowedUserEmails: string[];
  allowedGroupIds: string[];
  isPublic: boolean;
  source: string;
}

// ─── Main Entry Points ────────────────────────────────────────────────────────

/**
 * Sync permissions for all documents belonging to a connector.
 * Fetches ACLs from the source API and upserts them into Memory.accessControlList.
 */
export async function syncConnectorPermissions(
  connectorId: string,
): Promise<{ synced: number; errors: number }> {
  const attemptId = randomUUID();

  await db.insert(permissionSyncAttempts).values({
    id: attemptId,
    connectorId,
    status: "in_progress",
    startedAt: new Date(),
  });

  let synced = 0;
  let errors = 0;

  try {
    const [connector] = await db
      .select()
      .from(connectorInstances)
      .where(eq(connectorInstances.id, connectorId))
      .limit(1);

    if (!connector) {
      throw new Error(`Connector ${connectorId} not found`);
    }

    const [cred] = await db
      .select()
      .from(connectorCredentials)
      .where(eq(connectorCredentials.connectorId, connectorId))
      .limit(1);

    const credentials = (cred?.credentialJson ?? {}) as Record<string, unknown>;
    const settings = connector.settings as Record<string, unknown>;

    // Fetch per-connector ACLs
    const acls = await fetchConnectorACLs(
      connector.source,
      settings,
      credentials,
      connectorId,
    );

    // Upsert ACLs into Memory rows for this connector
    for (const acl of acls) {
      try {
        const aclTokens = toAclList({
          userIds: [],
          groupIds: [],
          externalUserEmails: acl.allowedUserEmails,
          externalUserGroupIds: acl.allowedGroupIds,
          isPublic: acl.isPublic,
        });

        // Update all memory chunks whose sourceName matches this documentId
        await db
          .update(memories)
          .set({ accessControlList: aclTokens })
          .where(like(memories.sourceName, `%${acl.documentId}%`));

        synced++;
      } catch (err) {
        log.warn({ documentId: acl.documentId, err }, "Failed to upsert ACL for document");
        errors++;
      }
    }

    await db
      .update(permissionSyncAttempts)
      .set({
        status: errors > 0 && synced === 0 ? "failed" : "success",
        docsUpdated: synced,
        errorMessage: errors > 0 ? `${errors} document(s) failed` : undefined,
        completedAt: new Date(),
      })
      .where(eq(permissionSyncAttempts.id, attemptId));

    log.info({ connectorId, synced, errors }, "Permission sync complete");
    return { synced, errors };
  } catch (err) {
    await db
      .update(permissionSyncAttempts)
      .set({
        status: "failed",
        errorMessage: (err as Error).message,
        completedAt: new Date(),
      })
      .where(eq(permissionSyncAttempts.id, attemptId));

    log.error({ connectorId, err }, "Permission sync failed");
    throw err;
  }
}

/**
 * Check if a user has access to a document based on synced ACLs.
 */
export async function checkDocumentAccess(
  documentId: string,
  userId: number,
): Promise<boolean> {
  // Fetch the user's email for ext_email token matching
  const [user] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) return false;

  const userTokens = [
    "public",
    `user:${userId}`,
    `ext_email:${user.email.toLowerCase()}`,
  ];

  // Look up any memory chunk for this documentId and check its ACL
  const [chunk] = await db
    .select({ accessControlList: memories.accessControlList })
    .from(memories)
    .where(like(memories.sourceName, `%${documentId}%`))
    .limit(1);

  if (!chunk) return false;

  const acl = (chunk.accessControlList ?? []) as string[];

  // Empty ACL = no access
  if (acl.length === 0) return false;

  return acl.some((token) => userTokens.includes(token));
}

/**
 * Return all document IDs the user can access (for filtering search results).
 */
export async function getAccessibleDocumentIds(
  userId: number,
  tenantId: string,
): Promise<string[]> {
  const [user] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) return [];

  const userTokens = [
    "public",
    `user:${userId}`,
    `ext_email:${user.email.toLowerCase()}`,
    `ext_group:${tenantId}`,
  ];

  // Query memory chunks whose ACL overlaps with the user's tokens
  // Using SQL overlap operator on jsonb array
  const tokenArray = JSON.stringify(userTokens);
  const rows = await db
    .select({ sourceName: memories.sourceName })
    .from(memories)
    .where(
      sql`${memories.accessControlList} ?| array[${sql.raw(
        userTokens.map((t) => `'${t.replace(/'/g, "''")}'`).join(", "),
      )}]`,
    );

  // Extract unique document IDs from sourceName (format: "source:spaceKey:docId" etc.)
  const docIds = new Set<string>();
  for (const row of rows) {
    if (row.sourceName) {
      docIds.add(row.sourceName);
    }
  }

  return [...docIds];
}

// ─── Per-Connector Permission Fetchers ───────────────────────────────────────

async function fetchConnectorACLs(
  source: string,
  settings: Record<string, unknown>,
  credentials: Record<string, unknown>,
  connectorId: string,
): Promise<DocumentACL[]> {
  switch (source) {
    case "confluence":
      return fetchConfluenceACLs(settings, credentials);
    case "google_drive":
      return fetchGoogleDriveACLs(credentials);
    case "slack":
      return fetchSlackACLs(credentials, settings);
    case "github":
      return fetchGitHubACLs(settings, credentials);
    default:
      // Default: tenant-wide access (all docs readable within the tenant)
      log.debug({ source, connectorId }, "No specific permission fetcher — defaulting to tenant-wide access");
      return [];
  }
}

// ─── Confluence ───────────────────────────────────────────────────────────────

async function fetchConfluenceACLs(
  settings: Record<string, unknown>,
  credentials: Record<string, unknown>,
): Promise<DocumentACL[]> {
  const baseUrl = settings.base_url as string | undefined;
  const email = credentials.email as string | undefined;
  const apiToken = credentials.api_token as string | undefined;

  if (!baseUrl || !email || !apiToken) {
    log.warn("Confluence credentials incomplete — skipping permission sync");
    return [];
  }

  const authHeader = `Basic ${Buffer.from(`${email}:${apiToken}`).toString("base64")}`;
  const acls: DocumentACL[] = [];
  const spaceKeys = (settings.space_keys as string[]) ?? [];

  // Fetch space-level permissions for each space
  for (const spaceKey of spaceKeys) {
    try {
      const spaceAcl = await fetchConfluenceSpacePermissions(baseUrl, authHeader, spaceKey);
      acls.push(...spaceAcl);
    } catch (err) {
      log.warn({ spaceKey, err }, "Failed to fetch Confluence space permissions");
    }
  }

  return acls;
}

async function fetchConfluenceSpacePermissions(
  baseUrl: string,
  authHeader: string,
  spaceKey: string,
): Promise<DocumentACL[]> {
  // GET /rest/api/space/{spaceKey}/permission
  const url = `${baseUrl}/wiki/rest/api/space/${encodeURIComponent(spaceKey)}/permission`;
  const resp = await fetch(url, {
    headers: { Authorization: authHeader, Accept: "application/json" },
  });

  if (!resp.ok) {
    log.warn({ spaceKey, status: resp.status }, "Confluence space permissions API error");
    return [];
  }

  const data = (await resp.json()) as {
    permissions?: Array<{
      operation?: { key?: string };
      subjects?: {
        user?: { results?: Array<{ email?: string }> };
        group?: { results?: Array<{ name?: string }> };
      };
      anonymousAccess?: boolean;
    }>;
  };

  const emails: string[] = [];
  const groups: string[] = [];
  let isPublic = false;

  for (const perm of data.permissions ?? []) {
    if (perm.anonymousAccess) {
      isPublic = true;
    }
    for (const user of perm.subjects?.user?.results ?? []) {
      if (user.email) emails.push(user.email);
    }
    for (const group of perm.subjects?.group?.results ?? []) {
      if (group.name) groups.push(`confluence_group:${group.name}`);
    }
  }

  // Also fetch page-level restrictions for the space
  const pageAcls = await fetchConfluencePageRestrictions(baseUrl, authHeader, spaceKey, emails, groups, isPublic);
  return pageAcls;
}

async function fetchConfluencePageRestrictions(
  baseUrl: string,
  authHeader: string,
  spaceKey: string,
  spaceEmails: string[],
  spaceGroups: string[],
  spaceIsPublic: boolean,
): Promise<DocumentACL[]> {
  // Fetch all pages in the space
  const searchUrl = new URL(`${baseUrl}/wiki/rest/api/content/search`);
  searchUrl.searchParams.set("cql", `space="${spaceKey}" AND type=page`);
  searchUrl.searchParams.set("limit", "50");
  searchUrl.searchParams.set("fields", "id,title");

  const resp = await fetch(searchUrl.toString(), {
    headers: { Authorization: authHeader, Accept: "application/json" },
  });

  if (!resp.ok) return [];

  const data = (await resp.json()) as {
    results?: Array<{ id: string; title: string }>;
  };

  const acls: DocumentACL[] = [];

  for (const page of data.results ?? []) {
    try {
      // GET /rest/api/content/{pageId}/restriction
      const restrictUrl = `${baseUrl}/wiki/rest/api/content/${page.id}/restriction/byOperation`;
      const restrictResp = await fetch(restrictUrl, {
        headers: { Authorization: authHeader, Accept: "application/json" },
      });

      if (!restrictResp.ok) {
        // No specific restriction — inherit space permissions
        acls.push({
          documentId: page.id,
          allowedUserEmails: spaceEmails,
          allowedGroupIds: spaceGroups,
          isPublic: spaceIsPublic,
          source: "confluence",
        });
        continue;
      }

      const restrictions = (await restrictResp.json()) as {
        read?: {
          restrictions?: {
            user?: { results?: Array<{ email?: string }> };
            group?: { results?: Array<{ name?: string }> };
          };
        };
      };

      const pageEmails: string[] = [];
      const pageGroups: string[] = [];

      for (const u of restrictions.read?.restrictions?.user?.results ?? []) {
        if (u.email) pageEmails.push(u.email);
      }
      for (const g of restrictions.read?.restrictions?.group?.results ?? []) {
        if (g.name) pageGroups.push(`confluence_group:${g.name}`);
      }

      // If no page-level restrictions, fall back to space-level
      acls.push({
        documentId: page.id,
        allowedUserEmails: pageEmails.length > 0 ? pageEmails : spaceEmails,
        allowedGroupIds: pageGroups.length > 0 ? pageGroups : spaceGroups,
        isPublic: pageEmails.length === 0 && pageGroups.length === 0 ? spaceIsPublic : false,
        source: "confluence",
      });
    } catch (err) {
      log.warn({ pageId: page.id, err }, "Failed to fetch Confluence page restrictions");
      acls.push({
        documentId: page.id,
        allowedUserEmails: spaceEmails,
        allowedGroupIds: spaceGroups,
        isPublic: spaceIsPublic,
        source: "confluence",
      });
    }
  }

  return acls;
}

// ─── Google Drive ─────────────────────────────────────────────────────────────

async function fetchGoogleDriveACLs(
  credentials: Record<string, unknown>,
): Promise<DocumentACL[]> {
  const accessToken = credentials.access_token as string | undefined;
  if (!accessToken) {
    log.warn("Google Drive access_token missing — skipping permission sync");
    return [];
  }

  // List files
  const listResp = await fetch(
    "https://www.googleapis.com/drive/v3/files?pageSize=100&fields=files(id,name)",
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );

  if (!listResp.ok) {
    log.warn({ status: listResp.status }, "Google Drive files list error");
    return [];
  }

  const listData = (await listResp.json()) as {
    files?: Array<{ id: string; name: string }>;
  };

  const acls: DocumentACL[] = [];

  for (const file of listData.files ?? []) {
    try {
      // GET /drive/v3/files/{fileId}/permissions
      const permResp = await fetch(
        `https://www.googleapis.com/drive/v3/files/${file.id}/permissions?fields=permissions(id,type,role,emailAddress,domain,displayName)`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );

      if (!permResp.ok) continue;

      const permData = (await permResp.json()) as {
        permissions?: Array<{
          type: "user" | "group" | "domain" | "anyone";
          role?: string;
          emailAddress?: string;
          domain?: string;
        }>;
      };

      const emails: string[] = [];
      const groups: string[] = [];
      let isPublic = false;

      for (const perm of permData.permissions ?? []) {
        switch (perm.type) {
          case "anyone":
            isPublic = true;
            break;
          case "user":
            if (perm.emailAddress) emails.push(perm.emailAddress);
            break;
          case "group":
            if (perm.emailAddress) groups.push(`gdrive_group:${perm.emailAddress}`);
            break;
          case "domain":
            if (perm.domain) groups.push(`gdrive_domain:${perm.domain}`);
            break;
        }
      }

      acls.push({
        documentId: file.id,
        allowedUserEmails: emails,
        allowedGroupIds: groups,
        isPublic,
        source: "google_drive",
      });
    } catch (err) {
      log.warn({ fileId: file.id, err }, "Failed to fetch Google Drive file permissions");
    }
  }

  return acls;
}

// ─── Slack ────────────────────────────────────────────────────────────────────

async function fetchSlackACLs(
  credentials: Record<string, unknown>,
  settings: Record<string, unknown>,
): Promise<DocumentACL[]> {
  const token = credentials.bot_token as string | undefined;
  if (!token) {
    log.warn("Slack bot_token missing — skipping permission sync");
    return [];
  }

  const configuredChannels = (settings.channels as string[]) ?? [];

  // List all channels or use configured subset
  const channelIds: string[] =
    configuredChannels.length > 0 ? configuredChannels : await listSlackChannels(token);

  const acls: DocumentACL[] = [];

  for (const channelId of channelIds) {
    try {
      // Get channel info to determine public/private
      const infoUrl = new URL("https://slack.com/api/conversations.info");
      infoUrl.searchParams.set("channel", channelId);
      const infoResp = await fetch(infoUrl.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      });

      const infoData = (await infoResp.json()) as {
        ok: boolean;
        channel?: { id: string; is_private?: boolean; is_im?: boolean };
      };

      if (!infoData.ok || !infoData.channel) continue;

      const channel = infoData.channel;
      const isPublic = !channel.is_private && !channel.is_im;

      if (isPublic) {
        acls.push({
          documentId: channelId,
          allowedUserEmails: [],
          allowedGroupIds: [],
          isPublic: true,
          source: "slack",
        });
      } else {
        // Private channel — fetch member list
        const members = await fetchSlackChannelMembers(token, channelId);
        acls.push({
          documentId: channelId,
          allowedUserEmails: [],
          allowedGroupIds: [channelId, ...members.map((m) => `slack_user:${m}`)],
          isPublic: false,
          source: "slack",
        });
      }
    } catch (err) {
      log.warn({ channelId, err }, "Failed to fetch Slack channel permissions");
    }
  }

  return acls;
}

async function listSlackChannels(token: string): Promise<string[]> {
  const url = new URL("https://slack.com/api/conversations.list");
  url.searchParams.set("types", "public_channel,private_channel");
  url.searchParams.set("limit", "200");
  url.searchParams.set("exclude_archived", "true");

  const resp = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

  const data = (await resp.json()) as {
    ok: boolean;
    channels?: Array<{ id: string }>;
  };

  if (!data.ok) return [];
  return (data.channels ?? []).map((c) => c.id);
}

async function fetchSlackChannelMembers(token: string, channelId: string): Promise<string[]> {
  const url = new URL("https://slack.com/api/conversations.members");
  url.searchParams.set("channel", channelId);
  url.searchParams.set("limit", "200");

  const resp = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

  const data = (await resp.json()) as {
    ok: boolean;
    members?: string[];
  };

  if (!data.ok) return [];
  return data.members ?? [];
}

// ─── GitHub ───────────────────────────────────────────────────────────────────

async function fetchGitHubACLs(
  settings: Record<string, unknown>,
  credentials: Record<string, unknown>,
): Promise<DocumentACL[]> {
  const token = credentials.access_token as string | undefined;
  const owner = settings.owner as string | undefined;
  const repo = settings.repo as string | undefined;

  if (!owner || !repo) {
    log.warn("GitHub connector missing owner/repo settings — skipping permission sync");
    return [];
  }

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  // GET /repos/{owner}/{repo} to check visibility
  const repoResp = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers });

  if (!repoResp.ok) {
    log.warn({ status: repoResp.status, owner, repo }, "GitHub repo info error");
    return [];
  }

  const repoData = (await repoResp.json()) as { private: boolean };
  const isPublic = !repoData.private;

  if (isPublic) {
    return [{
      documentId: `${owner}/${repo}`,
      allowedUserEmails: [],
      allowedGroupIds: [],
      isPublic: true,
      source: "github",
    }];
  }

  // Private repo — fetch collaborators
  const collabResp = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/collaborators?per_page=100`,
    { headers },
  );

  const emails: string[] = [];

  if (collabResp.ok) {
    const collabs = (await collabResp.json()) as Array<{ login: string; email?: string }>;
    for (const c of collabs) {
      if (c.email) emails.push(c.email);
    }
  }

  return [{
    documentId: `${owner}/${repo}`,
    allowedUserEmails: emails,
    allowedGroupIds: [`github_repo:${owner}/${repo}`],
    isPublic: false,
    source: "github",
  }];
}
