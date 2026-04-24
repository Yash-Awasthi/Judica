/**
 * SCIM 2.0 Service — handles user and group provisioning from identity providers.
 *
 * Implements RFC 7643 (SCIM Core Schema) and RFC 7644 (SCIM Protocol)
 * for automated user lifecycle management from Okta, Azure AD, OneLogin, etc.
 */

import { db } from "../lib/drizzle.js";
import { users } from "../db/schema/users.js";
import { scimSyncLog } from "../db/schema/scim.js";
import { eq, and } from "drizzle-orm";
import logger from "../lib/logger.js";

const log = logger.child({ service: "scim" });

// ─── SCIM Resource Types ─────────────────────────────────────────────────────

export interface ScimUser {
  schemas: string[];
  id?: string;
  externalId?: string;
  userName: string;
  name?: { givenName?: string; familyName?: string; formatted?: string };
  emails?: Array<{ value: string; primary?: boolean; type?: string }>;
  displayName?: string;
  active?: boolean;
  groups?: Array<{ value: string; display?: string }>;
  meta?: { resourceType: string; created?: string; lastModified?: string; location?: string };
}

export interface ScimGroup {
  schemas: string[];
  id?: string;
  externalId?: string;
  displayName: string;
  members?: Array<{ value: string; display?: string }>;
  meta?: { resourceType: string; created?: string; lastModified?: string; location?: string };
}

export interface ScimListResponse<T> {
  schemas: string[];
  totalResults: number;
  startIndex: number;
  itemsPerPage: number;
  Resources: T[];
}

export interface ScimPatchOp {
  schemas: string[];
  Operations: Array<{
    op: "add" | "remove" | "replace";
    path?: string;
    value?: unknown;
  }>;
}

export interface ScimError {
  schemas: string[];
  status: string;
  detail: string;
}

// ─── User Operations ─────────────────────────────────────────────────────────

export async function scimCreateUser(scimUser: ScimUser): Promise<ScimUser> {
  const email = scimUser.emails?.find((e) => e.primary)?.value ?? scimUser.userName;
  const displayName = scimUser.displayName ?? scimUser.name?.formatted ?? `${scimUser.name?.givenName ?? ""} ${scimUser.name?.familyName ?? ""}`.trim();

  try {
    const [created] = await db
      .insert(users)
      .values({
        email,
        displayName,
        externalId: scimUser.externalId ?? null,
        isActive: scimUser.active !== false,
        provider: "scim",
      })
      .returning();

    await logScimOp("Users", "CREATE", scimUser.externalId, created.id, true);
    log.info({ userId: created.id, email }, "SCIM user created");

    return toScimUser(created);
  } catch (err) {
    await logScimOp("Users", "CREATE", scimUser.externalId, null, false, (err as Error).message);
    throw err;
  }
}

export async function scimGetUser(userId: number): Promise<ScimUser | null> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return user ? toScimUser(user) : null;
}

export async function scimListUsers(
  startIndex = 1,
  count = 100,
  filter?: string,
): Promise<ScimListResponse<ScimUser>> {
  // Parse basic SCIM filter: userName eq "value" or externalId eq "value"
  let query = db.select().from(users);

  if (filter) {
    const match = filter.match(/^(\w+)\s+eq\s+"([^"]+)"$/);
    if (match) {
      const [, attr, value] = match;
      if (attr === "userName" || attr === "email") {
        query = query.where(eq(users.email, value)) as typeof query;
      } else if (attr === "externalId") {
        query = query.where(eq(users.externalId, value)) as typeof query;
      }
    }
  }

  const allUsers = await query.limit(count).offset(startIndex - 1);

  return {
    schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
    totalResults: allUsers.length,
    startIndex,
    itemsPerPage: count,
    Resources: allUsers.map(toScimUser),
  };
}

export async function scimUpdateUser(userId: number, scimUser: ScimUser): Promise<ScimUser> {
  const email = scimUser.emails?.find((e) => e.primary)?.value ?? scimUser.userName;
  const displayName = scimUser.displayName ?? scimUser.name?.formatted ?? "";

  try {
    const [updated] = await db
      .update(users)
      .set({
        email,
        displayName,
        externalId: scimUser.externalId ?? undefined,
        isActive: scimUser.active !== false,
      })
      .where(eq(users.id, userId))
      .returning();

    await logScimOp("Users", "UPDATE", scimUser.externalId, userId, true);
    log.info({ userId, email }, "SCIM user updated");

    return toScimUser(updated);
  } catch (err) {
    await logScimOp("Users", "UPDATE", scimUser.externalId, userId, false, (err as Error).message);
    throw err;
  }
}

export async function scimPatchUser(userId: number, patchOp: ScimPatchOp): Promise<ScimUser> {
  const updates: Record<string, unknown> = {};

  for (const op of patchOp.Operations) {
    if (op.op === "replace") {
      if (op.path === "active" || !op.path) {
        const val = op.path ? op.value : (op.value as Record<string, unknown>);
        if (typeof val === "boolean") updates.isActive = val;
        else if (typeof val === "object" && val !== null && "active" in val) updates.isActive = (val as Record<string, unknown>).active;
      }
      if (op.path === "displayName") updates.displayName = op.value as string;
      if (op.path === "userName" || op.path === "emails[type eq \"work\"].value") {
        updates.email = op.value as string;
      }
    }
  }

  if (Object.keys(updates).length > 0) {
    await db.update(users).set(updates).where(eq(users.id, userId));
  }

  await logScimOp("Users", "PATCH", null, userId, true);
  log.info({ userId, ops: patchOp.Operations.length }, "SCIM user patched");

  return (await scimGetUser(userId))!;
}

export async function scimDeleteUser(userId: number): Promise<void> {
  // Soft-delete: deactivate rather than remove
  await db.update(users).set({ isActive: false }).where(eq(users.id, userId));
  await logScimOp("Users", "DELETE", null, userId, true);
  log.info({ userId }, "SCIM user deactivated");
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toScimUser(user: Record<string, unknown>): ScimUser {
  const email = user.email as string;
  const displayName = (user.displayName as string) ?? email;
  const parts = displayName.split(" ");

  return {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
    id: String(user.id),
    externalId: (user.externalId as string) ?? undefined,
    userName: email,
    name: {
      givenName: parts[0] ?? "",
      familyName: parts.slice(1).join(" ") ?? "",
      formatted: displayName,
    },
    emails: [{ value: email, primary: true, type: "work" }],
    displayName,
    active: (user.isActive as boolean) ?? true,
    meta: {
      resourceType: "User",
      created: (user.createdAt as Date)?.toISOString(),
      lastModified: (user.updatedAt as Date)?.toISOString?.(),
    },
  };
}

async function logScimOp(
  resourceType: string,
  operation: string,
  externalId: string | null | undefined,
  localId: number | null,
  success: boolean,
  errorMessage?: string,
): Promise<void> {
  try {
    await db.insert(scimSyncLog).values({
      resourceType,
      operation,
      externalId: externalId ?? null,
      localId,
      success,
      errorMessage: errorMessage ?? null,
    });
  } catch {
    // Don't fail the main operation if audit logging fails
  }
}

// ─── SCIM Error Builder ──────────────────────────────────────────────────────

export function scimError(status: number, detail: string): ScimError {
  return {
    schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
    status: String(status),
    detail,
  };
}
