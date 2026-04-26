/**
 * OpenAPI Tools Schema — Phase 1.15
 *
 * Stores user-defined tool definitions in OpenAPI/JSON Schema format.
 * Each tool maps to an HTTP endpoint callable during council deliberation.
 */
import { pgTable, uuid, text, integer, boolean, jsonb, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users.js";

export const openapiTools = pgTable("openapi_tools", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").notNull(),
  /** HTTP method: GET, POST, PUT, PATCH, DELETE */
  method: text("method").notNull().default("POST"),
  /** Endpoint URL */
  url: text("url").notNull(),
  /** JSON Schema object for parameters */
  parameters: jsonb("parameters").notNull(),
  /** Encrypted auth meta: { authHeader, authValue } */
  meta: jsonb("meta"),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type OpenapiTool = typeof openapiTools.$inferSelect;
export type NewOpenapiTool = typeof openapiTools.$inferInsert;
