import {
  pgTable,
  serial,
  text,
  timestamp,
  integer,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { users } from "./users.js";

// ─── RevokedToken ────────────────────────────────────────────────────────────
export const revokedTokens = pgTable("RevokedToken", {
  id: serial("id").primaryKey(),
  // Store SHA-256 hash of the token, NOT the raw JWT.
  // Callers must hash before insert/lookup. Prevents token extraction if DB is compromised.
  tokenHash: text("tokenHash").notNull().unique(),
  expiresAt: timestamp("expiresAt", { mode: "date", withTimezone: true }).notNull(),
  createdAt: timestamp("createdAt", { mode: "date", withTimezone: true }).defaultNow().notNull(),
});

// ─── RefreshToken ────────────────────────────────────────────────────────────
export const refreshTokens = pgTable(
  "RefreshToken",
  {
    id: text("id").primaryKey(),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("tokenHash").notNull().unique(),
    ipHash: text("ipHash"),
    userAgentHash: text("userAgentHash"),
    expiresAt: timestamp("expiresAt", { mode: "date", withTimezone: true }).notNull(),
    createdAt: timestamp("createdAt", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("RefreshToken_userId_idx").on(table.userId)],
);

// ─── CouncilConfig ───────────────────────────────────────────────────────────
export const councilConfigs = pgTable("CouncilConfig", {
  id: serial("id").primaryKey(),
  userId: integer("userId")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  config: jsonb("config").notNull(),
  updatedAt: timestamp("updatedAt", { mode: "date", withTimezone: true }).notNull(),
});
