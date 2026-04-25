import { pgTable, text, timestamp, integer, boolean, jsonb } from "drizzle-orm/pg-core";

export const plans = pgTable("Plan", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),  // 'free' | 'pro' | 'enterprise'
  displayName: text("displayName").notNull(),
  stripeProductId: text("stripeProductId"),
  monthlyPriceId: text("monthlyPriceId"),
  annualPriceId: text("annualPriceId"),
  priceMonthly: integer("priceMonthly").default(0).notNull(),  // cents
  priceAnnual: integer("priceAnnual").default(0).notNull(),
  maxSeats: integer("maxSeats").default(1).notNull(),
  maxStorageMb: integer("maxStorageMb").default(500).notNull(),
  maxMonthlyTokens: integer("maxMonthlyTokens").default(100000).notNull(),
  features: jsonb("features").default([]).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
});

export const subscriptions = pgTable("Subscription", {
  id: text("id").primaryKey(),
  tenantId: text("tenantId").notNull(),
  planId: text("planId").notNull().references(() => plans.id),
  stripeCustomerId: text("stripeCustomerId"),
  stripeSubscriptionId: text("stripeSubscriptionId").unique(),
  status: text("status").notNull().default("active"),  // active | trialing | past_due | canceled
  currentPeriodStart: timestamp("currentPeriodStart", { withTimezone: true }),
  currentPeriodEnd: timestamp("currentPeriodEnd", { withTimezone: true }),
  cancelAtPeriodEnd: boolean("cancelAtPeriodEnd").default(false).notNull(),
  seats: integer("seats").default(1).notNull(),
  billingInterval: text("billingInterval").default("monthly").notNull(),
  metadata: jsonb("metadata").default({}).notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
});

export type Plan = typeof plans.$inferSelect;
export type NewPlan = typeof plans.$inferInsert;
export type Subscription = typeof subscriptions.$inferSelect;
export type NewSubscription = typeof subscriptions.$inferInsert;
