/**
 * P4-50: Shard pgvector HNSW indexes by user/workspace.
 *
 * HNSW indexes don't rebuild cheaply, so we partition the vector store
 * by workspace to keep each index manageable and allow independent
 * maintenance operations.
 */


export interface ShardConfig {
  strategy: "by_user" | "by_workspace" | "by_kb";
  maxVectorsPerShard: number;
  rebalanceThreshold: number;  // Fraction at which to trigger rebalance
}

export interface ShardInfo {
  id: string;
  ownerId: string;           // userId or workspaceId
  vectorCount: number;
  indexSize: number;          // estimated bytes
  lastReindexed: Date | null;
  isHealthy: boolean;
}

const DEFAULT_CONFIG: ShardConfig = {
  strategy: "by_workspace",
  maxVectorsPerShard: 1_000_000,
  rebalanceThreshold: 0.85,
};

/**
 * Determine the shard name for a given entity.
 */
export function getShardName(entityId: string, strategy: ShardConfig["strategy"] = "by_workspace"): string {
  return `vectors_${strategy}_${entityId}`;
}

/** Validate that a shard name contains only safe characters for SQL identifiers. */
function validateIdentifier(name: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(name)) {
    throw new Error(`Invalid SQL identifier: ${name}`);
  }
  return name;
}

/**
 * Generate the SQL for creating a sharded vector table with HNSW index.
 */
export function generateShardDDL(shardName: string, dimensions: number = 1536): string {
  validateIdentifier(shardName);
  if (!Number.isInteger(dimensions) || dimensions < 1 || dimensions > 10000) {
    throw new Error(`Invalid dimensions: ${dimensions}`);
  }
  return `
-- Create sharded vector table
CREATE TABLE IF NOT EXISTS "${shardName}" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content TEXT NOT NULL,
  embedding vector(${dimensions}) NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create HNSW index on the shard (m=16, ef_construction=64 for balance)
CREATE INDEX IF NOT EXISTS "idx_${shardName}_hnsw"
  ON "${shardName}"
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Create metadata GIN index for filtering
CREATE INDEX IF NOT EXISTS "idx_${shardName}_metadata"
  ON "${shardName}"
  USING gin (metadata);
`.trim();
}

/**
 * Check if a shard needs rebalancing (too many vectors).
 */
export function needsRebalance(shard: ShardInfo, config: ShardConfig = DEFAULT_CONFIG): boolean {
  return shard.vectorCount >= config.maxVectorsPerShard * config.rebalanceThreshold;
}

/**
 * Plan the rebalance operation for an oversized shard.
 * Returns the suggested split strategy.
 */
export function planRebalance(
  shard: ShardInfo,
  config: ShardConfig = DEFAULT_CONFIG,
): { action: "split" | "archive" | "none"; reason: string } {
  if (shard.vectorCount < config.maxVectorsPerShard * config.rebalanceThreshold) {
    return { action: "none", reason: "Shard is within limits" };
  }

  if (shard.vectorCount > config.maxVectorsPerShard * 1.5) {
    return { action: "split", reason: `Shard has ${shard.vectorCount} vectors, 50% over limit` };
  }

  return { action: "archive", reason: "Shard approaching limit, archive old vectors" };
}

/**
 * Generate migration SQL to move vectors from one shard to another.
 */
export function generateMigrationSQL(
  fromShard: string,
  toShard: string,
  condition: string,
): string {
  validateIdentifier(fromShard);
  validateIdentifier(toShard);
  // Reject obvious SQL injection patterns in conditions
  if (/;\s*(DROP|ALTER|CREATE|TRUNCATE|INSERT|UPDATE|DELETE|GRANT|REVOKE)\b/i.test(condition)) {
    throw new Error("Potentially dangerous SQL in migration condition");
  }
  return `
-- Migrate vectors matching condition
INSERT INTO "${toShard}" (id, content, embedding, metadata, created_at)
SELECT id, content, embedding, metadata, created_at
FROM "${fromShard}"
WHERE ${condition};

-- Remove migrated vectors from source
DELETE FROM "${fromShard}" WHERE ${condition};

-- Reindex source shard after deletion
REINDEX INDEX "idx_${fromShard}_hnsw";
`.trim();
}
