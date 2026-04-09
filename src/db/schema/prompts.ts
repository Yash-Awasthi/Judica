import {
  pgTable,
  text,
  timestamp,
  integer,
  real,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { users } from "./users.js";

// ─── Prompt ──────────────────────────────────────────────────────────────────
export const prompts = pgTable(
  "Prompt",
  {
    id: text("id").primaryKey(),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    index("Prompt_userId_createdAt_idx").on(table.userId, table.createdAt),
  ],
);

// ─── PromptVersion ───────────────────────────────────────────────────────────
export const promptVersions = pgTable(
  "PromptVersion",
  {
    id: text("id").primaryKey(),
    promptId: text("promptId")
      .notNull()
      .references(() => prompts.id, { onDelete: "cascade" }),
    versionNum: integer("versionNum").notNull(),
    content: text("content").notNull(),
    model: text("model"),
    temperature: real("temperature"),
    notes: text("notes"),
    createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("PromptVersion_promptId_versionNum_key").on(
      table.promptId,
      table.versionNum,
    ),
  ],
);
