import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { conversations } from "./conversations.js";

// ─── ResearchJob ─────────────────────────────────────────────────────────────
export const researchJobs = pgTable(
  "ResearchJob",
  {
    id: text("id").primaryKey(),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    query: text("query").notNull(),
    status: text("status").default("pending").notNull(),
    steps: jsonb("steps").default([]).notNull(),
    report: text("report"),
    createdAt: timestamp("createdAt", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { mode: "date", withTimezone: true }).notNull(),
  },
  (table) => [
    index("ResearchJob_userId_createdAt_idx").on(
      table.userId,
      table.createdAt,
    ),
    // P56-09: Index for filtering jobs by status per user
    index("ResearchJob_userId_status_idx").on(table.userId, table.status),
  ],
);

// ─── Artifact ────────────────────────────────────────────────────────────────
export const artifacts = pgTable(
  "Artifact",
  {
    id: text("id").primaryKey(),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // P56-01: Add FK constraint to prevent orphaned artifacts
    conversationId: text("conversationId").references(() => conversations.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    type: text("type").notNull(),
    content: text("content").notNull(),
    language: text("language"),
    createdAt: timestamp("createdAt", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { mode: "date", withTimezone: true }).notNull(),
  },
  (table) => [
    index("Artifact_userId_createdAt_idx").on(table.userId, table.createdAt),
    index("Artifact_conversationId_idx").on(table.conversationId),
  ],
);
