import {
  pgTable,
  text,
  timestamp,
  integer,
  primaryKey,
} from "drizzle-orm/pg-core";
import { users } from "./users.js";

// ─── UserGroup ───────────────────────────────────────────────────────────────
export const userGroups = pgTable("UserGroup", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
});

// ─── GroupMembership ─────────────────────────────────────────────────────────
export const groupMemberships = pgTable(
  "GroupMembership",
  {
    userId: integer("userId")
      .notNull()
      .references(() => users.id),
    groupId: text("groupId")
      .notNull()
      .references(() => userGroups.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.userId, table.groupId] })],
);

// ─── SharedConversation ──────────────────────────────────────────────────────
export const sharedConversations = pgTable("SharedConversation", {
  id: text("id").primaryKey(),
  conversationId: text("conversationId").notNull().unique(),
  ownerId: integer("ownerId").notNull(),
  shareToken: text("shareToken").notNull().unique(),
  access: text("access").default("read").notNull(),
  expiresAt: timestamp("expiresAt", { mode: "date" }),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
});

// ─── SharedWorkflow ──────────────────────────────────────────────────────────
export const sharedWorkflows = pgTable("SharedWorkflow", {
  id: text("id").primaryKey(),
  workflowId: text("workflowId").notNull().unique(),
  ownerId: integer("ownerId").notNull(),
  shareToken: text("shareToken").notNull().unique(),
  access: text("access").default("read").notNull(),
  expiresAt: timestamp("expiresAt", { mode: "date" }),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
});

// ─── SharedPrompt ────────────────────────────────────────────────────────────
export const sharedPrompts = pgTable("SharedPrompt", {
  id: text("id").primaryKey(),
  promptId: text("promptId").notNull().unique(),
  ownerId: integer("ownerId").notNull(),
  shareToken: text("shareToken").notNull().unique(),
  access: text("access").default("read").notNull(),
  expiresAt: timestamp("expiresAt", { mode: "date" }),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
});
