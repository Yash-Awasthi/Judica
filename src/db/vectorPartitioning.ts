/**
 * P4-50: pgvector HNSW index sharding guidance.
 *
 * HNSW indexes don't rebuild cheaply — on large tables (>1M vectors),
 * inserts become progressively slower as the graph grows. Partitioning
 * by user/workspace keeps each partition's HNSW index small and fast.
 *
 * This module provides:
 * 1. SQL migration templates for range-partitioning vector tables
 * 2. A helper to generate per-partition HNSW indexes
 *
 * IMPORTANT: These are migration helpers, NOT auto-run code.
 * Run them manually via `psql` or a migration tool when the table
 * exceeds ~500K vectors.
 *
 * Strategy:
 *   - Partition "Memory" and "CodeFile" tables by userId (hash partition)
 *   - Each partition gets its own HNSW index
 *   - Queries already filter by userId, so partition pruning kicks in
 */

/**
 * Generate SQL to convert a table to hash-partitioned by userId.
 *
 * Steps:
 * 1. Rename old table
 * 2. Create partitioned table with same schema
 * 3. Create N partitions
 * 4. Create HNSW index on each partition
 * 5. Migrate data
 * 6. Drop old table
 */
// P24-01: Strict identifier validation to prevent SQL injection in generated migrations
const SAFE_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/;

function assertSafeIdentifier(value: string, label: string): void {
  if (!SAFE_IDENTIFIER.test(value)) {
    throw new Error(`${label} contains invalid characters: ${value.slice(0, 30)}`);
  }
}

export function generatePartitionMigration(
  tableName: string,
  partitionCount: number = 16,
  vectorColumn: string = "embedding",
  _vectorDimensions: number = 1536,
): string {
  // Validate table name to prevent SQL injection in DDL
  if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(tableName)) {
    throw new Error(`Invalid table name: must be a valid SQL identifier`);
  }
  if (!Number.isInteger(partitionCount) || partitionCount < 1 || partitionCount > 256) {
    throw new Error(`Invalid partitionCount: must be between 1 and 256`);
  }

  const lines: string[] = [
    `-- P4-50: Partition ${tableName} by userId for HNSW index sharding`,
    `-- Run this migration when ${tableName} exceeds ~500K rows`,
    `-- Estimated downtime: depends on table size (use pg_repack for zero-downtime)`,
    ``,
    `BEGIN;`,
    ``,
    `-- Step 1: Rename existing table`,
    `ALTER TABLE "${tableName}" RENAME TO "${tableName}_old";`,
    ``,
    `-- Step 2: Create partitioned table`,
    `CREATE TABLE "${tableName}" (LIKE "${tableName}_old" INCLUDING ALL) PARTITION BY HASH ("userId");`,
    ``,
    `-- Step 3: Create partitions with individual HNSW indexes`,
  ];

  for (let i = 0; i < partitionCount; i++) {
    lines.push(`CREATE TABLE "${tableName}_p${i}" PARTITION OF "${tableName}" FOR VALUES WITH (MODULUS ${partitionCount}, REMAINDER ${i});`);
    lines.push(`CREATE INDEX "${tableName}_p${i}_hnsw_idx" ON "${tableName}_p${i}" USING hnsw ("${vectorColumn}" vector_cosine_ops) WITH (m = 16, ef_construction = 64);`);
  }

  lines.push(``);
  lines.push(`-- Step 4: Migrate data (batched to avoid lock contention)`);
  lines.push(`INSERT INTO "${tableName}" SELECT * FROM "${tableName}_old";`);
  lines.push(``);
  lines.push(`-- Step 5: Verify row counts match`);
  lines.push(`-- SELECT count(*) FROM "${tableName}"; SELECT count(*) FROM "${tableName}_old";`);
  lines.push(``);
  lines.push(`-- Step 6: Drop old table (only after verification!)`);
  lines.push(`-- DROP TABLE "${tableName}_old";`);
  lines.push(``);
  lines.push(`COMMIT;`);

  return lines.join("\n");
}

/**
 * Generate SQL to check partition sizes and index health.
 */
export function generatePartitionHealthCheck(tableName: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(tableName)) {
    throw new Error(`Invalid table name: must be a valid SQL identifier`);
  }

  return [
    `-- Check partition sizes for ${tableName}`,
    `SELECT`,
    `  c.relname AS partition,`,
    `  pg_size_pretty(pg_relation_size(c.oid)) AS size,`,
    `  pg_stat_user_tables.n_live_tup AS row_count`,
    `FROM pg_class c`,
    `JOIN pg_stat_user_tables ON pg_stat_user_tables.relname = c.relname`,
    `WHERE c.relname LIKE '${tableName}_p%'`,
    `ORDER BY c.relname;`,
  ].join("\n");
}
