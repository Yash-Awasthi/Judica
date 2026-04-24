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

// ─── Workflow ────────────────────────────────────────────────────────────────
export const workflows = pgTable(
  "Workflow",
  {
    id: text("id").primaryKey(),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    definition: jsonb("definition").notNull(),
    version: integer("version").default(1).notNull(),
    published: boolean("published").default(false).notNull(),
    createdAt: timestamp("createdAt", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    // Add defaultNow to prevent insert failures when updatedAt is omitted
    updatedAt: timestamp("updatedAt", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("Workflow_userId_createdAt_idx").on(table.userId, table.createdAt),
  ],
);

// ─── WorkflowRun ─────────────────────────────────────────────────────────────
export const workflowRuns = pgTable(
  "WorkflowRun",
  {
    id: text("id").primaryKey(),
    workflowId: text("workflowId")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status").default("pending").notNull(),
    inputs: jsonb("inputs").notNull(),
    outputs: jsonb("outputs"),
    error: text("error"),
    startedAt: timestamp("startedAt", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    endedAt: timestamp("endedAt", { mode: "date", withTimezone: true }),
  },
  (table) => [
    index("WorkflowRun_workflowId_startedAt_idx").on(
      table.workflowId,
      table.startedAt,
    ),
    index("WorkflowRun_userId_startedAt_idx").on(
      table.userId,
      table.startedAt,
    ),
    index("WorkflowRun_status_startedAt_idx").on(
      table.status,
      table.startedAt,
    ),
  ],
);
