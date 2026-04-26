/**
 * Connector Sync DB Schema — sync jobs and schedules for Load/Poll/Slim modes.
 *
 * Phase 3.9: Three sync modes per connector keep the knowledge base current
 * without thrashing:
 *   - Load: full bulk index on demand
 *   - Poll: incremental time-range updates
 *   - Slim: lightweight pruning check (removes deleted docs without re-indexing)
 */

import {
  pgTable,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { users } from "./users.js";

// ─── ConnectorSyncJob ────────────────────────────────────────────────────────

export const connectorSyncJobs = pgTable(
  "ConnectorSyncJob",
  {
    id: text("id").primaryKey(),
    connectorId: text("connectorId").notNull(),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Sync mode: load (full), poll (incremental), slim (prune check). */
    syncMode: text("syncMode").notNull(),
    /** Job status: pending → running → completed | failed. */
    status: text("status").notNull().default("pending"),
    startedAt: timestamp("startedAt", { mode: "date", withTimezone: true }),
    completedAt: timestamp("completedAt", { mode: "date", withTimezone: true }),
    documentsProcessed: integer("documentsProcessed").default(0).notNull(),
    documentsDeleted: integer("documentsDeleted").default(0).notNull(),
    errorMessage: text("errorMessage"),
    /** Checkpoint data for resumable syncs. */
    checkpoint: jsonb("checkpoint"),
    createdAt: timestamp("createdAt", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("ConnectorSyncJob_connectorId_idx").on(table.connectorId),
    index("ConnectorSyncJob_userId_idx").on(table.userId),
    index("ConnectorSyncJob_status_idx").on(table.status),
  ],
);

// ─── ConnectorSyncSchedule ───────────────────────────────────────────────────

export const connectorSyncSchedules = pgTable(
  "ConnectorSyncSchedule",
  {
    id: text("id").primaryKey(),
    connectorId: text("connectorId").notNull(),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Sync mode this schedule triggers. */
    syncMode: text("syncMode").notNull(),
    /** Cron expression (e.g. "0 *\/6 * * *" for every 6 hours). */
    cronExpression: text("cronExpression").notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    lastRunAt: timestamp("lastRunAt", { mode: "date", withTimezone: true }),
    nextRunAt: timestamp("nextRunAt", { mode: "date", withTimezone: true }),
    createdAt: timestamp("createdAt", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("ConnectorSyncSchedule_connectorId_idx").on(table.connectorId),
    index("ConnectorSyncSchedule_userId_idx").on(table.userId),
  ],
);
