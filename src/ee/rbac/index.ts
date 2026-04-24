/**
 * EE RBAC — advanced permission features for Enterprise Edition.
 * Extends the core granular RBAC with user groups and SCIM.
 */

import { requireEE } from "../../config/edition.js";

// ─── User Groups ──────────────────────────────────────────────────────────────

export interface UserGroup {
  id: string;
  name: string;
  description?: string;
  tenantId: string;
  permissions: string[];
  memberIds: number[];
  createdAt: Date;
}

export async function createUserGroup(_group: Omit<UserGroup, "id" | "createdAt">): Promise<UserGroup> {
  requireEE("User Groups");
  throw new Error("Not yet implemented");
}

export async function updateUserGroupPermissions(
  _groupId: string,
  _permissions: string[],
): Promise<void> {
  requireEE("User Groups");
}

// ─── SCIM 2.0 ─────────────────────────────────────────────────────────────────

export interface SCIMUser {
  schemas: string[];
  id: string;
  userName: string;
  name: { givenName: string; familyName: string };
  emails: Array<{ value: string; primary: boolean }>;
  active: boolean;
}

export interface SCIMGroup {
  schemas: string[];
  id: string;
  displayName: string;
  members: Array<{ value: string; display: string }>;
}

export async function handleSCIMUserRequest(
  _method: string,
  _path: string,
  _body?: unknown,
): Promise<unknown> {
  requireEE("SCIM 2.0 Provisioning");
  return null;
}
