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
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expiresAt", { mode: "date" }).notNull(),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
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
    expiresAt: timestamp("expiresAt", { mode: "date" }).notNull(),
    createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
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
  updatedAt: timestamp("updatedAt", { mode: "date" }).notNull(),
});
