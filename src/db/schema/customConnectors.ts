/**
 * Custom Connector Builder — Phase 3.1
 *
 * User-defined connectors: base URL, auth, endpoints, response mapping.
 * Stored, versioned, shareable on the marketplace.
 *
 * Inspired by:
 * - Nango (Apache 2.0, NangoHQ/nango) — unified API builder with auth management
 * - Airbyte (MIT, airbytehq/airbyte) — low-code connector builder SDK
 */

import { pgTable, serial, integer, text, jsonb, boolean, timestamp, index } from "drizzle-orm/pg-core";

export const customConnectors = pgTable("custom_connectors", {
  id:          serial("id").primaryKey(),
  userId:      integer("user_id").notNull(),
  name:        text("name").notNull(),
  description: text("description"),
  baseUrl:     text("base_url").notNull(),
  /** auth_type: none | api_key | bearer | basic | oauth2 */
  authType:    text("auth_type").notNull().default("none"),
  /** auth_config: { headerName, queryParamName, tokenUrl, etc. } */
  authConfig:  jsonb("auth_config").default({}),
  /** endpoints: EndpointDef[] — { name, path, method, parameters, responseMapping } */
  endpoints:   jsonb("endpoints").default([]),
  isActive:    boolean("is_active").notNull().default(true),
  version:     integer("version").notNull().default(1),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
  updatedAt:   timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  userIdx: index("idx_custom_connectors_user_id").on(t.userId),
}));
