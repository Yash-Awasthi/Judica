/**
 * Document Access Control — ACL models and enforcement.
 *
 * Modeled after Onyx's access control system:
 * - ExternalAccess tracks source-level permissions (emails, groups, public)
 * - DocumentAccess combines internal + external permissions
 * - ACL enforcement happens at the SQL/vector query level, not post-filtering
 */

// ─── External Access (from source systems) ───────────────────────────────────

export interface ExternalAccess {
  /** Email addresses with direct access. */
  externalUserEmails: string[];
  /** Group IDs with access (from source system). */
  externalUserGroupIds: string[];
  /** Whether the document is publicly accessible. */
  isPublic: boolean;
}

export const PUBLIC_ACCESS: ExternalAccess = {
  externalUserEmails: [],
  externalUserGroupIds: [],
  isPublic: true,
};

export const EMPTY_ACCESS: ExternalAccess = {
  externalUserEmails: [],
  externalUserGroupIds: [],
  isPublic: false,
};

// ─── Document Access (internal + external) ───────────────────────────────────

export interface DocumentAccess extends ExternalAccess {
  /** Internal user IDs with access. */
  userIds: number[];
  /** Internal group/team IDs with access. */
  groupIds: string[];
}

/**
 * Convert a DocumentAccess to a flat ACL string array for storage.
 * Format:
 *   "user:<userId>" for internal users
 *   "group:<groupId>" for internal groups
 *   "ext_email:<email>" for external emails
 *   "ext_group:<groupId>" for external groups
 *   "public" if publicly accessible
 */
export function toAclList(access: DocumentAccess): string[] {
  const acl: string[] = [];

  if (access.isPublic) {
    acl.push("public");
  }

  for (const uid of access.userIds) {
    acl.push(`user:${uid}`);
  }
  for (const gid of access.groupIds) {
    acl.push(`group:${gid}`);
  }
  for (const email of access.externalUserEmails) {
    acl.push(`ext_email:${email.toLowerCase()}`);
  }
  for (const gid of access.externalUserGroupIds) {
    acl.push(`ext_group:${gid}`);
  }

  return acl;
}

/**
 * Build ACL tokens for a requesting user.
 * These tokens are matched against the document's ACL list.
 */
export function buildUserAclTokens(
  userId: number,
  email?: string,
  groupIds?: string[],
  externalGroupIds?: string[],
): string[] {
  const tokens: string[] = [
    "public",
    `user:${userId}`,
  ];

  if (email) {
    tokens.push(`ext_email:${email.toLowerCase()}`);
  }

  if (groupIds) {
    for (const gid of groupIds) {
      tokens.push(`group:${gid}`);
    }
  }

  if (externalGroupIds) {
    for (const gid of externalGroupIds) {
      tokens.push(`ext_group:${gid}`);
    }
  }

  return tokens;
}

// ─── Per-Document ACL Entry ──────────────────────────────────────────────────

export interface DocExternalAccess {
  docId: string;
  externalAccess: ExternalAccess;
}

// ─── Document Set ────────────────────────────────────────────────────────────

export interface DocumentSet {
  id: string;
  name: string;
  description?: string;
  /** User IDs who can access documents in this set. */
  memberUserIds: number[];
  /** Group IDs who can access documents in this set. */
  memberGroupIds: string[];
}
