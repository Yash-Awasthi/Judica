import {
  pgTable,
  serial,
  text,
  timestamp,
  jsonb,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { users } from "./users.js";

// ─── AdminAuditLog ───────────────────────────────────────────────────────────
// Tracks sensitive administrative actions for security and oversight.
export const adminAuditLogs = pgTable(
  "AdminAuditLog",
  {
    id: serial("id").primaryKey(),
    adminId: integer("adminId")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    actionType: text("actionType").notNull(), // e.g., 'user_suspend', 'config_update', 'key_rotation'
    resourceType: text("resourceType").notNull(), // e.g., 'user', 'system_config', 'api_provider'
    resourceId: text("resourceId"), // The ID of the affected resource
    details: jsonb("details").default({}).notNull(), // JSON representation of changes { old: ..., new: ... }
    status: text("status").default("success").notNull(), // 'success', 'failure'
    errorMessage: text("errorMessage"),
    // P60-05: Contains PII — subject to data-retention / GDPR right-to-erasure policies
    ipAddress: text("ipAddress"),
    createdAt: timestamp("createdAt", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("AdminAuditLog_adminId_idx").on(table.adminId),
    index("AdminAuditLog_actionType_idx").on(table.actionType),
    index("AdminAuditLog_createdAt_idx").on(table.createdAt),
    index("AdminAuditLog_resource_idx").on(table.resourceType, table.resourceId),
  ],
);

// ─── SystemConfig ─────────────────────────────────────────────────────────────
// Stores global system settings (e.g., default models, rate limits, feature flags).
export const systemConfigs = pgTable(
  "SystemConfig",
  {
    id: serial("id").primaryKey(),
    key: text("key").notNull().unique(), // e.g., 'default_llm_model', 'maintenance_mode'
    value: jsonb("value").default({}).notNull(),
    description: text("description"),
    updatedAt: timestamp("updatedAt", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    updatedBy: integer("updatedBy").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (table) => [uniqueIndex("SystemConfig_key_idx").on(table.key)],
);

// P8-44: OrgGroup system is defined here but not enforced in application routes.
// Either add orgIsolation middleware to all data routes (conversations, chats, usage)
// or remove these tables. Current state: partially implemented via admin.service.ts.
// Decision: KEEP — wire up org isolation via middleware/orgIsolation.ts.

// ─── OrgGroup ──────────────────────────────────────────────────────────────────
export const orgGroups = pgTable(
  "OrgGroup",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull().unique(),
    description: text("description"),
    createdAt: timestamp("createdAt", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    createdBy: integer("createdBy").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (table) => [uniqueIndex("OrgGroup_name_idx").on(table.name)],
);

// ─── OrgGroupMembership ────────────────────────────────────────────────────────
export const orgGroupMemberships = pgTable(
  "OrgGroupMembership",
  {
    id: serial("id").primaryKey(),
    groupId: integer("groupId")
      .notNull()
      .references(() => orgGroups.id, { onDelete: "cascade" }),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").default("member").notNull(), // 'owner', 'admin', 'member'
    joinedAt: timestamp("joinedAt", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("OrgGroupMembership_groupId_userId_key").on(
      table.groupId,
      table.userId,
    ),
  ],
);
