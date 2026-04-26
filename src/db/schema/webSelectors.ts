/**
 * Natural Language Web Selectors — Phase 3.12
 *
 * Describe what you want from a page in plain language instead of CSS selectors
 * or XPath. AI locates the element on the live page. Queries self-heal when the
 * website UI changes — no broken automation after a redesign. Same query works
 * across different sites with similar content.
 *
 * Inspired by:
 * - AgentQL (agentql.com) — natural language web selectors
 * - Playwright locators — role-based + text-based element selection
 * - Puppeteer waitForSelector — resilient selector resolution
 *
 * Zero-dependency: LLM-based resolution via existing adapter infrastructure.
 */

import { pgTable, serial, integer, text, boolean, real, timestamp, index } from "drizzle-orm/pg-core";

export const webSelectors = pgTable("web_selectors", {
  id:               serial("id").primaryKey(),
  userId:           integer("user_id").notNull(),
  name:             text("name").notNull(),
  /** Natural language description: e.g. "the main search input on the homepage" */
  description:      text("description").notNull(),
  /** Target URL pattern for this selector */
  url:              text("url"),
  /** Cached resolved CSS/XPath selector from last successful resolution */
  resolvedSelector: text("resolved_selector"),
  /** Type of the resolved selector */
  selectorType:     text("selector_type").notNull().default("css"),
  /** Confidence score 0-1 of last resolution */
  confidence:       real("confidence").notNull().default(0),
  /** When the selector was last successfully resolved */
  lastResolvedAt:   timestamp("last_resolved_at"),
  /** Number of consecutive failures since last success */
  failCount:        integer("fail_count").notNull().default(0),
  createdAt:        timestamp("created_at").defaultNow().notNull(),
  updatedAt:        timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  userIdx: index("idx_web_selectors_user_id").on(t.userId),
}));

export const webSelectorExecutions = pgTable("web_selector_executions", {
  id:               serial("id").primaryKey(),
  selectorId:       integer("selector_id").notNull(),
  /** URL that was actually fetched (may differ from selector.url) */
  url:              text("url").notNull(),
  success:          boolean("success").notNull(),
  /** The selector used for this execution */
  resolvedSelector: text("resolved_selector").notNull(),
  /** Content extracted from the matched element(s) */
  extractedContent: text("extracted_content"),
  /** Execution time in milliseconds */
  executionTimeMs:  integer("execution_time_ms").notNull(),
  /** Error message if execution failed */
  errorMessage:     text("error_message"),
  createdAt:        timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  selectorIdx: index("idx_web_selector_executions_selector_id").on(t.selectorId),
}));
