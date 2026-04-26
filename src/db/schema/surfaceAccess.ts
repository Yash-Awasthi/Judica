/**
 * Surface Access DB Schema — embeddable widgets and multi-surface access tokens.
 *
 * Phase 3.10: The council everywhere — Chrome extension, Slack bot, Discord bot,
 * embeddable website widget, desktop app. Same agents, same knowledge base, same
 * council — just accessible from wherever the user is.
 */

import {
  pgTable,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { users } from "./users.js";

// ─── Embeddable Widgets ─────────────────────────────────────────────────────

export const embeddableWidgets = pgTable(
  "EmbeddableWidget",
  {
    id: text("id").primaryKey(),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Human-readable name for this widget (e.g., "Support Widget"). */
    name: text("name").notNull(),
    /** Domains allowed to embed this widget (origin whitelist). */
    allowedOrigins: jsonb("allowedOrigins").$type<string[]>().default([]).notNull(),
    /** API key used to authenticate widget requests. */
    apiKey: text("apiKey").notNull().unique(),
    /** Widget colour scheme. */
    theme: text("theme").notNull().default("auto"),
    /** Widget position on the page. */
    position: text("position").notNull().default("bottom-right"),
    /** Optional custom CSS injected into the widget iframe. */
    customCss: text("customCss"),
    /** Whether the widget is currently active and accepting requests. */
    isActive: boolean("isActive").default(true).notNull(),
    createdAt: timestamp("createdAt", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("EmbeddableWidget_userId_idx").on(table.userId),
    index("EmbeddableWidget_apiKey_idx").on(table.apiKey),
  ],
);

export type EmbeddableWidget = typeof embeddableWidgets.$inferSelect;
export type NewEmbeddableWidget = typeof embeddableWidgets.$inferInsert;

// ─── Surface Access Tokens ──────────────────────────────────────────────────

export const surfaceAccessTokens = pgTable(
  "SurfaceAccessToken",
  {
    id: text("id").primaryKey(),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Which surface this token grants access to. */
    surface: text("surface").notNull(),
    /** SHA-256 hash of the token — never store plaintext. */
    tokenHash: text("tokenHash").notNull().unique(),
    /** Human-readable label (e.g., "My Chrome Extension"). */
    label: text("label").notNull(),
    lastUsedAt: timestamp("lastUsedAt", { mode: "date", withTimezone: true }),
    expiresAt: timestamp("expiresAt", { mode: "date", withTimezone: true }),
    createdAt: timestamp("createdAt", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("SurfaceAccessToken_userId_idx").on(table.userId),
    index("SurfaceAccessToken_surface_idx").on(table.surface),
    index("SurfaceAccessToken_tokenHash_idx").on(table.tokenHash),
  ],
);

export type SurfaceAccessToken = typeof surfaceAccessTokens.$inferSelect;
export type NewSurfaceAccessToken = typeof surfaceAccessTokens.$inferInsert;
