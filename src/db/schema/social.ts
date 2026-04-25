import {
  pgTable,
  text,
  timestamp,
  integer,
  primaryKey,
} from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { conversations } from "./conversations.js";
import { workflows } from "./workflows.js";
import { prompts } from "./prompts.js";

// ─── UserGroup ───────────────────────────────────────────────────────────────
export const userGroups = pgTable("UserGroup", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("createdAt", { mode: "date", withTimezone: true }).defaultNow().notNull(),
});

// ─── GroupMembership ─────────────────────────────────────────────────────────
export const groupMemberships = pgTable(
  "GroupMembership",
  {
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    groupId: text("groupId")
      .notNull()
      .references(() => userGroups.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.userId, table.groupId] })],
);

// ─── SharedConversation ──────────────────────────────────────────────────────
export const sharedConversations = pgTable("SharedConversation", {
  id: text("id").primaryKey(),
  conversationId: text("conversationId").notNull().unique().references(() => conversations.id, { onDelete: "cascade" }),
  ownerId: integer("ownerId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  shareToken: text("shareToken").notNull().unique(),
  access: text("access").default("read").notNull(),
  expiresAt: timestamp("expiresAt", { mode: "date", withTimezone: true }),
  createdAt: timestamp("createdAt", { mode: "date", withTimezone: true }).defaultNow().notNull(),
});

// ─── SharedWorkflow ──────────────────────────────────────────────────────────
export const sharedWorkflows = pgTable("SharedWorkflow", {
  id: text("id").primaryKey(),
  workflowId: text("workflowId").notNull().unique().references(() => workflows.id, { onDelete: "cascade" }),
  ownerId: integer("ownerId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  shareToken: text("shareToken").notNull().unique(),
  access: text("access").default("read").notNull(),
  expiresAt: timestamp("expiresAt", { mode: "date", withTimezone: true }),
  createdAt: timestamp("createdAt", { mode: "date", withTimezone: true }).defaultNow().notNull(),
});

// ─── SharedPrompt ────────────────────────────────────────────────────────────
export const sharedPrompts = pgTable("SharedPrompt", {
  id: text("id").primaryKey(),
  promptId: text("promptId").notNull().unique().references(() => prompts.id, { onDelete: "cascade" }),
  ownerId: integer("ownerId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  shareToken: text("shareToken").notNull().unique(),
  access: text("access").default("read").notNull(),
  expiresAt: timestamp("expiresAt", { mode: "date", withTimezone: true }),
  createdAt: timestamp("createdAt", { mode: "date", withTimezone: true }).defaultNow().notNull(),
});
