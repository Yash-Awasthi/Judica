/**
 * Connector DB Schema — tracks connector instances, credentials, and run history.
 */

import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { users } from "./users.js";

// ─── ConnectorInstance ────────────────────────────────────────────────────────

export const connectorInstances = pgTable(
  "ConnectorInstance",
  {
    id: text("id").primaryKey(),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    settings: jsonb("settings").default({}).notNull(),
    inputType: text("inputType").notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    refreshIntervalMins: integer("refreshIntervalMins").default(60).notNull(),
    lastSyncAt: timestamp("lastSyncAt", { mode: "date", withTimezone: true }),
    nextSyncAt: timestamp("nextSyncAt", { mode: "date", withTimezone: true }),
    createdAt: timestamp("createdAt", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("ConnectorInstance_userId_idx").on(table.userId),
    index("ConnectorInstance_source_idx").on(table.source),
    index("ConnectorInstance_nextSyncAt_idx").on(table.nextSyncAt),
  ],
);

// ─── ConnectorCredential ──────────────────────────────────────────────────────

export const connectorCredentials = pgTable(
  "ConnectorCredential",
  {
    id: text("id").primaryKey(),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    connectorId: text("connectorId")
      .notNull()
      .references(() => connectorInstances.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    /** Encrypted JSON blob — decrypted at runtime via MASTER_ENCRYPTION_KEY. */
    credentialJson: jsonb("credentialJson").default({}).notNull(),
    createdAt: timestamp("createdAt", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("ConnectorCredential_connectorId_idx").on(table.connectorId),
  ],
);

// ─── ConnectorRun ─────────────────────────────────────────────────────────────

export const connectorRuns = pgTable(
  "ConnectorRun",
  {
    id: text("id").primaryKey(),
    connectorId: text("connectorId")
      .notNull()
      .references(() => connectorInstances.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"),
    inputType: text("inputType").notNull(),
    docsProcessed: integer("docsProcessed").default(0).notNull(),
    docsFailed: integer("docsFailed").default(0).notNull(),
    errorMessage: text("errorMessage"),
    checkpointData: jsonb("checkpointData"),
    startedAt: timestamp("startedAt", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completedAt", { mode: "date", withTimezone: true }),
  },
  (table) => [
    index("ConnectorRun_connectorId_idx").on(table.connectorId),
    index("ConnectorRun_status_idx").on(table.status),
  ],
);

// ─── PermissionSyncAttempt ────────────────────────────────────────────────────

export const permissionSyncAttempts = pgTable(
  "PermissionSyncAttempt",
  {
    id: text("id").primaryKey(),
    connectorId: text("connectorId")
      .notNull()
      .references(() => connectorInstances.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"),
    docsUpdated: integer("docsUpdated").default(0).notNull(),
    errorMessage: text("errorMessage"),
    startedAt: timestamp("startedAt", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completedAt", { mode: "date", withTimezone: true }),
  },
  (table) => [
    index("PermSyncAttempt_connectorId_idx").on(table.connectorId),
  ],
);
