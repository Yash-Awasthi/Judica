import {
  pgTable,
  text,
  timestamp,
  integer,
  boolean,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { prompts } from "./prompts.js";
import { users } from "./users.js";

// Extended prompt version history with rollback support.
// The base promptVersions table in prompts.ts tracks content/model/temperature.
// This table adds authorship, change notes, system prompt field, and active flag.
export const promptVersionHistory = pgTable(
  "PromptVersionHistory",
  {
    id: text("id").primaryKey(),
    promptId: text("promptId")
      .notNull()
      .references(() => prompts.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    content: text("content").notNull(),
    systemPrompt: text("systemPrompt"),
    description: text("description"),
    changedBy: integer("changedBy")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    changeNote: text("changeNote"),
    isActive: boolean("isActive").default(false).notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("PromptVersion_promptId_version_key").on(table.promptId, table.version),
    index("PromptVersion_promptId_idx").on(table.promptId),
  ]
);
