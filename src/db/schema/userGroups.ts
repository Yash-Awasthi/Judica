/**
 * User Groups — Database Schema
 *
 * Group-based access control with curator roles.
 * Modeled after Onyx's user groups system.
 */

import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  boolean,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { users } from "./users.js";

export const userGroups = pgTable("UserGroup", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  /** Whether this group is visible to non-members. */
  isPublic: boolean("isPublic").notNull().default(false),
  /** Creator user ID. */
  createdBy: integer("createdBy").notNull().references(() => users.id),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("idx_user_groups_name").on(table.name),
]);

export const userGroupMembers = pgTable("UserGroupMember", {
  id: serial("id").primaryKey(),
  groupId: integer("groupId").notNull().references(() => userGroups.id, { onDelete: "cascade" }),
  userId: integer("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** Role within the group. */
  role: text("role").$type<"member" | "curator" | "admin">().notNull().default("member"),
  joinedAt: timestamp("joinedAt").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("idx_group_members_unique").on(table.groupId, table.userId),
  index("idx_group_members_user").on(table.userId),
]);

export const userGroupPermissions = pgTable("UserGroupPermission", {
  id: serial("id").primaryKey(),
  groupId: integer("groupId").notNull().references(() => userGroups.id, { onDelete: "cascade" }),
  /** Resource type this permission applies to. */
  resourceType: text("resourceType").$type<"document_set" | "persona" | "knowledge_base" | "connector">().notNull(),
  /** Resource ID. */
  resourceId: text("resourceId").notNull(),
  /** Permission level. */
  permission: text("permission").$type<"read" | "write" | "admin">().notNull().default("read"),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
}, (table) => [
  index("idx_group_permissions_group").on(table.groupId),
  uniqueIndex("idx_group_permissions_unique").on(table.groupId, table.resourceType, table.resourceId),
]);
