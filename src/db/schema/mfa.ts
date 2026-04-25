import {
  pgTable,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
} from "drizzle-orm/pg-core";

// MFA configuration per user
export const mfaConfig = pgTable("MfaConfig", {
  id: text("id").primaryKey(),
  userId: integer("userId").notNull().unique(),
  secret: text("secret").notNull(),  // TOTP secret (encrypted at rest)
  enabled: boolean("enabled").default(false).notNull(),
  backupCodes: jsonb("backupCodes").default([]).notNull(),  // hashed backup codes
  verifiedAt: timestamp("verifiedAt", { withTimezone: true }),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
});
