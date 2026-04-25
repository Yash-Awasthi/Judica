import {
  pgTable,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  index,
} from "drizzle-orm/pg-core";

// ─── ResponseFeedback ────────────────────────────────────────────────────────
export const responseFeedback = pgTable("ResponseFeedback", {
  id: text("id").primaryKey(),
  conversationId: text("conversationId").notNull(),
  messageIndex: integer("messageIndex").notNull(),
  userId: integer("userId").notNull(),
  rating: text("rating").notNull(),  // 'positive' | 'negative'
  feedbackText: text("feedbackText"),
  qualityIssues: jsonb("qualityIssues").default([]).notNull(),  // ['wrong_source','outdated','hallucination',...]
  selectedText: text("selectedText"),  // what the user highlighted
  improvedAnswer: text("improvedAnswer"),  // user's suggested correction
  documentIds: jsonb("documentIds").default([]).notNull(),  // which docs were cited
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("ResponseFeedback_conversationId_idx").on(table.conversationId),
  index("ResponseFeedback_userId_createdAt_idx").on(table.userId, table.createdAt),
  index("ResponseFeedback_rating_createdAt_idx").on(table.rating, table.createdAt),
]);

// ─── SearchFeedback ──────────────────────────────────────────────────────────
export const searchFeedback = pgTable("SearchFeedback", {
  id: text("id").primaryKey(),
  query: text("query").notNull(),
  documentId: text("documentId").notNull(),
  userId: integer("userId").notNull(),
  isRelevant: boolean("isRelevant").notNull(),
  tenantId: text("tenantId"),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("SearchFeedback_query_idx").on(table.query),
  index("SearchFeedback_documentId_idx").on(table.documentId),
  index("SearchFeedback_tenantId_createdAt_idx").on(table.tenantId, table.createdAt),
]);
