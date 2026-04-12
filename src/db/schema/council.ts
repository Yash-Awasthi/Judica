import {
  pgTable,
  serial,
  text,
  timestamp,
  integer,
  real,
  jsonb,
  boolean,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { users } from "./users.js";

// ─── CustomProvider ──────────────────────────────────────────────────────────
export const customProviders = pgTable(
  "CustomProvider",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    baseUrl: text("baseUrl").notNull(),
    authType: text("authType").notNull(),
    authKey: text("authKey").notNull(),
    authHeaderName: text("authHeaderName"),
    capabilities: jsonb("capabilities").notNull(),
    models: text("models").array().notNull(),
    createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { mode: "date" }).notNull(),
  },
  (table) => [
    uniqueIndex("CustomProvider_userId_name_key").on(table.userId, table.name),
  ],
);

// ─── SharedFact ──────────────────────────────────────────────────────────────
export const sharedFacts = pgTable(
  "SharedFact",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversationId").notNull(),
    content: text("content").notNull(),
    sourceAgent: text("sourceAgent").notNull(),
    type: text("type").notNull(),
    confidence: real("confidence").notNull(),
    confirmedBy: text("confirmedBy").array().notNull(),
    disputedBy: text("disputedBy").array().notNull(),
    createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    index("SharedFact_conversationId_idx").on(table.conversationId),
  ],
);

// ─── CustomPersona ───────────────────────────────────────────────────────────
export const customPersonas = pgTable(
  "CustomPersona",
  {
    id: text("id").primaryKey(),
    userId: integer("userId")
      .notNull()
      .references(() => users.id),
    name: text("name").notNull(),
    systemPrompt: text("systemPrompt").notNull(),
    temperature: real("temperature").default(0.7).notNull(),
    critiqueStyle: text("critiqueStyle"),
    domain: text("domain"),
    aggressiveness: integer("aggressiveness").default(5).notNull(),
    createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [index("CustomPersona_userId_idx").on(table.userId)],
);

// ─── PromptDNA ───────────────────────────────────────────────────────────────
export const promptDnas = pgTable(
  "PromptDNA",
  {
    id: text("id").primaryKey(),
    userId: integer("userId")
      .notNull()
      .references(() => users.id),
    name: text("name").notNull(),
    systemPrompt: text("systemPrompt").notNull(),
    steeringRules: text("steeringRules").notNull(),
    consensusBias: text("consensusBias").notNull(),
    critiqueStyle: text("critiqueStyle").notNull(),
    createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [index("PromptDNA_userId_idx").on(table.userId)],
);
