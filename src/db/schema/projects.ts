import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { users } from "./users.js";

export const projects = pgTable(
  "Project",
  {
    id: text("id").primaryKey(), // Using UUID for consistency with conversations
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    color: text("color"),
    icon: text("icon"),
    defaultCouncilComposition: jsonb("defaultCouncilComposition"),
    defaultSystemPrompt: text("defaultSystemPrompt"),
    createdAt: timestamp("createdAt", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    // P60-02: Add defaultNow to prevent insert failures when updatedAt is omitted
    updatedAt: timestamp("updatedAt", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deletedAt", { mode: "date", withTimezone: true }),
  },
  (table) => [
    index("Project_userId_idx").on(table.userId),
    uniqueIndex("Project_userId_name_key").on(table.userId, table.name),
  ],
);
