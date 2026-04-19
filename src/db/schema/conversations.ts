import {
  pgTable,
  serial,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { projects } from "./projects.js";
import { vector } from "./types.js";

// ─── Conversation ────────────────────────────────────────────────────────────
export const conversations = pgTable(
  "Conversation",
  {
    id: text("id").primaryKey(),
    userId: integer("userId").references(() => users.id, { onDelete: "cascade" }),
    title: text("title").default("New Conversation").notNull(),
    createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { mode: "date" }).notNull(),
    isPublic: boolean("isPublic").default(false).notNull(),
    sessionSummary: text("sessionSummary"),
    projectId: text("projectId").references(() => projects.id, { onDelete: "set null" }),
    activeTab: text("activeTab").default("discussion").notNull(),
    summaryData: jsonb("summaryData"),
  },
  (table) => [
    index("Conversation_userId_idx").on(table.userId),
    index("Conversation_userId_updatedAt_idx").on(table.userId, table.updatedAt),
  ],
);

// ─── Chat ────────────────────────────────────────────────────────────────────
export const chats = pgTable(
  "Chat",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId").references(() => users.id, { onDelete: "cascade" }),
    question: text("question").notNull(),
    verdict: text("verdict").notNull(),
    opinions: jsonb("opinions").notNull(),
    createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
    cacheHit: boolean("cacheHit").default(false).notNull(),
    conversationId: text("conversationId").references(() => conversations.id, {
      onDelete: "cascade",
    }),
    durationMs: integer("durationMs"),
    tokensUsed: integer("tokensUsed"),
    embedding: vector("embedding", { dimensions: 1536 }),
  },
  (table) => [
    index("Chat_userId_idx").on(table.userId),
    index("Chat_conversationId_createdAt_idx").on(
      table.conversationId,
      table.createdAt,
    ),
    index("Chat_embedding_hnsw_idx")
      .using("hnsw", table.embedding.op("vector_cosine_ops")),
  ],
);

// ─── ContextSummary ──────────────────────────────────────────────────────────
export const contextSummaries = pgTable(
  "ContextSummary",
  {
    id: serial("id").primaryKey(),
    conversationId: text("conversationId")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    summary: text("summary").notNull(),
    messageCount: integer("messageCount").default(0).notNull(),
    createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    index("ContextSummary_conversationId_createdAt_idx").on(
      table.conversationId,
      table.createdAt,
    ),
  ],
);

// ─── AuditLog ────────────────────────────────────────────────────────────────
export const auditLogs = pgTable(
  "AuditLog",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId").references(() => users.id, { onDelete: "cascade" }),
    conversationId: text("conversationId").references(() => conversations.id, {
      onDelete: "cascade",
    }),
    modelName: text("modelName").notNull(),
    prompt: text("prompt").notNull(),
    response: text("response").notNull(),
    tokensIn: integer("tokensIn").default(0).notNull(),
    tokensOut: integer("tokensOut").default(0).notNull(),
    latencyMs: integer("latencyMs").default(0).notNull(),
    metadata: jsonb("metadata"),
    createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    index("AuditLog_conversationId_createdAt_idx").on(
      table.conversationId,
      table.createdAt,
    ),
    index("AuditLog_userId_createdAt_idx").on(table.userId, table.createdAt),
  ],
);

// ─── SemanticCache ───────────────────────────────────────────────────────────
export const semanticCache = pgTable(
  "SemanticCache",
  {
    id: serial("id").primaryKey(),
    createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
    expiresAt: timestamp("expiresAt", { mode: "date" }).notNull(),
    keyHash: text("keyHash").notNull().unique(),
    opinions: jsonb("opinions").notNull(),
    prompt: text("prompt").notNull(),
    verdict: text("verdict").notNull(),
    embedding: vector("embedding", { dimensions: 1536 }),
  },
  (table) => [
    index("SemanticCache_embedding_hnsw_idx")
      .using("hnsw", table.embedding.op("vector_cosine_ops")),
  ],
);

// ─── TopicNode ──────────────────────────────────────────────────────────────
// Represents a topic extracted from conversations. Topics are linked to
// conversations and to each other via embedding similarity, forming a graph.
export const topicNodes = pgTable(
  "TopicNode",
  {
    id: text("id").primaryKey(),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    summary: text("summary"),
    embedding: vector("embedding", { dimensions: 1536 }),
    conversationIds: jsonb("conversationIds").$type<string[]>().default([]).notNull(),
    strength: integer("strength").default(1).notNull(),
    createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    index("TopicNode_userId_idx").on(table.userId),
    index("TopicNode_embedding_hnsw_idx")
      .using("hnsw", table.embedding.op("vector_cosine_ops")),
  ],
);

// ─── TopicEdge ──────────────────────────────────────────────────────────────
// Weighted edges between topic nodes, representing relatedness.
export const topicEdges = pgTable(
  "TopicEdge",
  {
    id: text("id").primaryKey(),
    sourceTopicId: text("sourceTopicId")
      .notNull()
      .references(() => topicNodes.id, { onDelete: "cascade" }),
    targetTopicId: text("targetTopicId")
      .notNull()
      .references(() => topicNodes.id, { onDelete: "cascade" }),
    weight: integer("weight").default(1).notNull(),
    createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    index("TopicEdge_source_idx").on(table.sourceTopicId),
    index("TopicEdge_target_idx").on(table.targetTopicId),
  ],
);
