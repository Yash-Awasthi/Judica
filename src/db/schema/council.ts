import {
  pgTable,
  serial,
  text,
  timestamp,
  integer,
  real,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { conversations } from "./conversations.js";

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
    // SECURITY — authKey is stored as text. Application layer (routes/customProviders.ts)
    // MUST encrypt before INSERT and decrypt on SELECT. Use lib/crypto.ts encrypt/decrypt functions.
    // TODO: migrate to pgcrypto or application-level AES-256-GCM encryption.
    authKey: text("authKey").notNull(),
    authHeaderName: text("authHeaderName"),
    capabilities: jsonb("capabilities").notNull(),
    models: text("models").array().notNull(),
    createdAt: timestamp("createdAt", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { mode: "date", withTimezone: true }).notNull(),
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
    // Add FK constraint — was missing, orphaned rows could accumulate
    conversationId: text("conversationId").notNull().references(() => conversations.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    sourceAgent: text("sourceAgent").notNull(),
    type: text("type").notNull(),
    confidence: real("confidence").notNull(),
    confirmedBy: text("confirmedBy").array().notNull(),
    disputedBy: text("disputedBy").array().notNull(),
    createdAt: timestamp("createdAt", { mode: "date", withTimezone: true }).defaultNow().notNull(),
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
      // Cascade delete when user is removed
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    systemPrompt: text("systemPrompt").notNull(),
    temperature: real("temperature").default(0.7).notNull(),
    critiqueStyle: text("critiqueStyle"),
    domain: text("domain"),
    aggressiveness: integer("aggressiveness").default(5).notNull(),
    createdAt: timestamp("createdAt", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("CustomPersona_userId_idx").on(table.userId),
    // Add unique constraint — one persona per name per user
    uniqueIndex("CustomPersona_userId_name_key").on(table.userId, table.name),
  ],
);

// ─── PromptDNA ───────────────────────────────────────────────────────────────
export const promptDnas = pgTable(
  "PromptDNA",
  {
    id: text("id").primaryKey(),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    systemPrompt: text("systemPrompt").notNull(),
    steeringRules: text("steeringRules").notNull(),
    consensusBias: text("consensusBias").notNull(),
    critiqueStyle: text("critiqueStyle").notNull(),
    createdAt: timestamp("createdAt", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("PromptDNA_userId_idx").on(table.userId)],
);

// ─── ContradictionRecord ────────────────────────────────────────────────────
// Tracks contradictions detected during deliberation, with versioned
// resolution records instead of silent overwrite.
export const contradictionRecords = pgTable(
  "ContradictionRecord",
  {
    id: text("id").primaryKey(),
    // Add FK constraint to prevent orphaned contradiction records
    conversationId: text("conversationId").notNull().references(() => conversations.id, { onDelete: "cascade" }),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    claimA: text("claimA").notNull(),
    sourceA: text("sourceA").notNull(),
    claimB: text("claimB").notNull(),
    sourceB: text("sourceB").notNull(),
    resolution: text("resolution"),
    resolvedBy: text("resolvedBy"),
    status: text("status").notNull().default("open"),
    confidence: real("confidence"),
    versions: jsonb("versions").$type<ContradictionVersion[]>().default([]).notNull(),
    createdAt: timestamp("createdAt", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    resolvedAt: timestamp("resolvedAt", { mode: "date", withTimezone: true }),
  },
  (table) => [
    index("ContradictionRecord_conversationId_idx").on(table.conversationId),
    index("ContradictionRecord_userId_status_idx").on(table.userId, table.status),
  ],
);

export interface ContradictionVersion {
  resolution: string;
  resolvedBy: string;
  confidence: number;
  timestamp: string;
  reason: string;
}
