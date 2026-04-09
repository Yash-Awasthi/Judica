import {
  pgTable,
  text,
  timestamp,
  integer,
  real,
  jsonb,
  index,
} from "drizzle-orm/pg-core";

// ─── Trace ───────────────────────────────────────────────────────────────────
export const traces = pgTable(
  "Trace",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversationId"),
    workflowRunId: text("workflowRunId"),
    userId: integer("userId").notNull(),
    type: text("type").notNull(),
    steps: jsonb("steps").notNull(),
    totalLatencyMs: integer("totalLatencyMs").notNull(),
    totalTokens: integer("totalTokens").notNull(),
    totalCostUsd: real("totalCostUsd").notNull(),
    createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    index("Trace_userId_createdAt_idx").on(table.userId, table.createdAt),
    index("Trace_conversationId_idx").on(table.conversationId),
    index("Trace_type_idx").on(table.type),
  ],
);

// ─── ModelReliability ────────────────────────────────────────────────────────
export const modelReliability = pgTable("ModelReliability", {
  model: text("model").primaryKey(),
  totalResponses: integer("totalResponses").default(0).notNull(),
  agreedWith: integer("agreedWith").default(0).notNull(),
  contradicted: integer("contradicted").default(0).notNull(),
  toolErrors: integer("toolErrors").default(0).notNull(),
  avgConfidence: real("avgConfidence").default(0).notNull(),
  updatedAt: timestamp("updatedAt", { mode: "date" }).notNull(),
});
