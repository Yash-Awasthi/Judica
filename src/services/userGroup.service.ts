/**
 * User Groups — Service
 */

import { db } from "../lib/drizzle.js";
import { userGroups, userGroupMembers, userGroupPermissions } from "../db/schema/userGroups.js";
import { eq, and } from "drizzle-orm";

export async function createGroup(
  name: string,
  description: string | undefined,
  isPublic: boolean,
  createdBy: number,
): Promise<{ id: number }> {
  const [group] = await db.insert(userGroups).values({
    name,
    description,
    isPublic,
    createdBy,
    updatedAt: new Date(),
  }).returning();
  // Auto-add creator as admin
  await db.insert(userGroupMembers).values({
    groupId: group.id,
    userId: createdBy,
    role: "admin",
  });
  return { id: group.id };
}

export async function listGroups(userId: number) {
  // Return groups the user belongs to + public groups
  const allGroups = await db.select().from(userGroups);
  const memberships = await db.select().from(userGroupMembers).where(eq(userGroupMembers.userId, userId));
  const memberGroupIds = new Set(memberships.map((m) => m.groupId));

  return allGroups
    .filter((g) => g.isPublic || memberGroupIds.has(g.id))
    .map((g) => ({
      ...g,
      isMember: memberGroupIds.has(g.id),
      role: memberships.find((m) => m.groupId === g.id)?.role,
    }));
}

export async function getGroup(groupId: number) {
  const [group] = await db.select().from(userGroups).where(eq(userGroups.id, groupId)).limit(1);
  if (!group) return null;

  const members = await db.select().from(userGroupMembers).where(eq(userGroupMembers.groupId, groupId));
  const permissions = await db.select().from(userGroupPermissions).where(eq(userGroupPermissions.groupId, groupId));

  return { ...group, members, permissions };
}

export async function updateGroup(
  groupId: number,
  data: Partial<{ name: string; description: string; isPublic: boolean }>,
) {
  await db.update(userGroups).set({ ...data, updatedAt: new Date() }).where(eq(userGroups.id, groupId));
}

export async function deleteGroup(groupId: number) {
  await db.delete(userGroups).where(eq(userGroups.id, groupId));
}

export async function addMember(groupId: number, userId: number, role: "member" | "curator" | "admin" = "member") {
  await db.insert(userGroupMembers).values({ groupId, userId, role }).onConflictDoUpdate({
    target: [userGroupMembers.groupId, userGroupMembers.userId],
    set: { role },
  });
}

export async function removeMember(groupId: number, userId: number) {
  await db.delete(userGroupMembers).where(and(eq(userGroupMembers.groupId, groupId), eq(userGroupMembers.userId, userId)));
}

export async function setGroupPermission(
  groupId: number,
  resourceType: "document_set" | "persona" | "knowledge_base" | "connector",
  resourceId: string,
  permission: "read" | "write" | "admin",
) {
  await db.insert(userGroupPermissions).values({ groupId, resourceType, resourceId, permission }).onConflictDoUpdate({
    target: [userGroupPermissions.groupId, userGroupPermissions.resourceType, userGroupPermissions.resourceId],
    set: { permission },
  });
}

export async function getUserGroups(userId: number) {
  const memberships = await db.select().from(userGroupMembers).where(eq(userGroupMembers.userId, userId));
  const groupIds = memberships.map((m) => m.groupId);
  if (groupIds.length === 0) return [];
  const groups = await db.select().from(userGroups);
  return groups.filter((g) => groupIds.includes(g.id));
}

export async function checkGroupAccess(
  userId: number,
  resourceType: "document_set" | "persona" | "knowledge_base" | "connector",
  resourceId: string,
  requiredPermission: "read" | "write" | "admin" = "read",
): Promise<boolean> {
  const memberships = await db.select().from(userGroupMembers).where(eq(userGroupMembers.userId, userId));
  if (memberships.length === 0) return false;

  const permissionLevel = { read: 0, write: 1, admin: 2 };

  for (const m of memberships) {
    const [perm] = await db.select().from(userGroupPermissions).where(
      and(
        eq(userGroupPermissions.groupId, m.groupId),
        eq(userGroupPermissions.resourceType, resourceType),
        eq(userGroupPermissions.resourceId, resourceId),
      ),
    ).limit(1);

    if (perm && permissionLevel[perm.permission] >= permissionLevel[requiredPermission]) {
      return true;
    }
  }

  return false;
}
