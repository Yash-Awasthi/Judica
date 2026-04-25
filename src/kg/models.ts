/**
 * Knowledge Graph Models — entities, relationships, and KG config.
 *
 * Modeled after Onyx's KG subsystem:
 * - Entity types with grounding (anchored to known sources vs inferred)
 * - Typed relationships (source → type → target)
 * - KG fields stored alongside document chunks
 */

// ─── Entity Types ─────────────────────────────────────────────────────────────

export enum KGGroundingType {
  /** Entity anchored to a known source (e.g., a specific person, project). */
  GROUNDED = "grounded",
  /** Entity inferred from context (e.g., a concept, topic). */
  UNGROUNDED = "ungrounded",
}

export enum KGEntityCategory {
  PERSON = "person",
  ORGANIZATION = "organization",
  PROJECT = "project",
  PRODUCT = "product",
  TECHNOLOGY = "technology",
  CONCEPT = "concept",
  LOCATION = "location",
  EVENT = "event",
  DOCUMENT = "document",
  CUSTOM = "custom",
}

export interface KGEntity {
  id: string;
  name: string;
  category: KGEntityCategory;
  grounding: KGGroundingType;
  /** Source document ID where this entity was first extracted. */
  sourceDocId?: string;
  /** Attributes extracted about this entity. */
  attributes: Record<string, unknown>;
  /** Number of documents referencing this entity. */
  mentionCount: number;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Relationship Types ───────────────────────────────────────────────────────

export interface KGRelationship {
  id: string;
  sourceEntityId: string;
  targetEntityId: string;
  relationshipType: string;
  /** Confidence score 0.0-1.0. */
  confidence: number;
  /** Source document where this relationship was extracted. */
  sourceDocId?: string;
  attributes: Record<string, unknown>;
  createdAt: Date;
}

// ─── KG Config ────────────────────────────────────────────────────────────────

export enum KGStage {
  EXTRACTION = "extraction",
  NORMALIZATION = "normalization",
  INDEXING = "indexing",
  FAILURE = "failure",
}

export interface KGConfigSettings {
  enabled: boolean;
  /** Entity categories to extract. */
  entityCategories: KGEntityCategory[];
  /** Relationship types to extract. */
  relationshipTypes: string[];
  /** Minimum confidence threshold for relationships. */
  minConfidence: number;
  /** Maximum recursion depth for entity expansion. */
  maxRecursionDepth: number;
  /** Coverage start date — only process docs after this date. */
  coverageStartDate?: Date;
}

export const DEFAULT_KG_CONFIG: KGConfigSettings = {
  enabled: false,
  entityCategories: [
    KGEntityCategory.PERSON,
    KGEntityCategory.ORGANIZATION,
    KGEntityCategory.PROJECT,
    KGEntityCategory.TECHNOLOGY,
    KGEntityCategory.CONCEPT,
  ],
  relationshipTypes: [
    "works_on",
    "owns",
    "depends_on",
    "related_to",
    "part_of",
    "created_by",
    "reports_to",
    "uses",
  ],
  minConfidence: 0.7,
  maxRecursionDepth: 3,
};

// ─── KG Chunk Fields ──────────────────────────────────────────────────────────

/** Fields stored alongside document chunks for KG-enhanced search. */
export interface KGChunkFields {
  /** Entity IDs referenced in this chunk. */
  kgEntities: string[];
  /** Relationship IDs referenced in this chunk. */
  kgRelationships: string[];
  /** KG terms extracted from this chunk (for keyword matching). */
  kgTerms: string[];
}

// ─── Extraction Results ───────────────────────────────────────────────────────

export interface KGExtractionResult {
  entities: Array<{
    name: string;
    category: KGEntityCategory;
    grounding: KGGroundingType;
    attributes: Record<string, unknown>;
  }>;
  relationships: Array<{
    sourceName: string;
    targetName: string;
    type: string;
    confidence: number;
  }>;
}

export interface KGNormalizedEntities {
  entities: KGEntity[];
  /** Maps extracted name → normalized entity ID. */
  nameToIdMap: Record<string, string>;
}

export interface KGNormalizedRelationships {
  relationships: KGRelationship[];
}
