import { pgTable, text, timestamp, boolean, jsonb } from "drizzle-orm/pg-core";

export const tenantBranding = pgTable("TenantBranding", {
  id: text("id").primaryKey(),
  tenantId: text("tenantId").notNull().unique(),
  logoUrl: text("logoUrl"),
  faviconUrl: text("faviconUrl"),
  primaryColor: text("primaryColor").default("#6366f1"),
  secondaryColor: text("secondaryColor").default("#8b5cf6"),
  brandName: text("brandName"),
  customDomain: text("customDomain").unique(),
  customCss: text("customCss"),
  hideAiByAiBranding: boolean("hideAiByAiBranding").default(false).notNull(),
  emailFromName: text("emailFromName"),
  emailFromAddress: text("emailFromAddress"),
  supportUrl: text("supportUrl"),
  privacyUrl: text("privacyUrl"),
  termsUrl: text("termsUrl"),
  metaConfig: jsonb("metaConfig").default({}).notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
});

export type TenantBranding = typeof tenantBranding.$inferSelect;
export type NewTenantBranding = typeof tenantBranding.$inferInsert;
