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

// ─── MarketplaceItem ─────────────────────────────────────────────────────────
export const marketplaceItems = pgTable(
  "MarketplaceItem",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    content: jsonb("content").notNull(),
    authorId: text("authorId").notNull(),
    authorName: text("authorName").notNull(),
    tags: text("tags").array().notNull(),
    downloads: integer("downloads").default(0).notNull(),
    stars: integer("stars").default(0).notNull(),
    version: text("version").default("1.0.0").notNull(),
    published: boolean("published").default(false).notNull(),
    createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { mode: "date" }).notNull(),
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
    userId: text("userId").notNull(),
    rating: integer("rating").notNull(),
    comment: text("comment"),
    createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    index("MarketplaceReview_itemId_idx").on(table.itemId),
  ],
);

// ─── MarketplaceStar ─────────────────────────────────────────────────────────
export const marketplaceStars = pgTable(
  "MarketplaceStar",
  {
    userId: text("userId").notNull(),
    itemId: text("itemId").notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.itemId] })],
);

// ─── UserSkill ───────────────────────────────────────────────────────────────
export const userSkills = pgTable(
  "UserSkill",
  {
    id: text("id").primaryKey(),
    userId: text("userId").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    code: text("code").notNull(),
    parameters: jsonb("parameters").notNull(),
    createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
    active: boolean("active").default(true).notNull(),
  },
  (table) => [index("UserSkill_userId_idx").on(table.userId)],
);
