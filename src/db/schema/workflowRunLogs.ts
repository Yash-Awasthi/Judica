/**
 * Workflow Execution Logs schema — Phase 4.10
 *
 * Step-level event log for workflow runs.
 * Stores node_start/node_complete/node_error events with timing.
 */
import { pgTable, serial, integer, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { users } from "./users.js";

export const workflowRunLogs = pgTable("workflow_run_logs", {
  id:         serial("id").primaryKey(),
  runId:      text("run_id").notNull(),
  workflowId: text("workflow_id").notNull(),
  userId:     integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  nodeId:     text("node_id"),
  nodeType:   text("node_type"),
  /** node_start | node_complete | node_error | human_gate_pending | workflow_complete | workflow_error */
  eventType:  text("event_type").notNull(),
  /** info | success | error | warning */
  status:     text("status").notNull().default("info"),
  message:    text("message"),
  data:       jsonb("data").default({}),
  durationMs: integer("duration_ms"),
  createdAt:  timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("idx_wrl_run_id").on(t.runId),
  index("idx_wrl_user_id").on(t.userId, t.createdAt),
  index("idx_wrl_workflow").on(t.workflowId, t.createdAt),
]);

export type WorkflowRunLog = typeof workflowRunLogs.$inferSelect;
export type NewWorkflowRunLog = typeof workflowRunLogs.$inferInsert;
