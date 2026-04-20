import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { users } from "./users.js";

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
    conversationId: text("conversationId"),
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
