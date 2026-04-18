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
    createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { mode: "date" }).notNull(),
    deletedAt: timestamp("deletedAt", { mode: "date" }),
  },
  (table) => [
    index("Project_userId_idx").on(table.userId),
    uniqueIndex("Project_userId_name_key").on(table.userId, table.name),
  ],
);
