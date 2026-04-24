/**
 * SSO DB Schema — SAML/OIDC provider configs and SSO sessions.
 */

import {
  pgTable,
  text,
  timestamp,
  boolean,
  jsonb,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { users } from "./users.js";

// ─── SSO Provider ────────────────────────────────────────────────────────────

export const ssoProviders = pgTable(
  "SSOProvider",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    type: text("type", { enum: ["saml", "oidc"] }).notNull(),
    status: text("status", { enum: ["active", "inactive", "pending_setup"] })
      .default("pending_setup")
      .notNull(),
    /** SAML-specific config (entityId, ssoUrl, certificate, etc.). Encrypted at rest. */
    samlConfig: jsonb("samlConfig"),
    /** OIDC-specific config (discoveryUrl, clientId, clientSecret, etc.). Encrypted at rest. */
    oidcConfig: jsonb("oidcConfig"),
    /** Attribute/claim mapping — maps IdP fields to user fields. */
    attributeMapping: jsonb("attributeMapping").notNull(),
    /** JIT provisioning — auto-create users on first SSO login. */
    autoProvision: boolean("autoProvision").default(true).notNull(),
    /** Default role assigned to JIT-provisioned users. */
    defaultRole: text("defaultRole").default("member").notNull(),
    /** Allowed email domains (empty array = all domains). */
    allowedDomains: jsonb("allowedDomains").default([]).notNull(),
    /** Enforce SSO-only login for matched domains. */
    enforceSSO: boolean("enforceSSO").default(false).notNull(),
    createdAt: timestamp("createdAt", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("SSOProvider_type_idx").on(table.type),
    index("SSOProvider_status_idx").on(table.status),
  ],
);

// ─── SSO Session ─────────────────────────────────────────────────────────────

export const ssoSessions = pgTable(
  "SSOSession",
  {
    id: text("id").primaryKey(),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    providerId: text("providerId")
      .notNull()
      .references(() => ssoProviders.id, { onDelete: "cascade" }),
    /** External IdP session ID (SAML SessionIndex or OIDC sid). */
    externalSessionId: text("externalSessionId"),
    /** IdP subject identifier (SAML NameID or OIDC sub). */
    externalSubjectId: text("externalSubjectId").notNull(),
    /** Raw attributes/claims from IdP (for audit/debugging). */
    rawAttributes: jsonb("rawAttributes").default({}).notNull(),
    createdAt: timestamp("createdAt", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expiresAt", { mode: "date", withTimezone: true }).notNull(),
  },
  (table) => [
    index("SSOSession_userId_idx").on(table.userId),
    index("SSOSession_providerId_idx").on(table.providerId),
    uniqueIndex("SSOSession_externalSubjectId_providerId_key").on(
      table.externalSubjectId,
      table.providerId,
    ),
  ],
);

// ─── SSO User Link (maps IdP subjects to local users) ───────────────────────

export const ssoUserLinks = pgTable(
  "SSOUserLink",
  {
    id: text("id").primaryKey(),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    providerId: text("providerId")
      .notNull()
      .references(() => ssoProviders.id, { onDelete: "cascade" }),
    /** IdP subject identifier. */
    externalSubjectId: text("externalSubjectId").notNull(),
    /** IdP email at time of link (for audit). */
    externalEmail: text("externalEmail"),
    createdAt: timestamp("createdAt", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("SSOUserLink_userId_idx").on(table.userId),
    uniqueIndex("SSOUserLink_providerId_externalSubjectId_key").on(
      table.providerId,
      table.externalSubjectId,
    ),
  ],
);
