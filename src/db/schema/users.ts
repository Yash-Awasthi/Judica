import {
  pgTable,
  serial,
  text,
  timestamp,
  boolean,
  integer,
  real,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

// P8-39: Standardize ID types — use UUID primary keys throughout.
// Existing serial IDs retained for backward compatibility; new tables should use uuid().

// ─── User ────────────────────────────────────────────────────────────────────
export const users = pgTable("User", {
  id: serial("id").primaryKey(),
  // P8-38: email must be NOT NULL — nullable + unique allows multiple NULLs in PostgreSQL
  email: text("email").notNull().unique(),
  username: text("username").notNull().unique(),
  passwordHash: text("passwordHash").notNull(),
  // P8-34: Explicit auth method flag instead of relying on empty passwordHash
  authMethod: text("authMethod", { enum: ["password", "github", "google"] }).default("password").notNull(),
  customInstructions: text("customInstructions").default("").notNull(),
  createdAt: timestamp("createdAt", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  role: text("role").default("member").notNull(),
  isActive: boolean("isActive").default(true).notNull(),
});

// ─── UserSettings ───────────────────────────────────────────────────────────
export const userSettings = pgTable("UserSettings", {
  id: serial("id").primaryKey(),
  userId: integer("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" })
    .unique(),
  settings: jsonb("settings").notNull().default({}),
  updatedAt: timestamp("updatedAt", { mode: "date", withTimezone: true }).defaultNow().notNull(),
});

// ─── DailyUsage ──────────────────────────────────────────────────────────────
export const dailyUsage = pgTable(
  "DailyUsage",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    date: timestamp("date", { mode: "date", withTimezone: true }).notNull(),
    requests: integer("requests").default(0).notNull(),
    tokens: integer("tokens").default(0).notNull(),
    updatedAt: timestamp("updatedAt", { mode: "date", withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("DailyUsage_userId_date_key").on(table.userId, table.date),
  ],
);

// ─── UsageLog ────────────────────────────────────────────────────────────────
export const usageLogs = pgTable(
  "UsageLog",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    conversationId: text("conversationId"),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    promptTokens: integer("promptTokens").default(0).notNull(),
    completionTokens: integer("completionTokens").default(0).notNull(),
    costUsd: real("costUsd").default(0).notNull(),
    latencyMs: integer("latencyMs").default(0).notNull(),
    createdAt: timestamp("createdAt", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("UsageLog_userId_createdAt_idx").on(table.userId, table.createdAt),
    index("UsageLog_provider_createdAt_idx").on(table.provider, table.createdAt),
  ],
);

// ─── Evaluation ──────────────────────────────────────────────────────────────
export const evaluations = pgTable(
  "Evaluation",
  {
    id: serial("id").primaryKey(),
    sessionId: text("sessionId").notNull(),
    conversationId: text("conversationId").notNull(),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    coherence: real("coherence").default(0).notNull(),
    consensus: real("consensus").default(0).notNull(),
    diversity: real("diversity").default(0).notNull(),
    quality: real("quality").default(0).notNull(),
    efficiency: real("efficiency").default(0).notNull(),
    overallScore: real("overallScore").default(0).notNull(),
    recommendations: jsonb("recommendations"),
    strengths: jsonb("strengths"),
    weaknesses: jsonb("weaknesses"),
    timestamp: timestamp("timestamp", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("Evaluation_sessionId_idx").on(table.sessionId),
    index("Evaluation_userId_timestamp_idx").on(table.userId, table.timestamp),
  ],
);

// ─── UserArchetype ───────────────────────────────────────────────────────────
export const userArchetypes = pgTable(
  "UserArchetype",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    councilConfigId: integer("councilConfigId"),
    archetypeId: text("archetypeId").default("").notNull(),
    name: text("name").notNull(),
    thinkingStyle: text("thinkingStyle").notNull(),
    asks: text("asks").notNull(),
    blindSpot: text("blindSpot").notNull(),
    systemPrompt: text("systemPrompt").notNull(),
    tools: text("tools").array().default([]).notNull(),
    icon: text("icon"),
    colorBg: text("colorBg"),
    isActive: boolean("isActive").default(true).notNull(),
    createdAt: timestamp("createdAt", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { mode: "date", withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("UserArchetype_userId_archetypeId_key").on(
      table.userId,
      table.archetypeId,
    ),
  ],
);

// P8-41: Define Drizzle relations for type-safe joins
import { relations } from "drizzle-orm";

export const usersRelations = relations(users, ({ many, one }) => ({
  settings: one(userSettings, { fields: [users.id], references: [userSettings.userId] }),
  dailyUsage: many(dailyUsage),
  usageLogs: many(usageLogs),
  evaluations: many(evaluations),
  archetypes: many(userArchetypes),
}));

export const userSettingsRelations = relations(userSettings, ({ one }) => ({
  user: one(users, { fields: [userSettings.userId], references: [users.id] }),
}));

export const dailyUsageRelations = relations(dailyUsage, ({ one }) => ({
  user: one(users, { fields: [dailyUsage.userId], references: [users.id] }),
}));

export const usageLogRelations = relations(usageLogs, ({ one }) => ({
  user: one(users, { fields: [usageLogs.userId], references: [users.id] }),
}));

export const evaluationRelations = relations(evaluations, ({ one }) => ({
  user: one(users, { fields: [evaluations.userId], references: [users.id] }),
}));

export const userArchetypeRelations = relations(userArchetypes, ({ one }) => ({
  user: one(users, { fields: [userArchetypes.userId], references: [users.id] }),
}));