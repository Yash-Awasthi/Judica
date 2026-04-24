import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";
import { users } from "./users.js";

// ─── MarketplaceItem ─────────────────────────────────────────────────────────
export const marketplaceItems = pgTable(
  "MarketplaceItem",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    content: jsonb("content").notNull(),
    authorId: integer("authorId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    authorName: text("authorName").notNull(),
    tags: text("tags").array().notNull(),
    downloads: integer("downloads").default(0).notNull(),
    stars: integer("stars").default(0).notNull(),
    version: text("version").default("1.0.0").notNull(),
    published: boolean("published").default(false).notNull(),
    createdAt: timestamp("createdAt", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { mode: "date", withTimezone: true }).notNull(),
  },
  (table) => [
    index("MarketplaceItem_authorId_idx").on(table.authorId),
    index("MarketplaceItem_type_idx").on(table.type),
  ],
);

// ─── MarketplaceReview ───────────────────────────────────────────────────────
export const marketplaceReviews = pgTable(
  "MarketplaceReview",
  {
    id: text("id").primaryKey(),
    itemId: text("itemId")
      .notNull()
      .references(() => marketplaceItems.id, { onDelete: "cascade" }),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Rating must be 1-5. Enforce in application layer (routes/marketplace.ts).
    // DB CHECK: ALTER TABLE "MarketplaceReview" ADD CONSTRAINT rating_range CHECK (rating >= 1 AND rating <= 5);
    rating: integer("rating").notNull(),
    comment: text("comment"),
    createdAt: timestamp("createdAt", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  // Composite indexes for common query patterns
  (table) => [
    index("MarketplaceReview_itemId_idx").on(table.itemId),
    index("MarketplaceReview_userId_createdAt_idx").on(table.userId, table.createdAt),
  ],
);

// ─── MarketplaceStar ─────────────────────────────────────────────────────────
export const marketplaceStars = pgTable(
  "MarketplaceStar",
  {
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    itemId: text("itemId")
      .notNull()
      .references(() => marketplaceItems.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.userId, table.itemId] })],
);

// ─── UserSkill ───────────────────────────────────────────────────────────────
export const userSkills = pgTable(
  "UserSkill",
  {
    id: text("id").primaryKey(),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull(),
    code: text("code").notNull(),
    parameters: jsonb("parameters").notNull(),
    createdAt: timestamp("createdAt", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    active: boolean("active").default(true).notNull(),
  },
  // Composite index for user skill lookups ordered by creation
  (table) => [
    index("UserSkill_userId_idx").on(table.userId),
    index("UserSkill_userId_createdAt_idx").on(table.userId, table.createdAt),
  ],
);
