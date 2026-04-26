/**
 * Agent Action Audit Log schema — Phase 4.19
 *
 * Per-agent-action audit trail (Agno pattern).
 * Tracks every meaningful action taken by a council agent.
 */
import { pgTable, serial, integer, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { users } from "./users.js";

export const agentActionLogs = pgTable("agent_action_logs", {
  id:         serial("id").primaryKey(),
  userId:     integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  agentId:    text("agent_id").notNull(),
  /** claim_task | release_task | submit_task | review | steal | llm_call | kg_extract | workflow_trigger | … */
  action:     text("action").notNull(),
  entityType: text("entity_type"),
  entityId:   text("entity_id"),
  meta:       jsonb("meta").default({}),
  durationMs: integer("duration_ms"),
  /** success | error | skipped */
  status:     text("status").notNull().default("success"),
  error:      text("error"),
  createdAt:  timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("idx_aal_user_id").on(t.userId, t.createdAt),
  index("idx_aal_agent_id").on(t.agentId, t.createdAt),
  index("idx_aal_action").on(t.action, t.createdAt),
]);

export type AgentActionLog = typeof agentActionLogs.$inferSelect;
export type NewAgentActionLog = typeof agentActionLogs.$inferInsert;
