/**
 * Task Graph — Phase 4.1
 *
 * Build tab tasks with claiming + locking and subtask breakdown.
 * Any council member can claim a task. Once claimed, it's locked.
 * The claiming agent breaks it into subtasks, which become claimable.
 *
 * Inspired by:
 * - CrewAI (MIT, crewAIInc/crewAI, 27k stars) — task delegation with agent claiming
 *   and hierarchical subtask breakdown
 * - Taskade — AI-powered task graphs with agent assignment
 */

import { pgTable, serial, integer, text, jsonb, boolean, timestamp, index } from "drizzle-orm/pg-core";

export const buildTasks = pgTable("build_tasks", {
  id:             serial("id").primaryKey(),
  userId:         integer("user_id").notNull(),
  conversationId: text("conversation_id"),
  parentId:       integer("parent_id"),       // null = root task, non-null = subtask
  title:          text("title").notNull(),
  description:    text("description"),
  /** status: planned | claimed | in_progress | review | done | blocked */
  status:         text("status").notNull().default("planned"),
  /** The council member archetype that claimed this task */
  claimedBy:      text("claimed_by"),
  claimedAt:      timestamp("claimed_at"),
  /** Submitted output/deliverable text */
  output:         text("output"),
  submittedAt:    timestamp("submitted_at"),
  /** Whether this task is locked (claimed) */
  isLocked:       boolean("is_locked").notNull().default(false),
  meta:           jsonb("meta").default({}),
  createdAt:      timestamp("created_at").defaultNow().notNull(),
  updatedAt:      timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  userIdx:   index("idx_build_tasks_user_id").on(t.userId),
  parentIdx: index("idx_build_tasks_parent_id").on(t.parentId),
  statusIdx: index("idx_build_tasks_status").on(t.userId, t.status),
}));
