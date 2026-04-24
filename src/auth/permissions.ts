/**
 * Granular Permission System — implication-based RBAC.
 *
 * Modeled after Onyx's 19-permission system where:
 * - MANAGE_* implies ADD_* + READ_*
 * - FULL_ADMIN_PANEL_ACCESS grants all permissions
 * - Only direct grants are stored; implied permissions expanded at read time
 * - READ_* permissions are always derived, never stored directly
 */

// ─── Permission Enum ──────────────────────────────────────────────────────────

export enum Permission {
  BASIC_ACCESS = "basic",

  // Read permissions (always implied, never stored directly)
  READ_CONNECTORS = "read:connectors",
  READ_DOCUMENT_SETS = "read:document_sets",
  READ_AGENTS = "read:agents",
  READ_USERS = "read:users",
  READ_KNOWLEDGE_BASES = "read:knowledge_bases",

  // Add permissions
  ADD_AGENTS = "add:agents",
  ADD_CONNECTORS = "add:connectors",

  // Manage permissions (imply ADD + READ)
  MANAGE_AGENTS = "manage:agents",
  MANAGE_CONNECTORS = "manage:connectors",
  MANAGE_DOCUMENT_SETS = "manage:document_sets",
  MANAGE_KNOWLEDGE_BASES = "manage:knowledge_bases",
  MANAGE_LLMS = "manage:llms",
  MANAGE_USERS = "manage:users",
  MANAGE_WORKFLOWS = "manage:workflows",

  // Analytics & history
  READ_AGENT_ANALYTICS = "read:agent_analytics",
  READ_QUERY_HISTORY = "read:query_history",
  READ_COSTS = "read:costs",

  // API access
  CREATE_USER_API_KEYS = "create:user_api_keys",
  CREATE_SERVICE_ACCOUNT_API_KEYS = "create:service_account_api_keys",

  // Full admin
  FULL_ADMIN_PANEL_ACCESS = "admin",
}

// ─── Implication Map ──────────────────────────────────────────────────────────

/**
 * Permission implications: key implies all values.
 * Only MANAGE_* and FULL_ADMIN imply other permissions.
 */
const PERMISSION_IMPLICATIONS: Partial<Record<Permission, Permission[]>> = {
  [Permission.MANAGE_AGENTS]: [
    Permission.ADD_AGENTS,
    Permission.READ_AGENTS,
  ],
  [Permission.MANAGE_CONNECTORS]: [
    Permission.ADD_CONNECTORS,
    Permission.READ_CONNECTORS,
  ],
  [Permission.MANAGE_DOCUMENT_SETS]: [
    Permission.READ_DOCUMENT_SETS,
    Permission.READ_CONNECTORS,
  ],
  [Permission.MANAGE_KNOWLEDGE_BASES]: [
    Permission.READ_KNOWLEDGE_BASES,
  ],
  [Permission.MANAGE_USERS]: [
    Permission.READ_USERS,
  ],
  [Permission.FULL_ADMIN_PANEL_ACCESS]: Object.values(Permission),
};

// ─── Permission Resolution ────────────────────────────────────────────────────

/**
 * Expand direct grants to include all implied permissions.
 * Iterates until no new permissions are added (handles transitive implications).
 */
export function resolveEffectivePermissions(
  directGrants: Set<Permission>,
): Set<Permission> {
  const effective = new Set(directGrants);
  effective.add(Permission.BASIC_ACCESS); // Always granted

  let changed = true;
  while (changed) {
    changed = false;
    for (const perm of effective) {
      const implied = PERMISSION_IMPLICATIONS[perm];
      if (implied) {
        for (const imp of implied) {
          if (!effective.has(imp)) {
            effective.add(imp);
            changed = true;
          }
        }
      }
    }
  }

  return effective;
}

/**
 * Get effective permissions for a user from their stored direct grants.
 * The `directPermissions` field is stored as a jsonb array on the User table.
 */
export function getEffectivePermissions(
  directPermissions: string[],
): Set<Permission> {
  const grants = new Set<Permission>();
  for (const p of directPermissions) {
    if (Object.values(Permission).includes(p as Permission)) {
      grants.add(p as Permission);
    }
  }
  return resolveEffectivePermissions(grants);
}

/**
 * Check if a user has a specific permission.
 */
export function hasPermission(
  effectivePermissions: Set<Permission>,
  required: Permission,
): boolean {
  return effectivePermissions.has(required);
}

// ─── Non-Toggleable Permissions ───────────────────────────────────────────────

/**
 * Permissions that cannot be assigned via group/user API.
 * BASIC_ACCESS is always granted; FULL_ADMIN is too broad for group assignment;
 * READ_* are always derived from MANAGE_*.
 */
export const NON_TOGGLEABLE_PERMISSIONS = new Set<Permission>([
  Permission.BASIC_ACCESS,
  Permission.FULL_ADMIN_PANEL_ACCESS,
  Permission.READ_CONNECTORS,
  Permission.READ_DOCUMENT_SETS,
  Permission.READ_AGENTS,
  Permission.READ_USERS,
  Permission.READ_KNOWLEDGE_BASES,
]);

/**
 * List permissions available for assignment via the admin API.
 */
export function getAssignablePermissions(): Permission[] {
  return Object.values(Permission).filter(
    (p) => !NON_TOGGLEABLE_PERMISSIONS.has(p),
  );
}
