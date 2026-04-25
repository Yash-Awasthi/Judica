/**
 * Standard Answers — Database Schema
 */

import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { users } from "./users.js";

export const standardAnswers = pgTable("StandardAnswer", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  answer: text("answer").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  categories: jsonb("categories").$type<string[]>().notNull().default([]),
  priority: integer("priority").notNull().default(0),
  createdBy: integer("createdBy").notNull().references(() => users.id),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
}, (table) => [
  index("idx_standard_answers_enabled").on(table.enabled),
  index("idx_standard_answers_priority").on(table.priority),
]);

export const standardAnswerRules = pgTable("StandardAnswerRule", {
  id: text("id").primaryKey(),
  answerId: text("answerId").notNull().references(() => standardAnswers.id, { onDelete: "cascade" }),
  type: text("type").$type<"keyword" | "regex" | "semantic">().notNull(),
  value: text("value").notNull(),
  threshold: integer("threshold").notNull().default(80), // stored as 0-100
  matchAll: boolean("matchAll").notNull().default(false),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
}, (table) => [
  index("idx_standard_answer_rules_answer").on(table.answerId),
]);
