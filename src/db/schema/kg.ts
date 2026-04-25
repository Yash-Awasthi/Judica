/**
 * Knowledge Graph DB Schema — entities, relationships, and KG terms.
 */

import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  index,
  uniqueIndex,
  real,
} from "drizzle-orm/pg-core";

// ─── KG Entity ────────────────────────────────────────────────────────────────

export const kgEntities = pgTable(
  "KGEntity",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    normalizedName: text("normalizedName").notNull(),
    category: text("category").notNull(),
    grounding: text("grounding").notNull().default("ungrounded"),
    sourceDocId: text("sourceDocId"),
    attributes: jsonb("attributes").default({}).notNull(),
    mentionCount: integer("mentionCount").default(1).notNull(),
    createdAt: timestamp("createdAt", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("KGEntity_normalizedName_category_key").on(table.normalizedName, table.category),
    index("KGEntity_category_idx").on(table.category),
    index("KGEntity_name_idx").on(table.name),
  ],
);

// ─── KG Relationship ─────────────────────────────────────────────────────────

export const kgRelationships = pgTable(
  "KGRelationship",
  {
    id: text("id").primaryKey(),
    sourceEntityId: text("sourceEntityId")
      .notNull()
      .references(() => kgEntities.id, { onDelete: "cascade" }),
    targetEntityId: text("targetEntityId")
      .notNull()
      .references(() => kgEntities.id, { onDelete: "cascade" }),
    relationshipType: text("relationshipType").notNull(),
    confidence: real("confidence").notNull().default(0.8),
    sourceDocId: text("sourceDocId"),
    attributes: jsonb("attributes").default({}).notNull(),
    createdAt: timestamp("createdAt", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("KGRelationship_sourceEntityId_idx").on(table.sourceEntityId),
    index("KGRelationship_targetEntityId_idx").on(table.targetEntityId),
    index("KGRelationship_type_idx").on(table.relationshipType),
    uniqueIndex("KGRelationship_source_target_type_key").on(
      table.sourceEntityId,
      table.targetEntityId,
      table.relationshipType,
    ),
  ],
);

// ─── KG Terms (for chunk-level KG search) ─────────────────────────────────────

export const kgChunkTerms = pgTable(
  "KGChunkTerm",
  {
    id: text("id").primaryKey(),
    chunkId: text("chunkId").notNull(),
    entityId: text("entityId").references(() => kgEntities.id, { onDelete: "cascade" }),
    term: text("term").notNull(),
    createdAt: timestamp("createdAt", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("KGChunkTerm_chunkId_idx").on(table.chunkId),
    index("KGChunkTerm_entityId_idx").on(table.entityId),
    index("KGChunkTerm_term_idx").on(table.term),
  ],
);
