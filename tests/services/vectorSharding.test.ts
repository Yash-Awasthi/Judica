import { describe, it, expect } from "vitest";
import {
  getShardName,
  generateShardDDL,
  needsRebalance,
  planRebalance,
  generateMigrationSQL,
} from "../../src/services/vectorSharding.service.js";
import type { ShardConfig, ShardInfo } from "../../src/services/vectorSharding.service.js";

describe("Vector Sharding Service", () => {
  describe("getShardName", () => {
    it("returns correct format for by_workspace strategy", () => {
      expect(getShardName("ws123", "by_workspace")).toBe("vectors_by_workspace_ws123");
    });

    it("returns correct format for by_user strategy", () => {
      expect(getShardName("user42", "by_user")).toBe("vectors_by_user_user42");
    });

    it("returns correct format for by_kb strategy", () => {
      expect(getShardName("kb99", "by_kb")).toBe("vectors_by_kb_kb99");
    });

    it("defaults to by_workspace strategy", () => {
      expect(getShardName("abc")).toBe("vectors_by_workspace_abc");
    });

    it("includes the entity ID in the name", () => {
      const name = getShardName("my_entity_123", "by_user");
      expect(name).toContain("my_entity_123");
    });
  });

  describe("generateShardDDL", () => {
    it("generates valid DDL with CREATE TABLE", () => {
      const ddl = generateShardDDL("shard_test");
      expect(ddl).toContain("CREATE TABLE IF NOT EXISTS");
      expect(ddl).toContain('"shard_test"');
    });

    it("includes HNSW index creation", () => {
      const ddl = generateShardDDL("shard_test");
      expect(ddl).toContain("CREATE INDEX IF NOT EXISTS");
      expect(ddl).toContain('"idx_shard_test_hnsw"');
      expect(ddl).toContain("USING hnsw");
      expect(ddl).toContain("vector_cosine_ops");
    });

    it("includes metadata GIN index", () => {
      const ddl = generateShardDDL("shard_test");
      expect(ddl).toContain('"idx_shard_test_metadata"');
      expect(ddl).toContain("USING gin");
    });

    it("uses default dimensions of 1536", () => {
      const ddl = generateShardDDL("shard_test");
      expect(ddl).toContain("vector(1536)");
    });

    it("uses custom dimensions when specified", () => {
      const ddl = generateShardDDL("shard_test", 768);
      expect(ddl).toContain("vector(768)");
    });

    it("accepts dimension = 1 (minimum)", () => {
      const ddl = generateShardDDL("shard_test", 1);
      expect(ddl).toContain("vector(1)");
    });

    it("accepts dimension = 4096 (maximum)", () => {
      const ddl = generateShardDDL("shard_test", 4096);
      expect(ddl).toContain("vector(4096)");
    });

    it("rejects dimension = 0", () => {
      expect(() => generateShardDDL("shard_test", 0)).toThrow("Invalid dimensions");
    });

    it("rejects negative dimensions", () => {
      expect(() => generateShardDDL("shard_test", -1)).toThrow("Invalid dimensions");
    });

    it("rejects dimensions > 4096", () => {
      expect(() => generateShardDDL("shard_test", 4097)).toThrow("Invalid dimensions");
    });

    it("rejects non-integer dimensions", () => {
      expect(() => generateShardDDL("shard_test", 1.5)).toThrow("Invalid dimensions");
    });

    it("rejects NaN dimensions", () => {
      expect(() => generateShardDDL("shard_test", NaN)).toThrow("Invalid dimensions");
    });

    it("rejects shard names with SQL injection attempts (semicolons)", () => {
      expect(() => generateShardDDL("shard; DROP TABLE")).toThrow("Invalid shard name");
    });

    it("rejects shard names with spaces", () => {
      expect(() => generateShardDDL("shard name")).toThrow("Invalid shard name");
    });

    it("rejects shard names starting with a number", () => {
      expect(() => generateShardDDL("123shard")).toThrow("Invalid shard name");
    });

    it("rejects shard names with hyphens", () => {
      expect(() => generateShardDDL("shard-name")).toThrow("Invalid shard name");
    });

    it("rejects empty shard names", () => {
      expect(() => generateShardDDL("")).toThrow("Invalid shard name");
    });

    it("rejects shard names exceeding 63 characters", () => {
      const longName = "a".repeat(64);
      expect(() => generateShardDDL(longName)).toThrow("Invalid shard name");
    });

    it("accepts shard names of exactly 63 characters", () => {
      const name = "a".repeat(63);
      expect(() => generateShardDDL(name)).not.toThrow();
    });

    it("accepts shard names with underscores and alphanumeric chars", () => {
      expect(() => generateShardDDL("valid_shard_123")).not.toThrow();
    });

    it("accepts shard names starting with underscore", () => {
      expect(() => generateShardDDL("_private_shard")).not.toThrow();
    });

    it("includes required table columns (id, content, embedding, metadata, created_at)", () => {
      const ddl = generateShardDDL("shard_test");
      expect(ddl).toContain("id UUID PRIMARY KEY");
      expect(ddl).toContain("content TEXT NOT NULL");
      expect(ddl).toContain("embedding vector");
      expect(ddl).toContain("metadata JSONB");
      expect(ddl).toContain("created_at TIMESTAMPTZ");
    });

    it("includes HNSW parameters (m=16, ef_construction=64)", () => {
      const ddl = generateShardDDL("shard_test");
      expect(ddl).toContain("m = 16");
      expect(ddl).toContain("ef_construction = 64");
    });
  });

  describe("needsRebalance", () => {
    const defaultConfig: ShardConfig = {
      strategy: "by_workspace",
      maxVectorsPerShard: 1_000_000,
      rebalanceThreshold: 0.85,
    };

    const makeShard = (vectorCount: number): ShardInfo => ({
      id: "shard-1",
      ownerId: "owner-1",
      vectorCount,
      indexSize: 1024,
      lastReindexed: null,
      isHealthy: true,
    });

    it("returns true when at threshold (85%)", () => {
      expect(needsRebalance(makeShard(850_000), defaultConfig)).toBe(true);
    });

    it("returns true when above threshold", () => {
      expect(needsRebalance(makeShard(900_000), defaultConfig)).toBe(true);
    });

    it("returns false when below threshold", () => {
      expect(needsRebalance(makeShard(849_999), defaultConfig)).toBe(false);
    });

    it("returns false for empty shard", () => {
      expect(needsRebalance(makeShard(0), defaultConfig)).toBe(false);
    });

    it("uses default config when none provided", () => {
      // Default: 1M max, 0.85 threshold -> 850k triggers
      expect(needsRebalance(makeShard(850_000))).toBe(true);
      expect(needsRebalance(makeShard(849_999))).toBe(false);
    });

    it("respects custom config", () => {
      const config: ShardConfig = {
        strategy: "by_user",
        maxVectorsPerShard: 100,
        rebalanceThreshold: 0.5,
      };
      expect(needsRebalance(makeShard(50), config)).toBe(true);
      expect(needsRebalance(makeShard(49), config)).toBe(false);
    });
  });

  describe("planRebalance", () => {
    const defaultConfig: ShardConfig = {
      strategy: "by_workspace",
      maxVectorsPerShard: 1_000_000,
      rebalanceThreshold: 0.85,
    };

    const makeShard = (vectorCount: number): ShardInfo => ({
      id: "shard-1",
      ownerId: "owner-1",
      vectorCount,
      indexSize: 1024,
      lastReindexed: null,
      isHealthy: true,
    });

    it("returns 'none' when below threshold", () => {
      const result = planRebalance(makeShard(500_000), defaultConfig);
      expect(result.action).toBe("none");
      expect(result.reason).toContain("within limits");
    });

    it("returns 'archive' when at threshold but below 150%", () => {
      const result = planRebalance(makeShard(900_000), defaultConfig);
      expect(result.action).toBe("archive");
      expect(result.reason).toContain("approaching limit");
    });

    it("returns 'archive' at exactly threshold", () => {
      const result = planRebalance(makeShard(850_000), defaultConfig);
      expect(result.action).toBe("archive");
    });

    it("returns 'split' when above 150% of max", () => {
      const result = planRebalance(makeShard(1_500_001), defaultConfig);
      expect(result.action).toBe("split");
      expect(result.reason).toContain("50% over limit");
    });

    it("returns 'archive' at exactly 150% (boundary)", () => {
      // At exactly 150%, vectorCount === max * 1.5 -> not strictly greater, so "archive"
      const result = planRebalance(makeShard(1_500_000), defaultConfig);
      expect(result.action).toBe("archive");
    });

    it("uses default config when none provided", () => {
      const result = planRebalance(makeShard(500_000));
      expect(result.action).toBe("none");
    });

    it("includes vector count in split reason", () => {
      const result = planRebalance(makeShard(2_000_000), defaultConfig);
      expect(result.action).toBe("split");
      expect(result.reason).toContain("2000000");
    });
  });

  describe("generateMigrationSQL", () => {
    it("generates INSERT...SELECT statement", () => {
      const sql = generateMigrationSQL("from_shard", "to_shard", "created_at < '2024-01-01'");
      expect(sql).toContain('INSERT INTO "to_shard"');
      expect(sql).toContain('FROM "from_shard"');
    });

    it("generates DELETE statement for source shard", () => {
      const sql = generateMigrationSQL("from_shard", "to_shard", "created_at < '2024-01-01'");
      expect(sql).toContain('DELETE FROM "from_shard"');
    });

    it("generates REINDEX statement for source shard HNSW index", () => {
      const sql = generateMigrationSQL("from_shard", "to_shard", "created_at < '2024-01-01'");
      expect(sql).toContain('REINDEX INDEX "idx_from_shard_hnsw"');
    });

    it("includes the condition in WHERE clauses", () => {
      const condition = "created_at < '2024-01-01'";
      const sql = generateMigrationSQL("from_shard", "to_shard", condition);
      // Condition appears in both INSERT...SELECT and DELETE
      const matches = sql.split(condition);
      expect(matches.length).toBeGreaterThanOrEqual(3); // 2 occurrences -> 3 parts
    });

    it("selects correct columns (id, content, embedding, metadata, created_at)", () => {
      const sql = generateMigrationSQL("from_shard", "to_shard", "id IS NOT NULL");
      expect(sql).toContain("id, content, embedding, metadata, created_at");
    });

    it("validates fromShard name", () => {
      expect(() =>
        generateMigrationSQL("invalid shard!", "to_shard", "true")
      ).toThrow("Invalid shard name");
    });

    it("validates toShard name", () => {
      expect(() =>
        generateMigrationSQL("from_shard", "invalid;shard", "true")
      ).toThrow("Invalid shard name");
    });

    it("rejects semicolons in condition (SQL injection)", () => {
      expect(() =>
        generateMigrationSQL("from_shard", "to_shard", "1=1; DROP TABLE users")
      ).toThrow("Condition contains disallowed SQL patterns");
    });

    it("rejects SQL comments (--) in condition", () => {
      expect(() =>
        generateMigrationSQL("from_shard", "to_shard", "1=1 -- comment")
      ).toThrow("Condition contains disallowed SQL patterns");
    });

    it("rejects DROP keyword in condition", () => {
      expect(() =>
        generateMigrationSQL("from_shard", "to_shard", "DROP TABLE users")
      ).toThrow("Condition contains disallowed SQL patterns");
    });

    it("rejects TRUNCATE keyword in condition", () => {
      expect(() =>
        generateMigrationSQL("from_shard", "to_shard", "TRUNCATE TABLE users")
      ).toThrow("Condition contains disallowed SQL patterns");
    });

    it("rejects ALTER keyword in condition", () => {
      expect(() =>
        generateMigrationSQL("from_shard", "to_shard", "ALTER TABLE users ADD col INT")
      ).toThrow("Condition contains disallowed SQL patterns");
    });

    it("rejects CREATE keyword in condition", () => {
      expect(() =>
        generateMigrationSQL("from_shard", "to_shard", "CREATE TABLE evil(x int)")
      ).toThrow("Condition contains disallowed SQL patterns");
    });

    it("rejects dangerous patterns case-insensitively", () => {
      expect(() =>
        generateMigrationSQL("from_shard", "to_shard", "drop table users")
      ).toThrow("Condition contains disallowed SQL patterns");
      expect(() =>
        generateMigrationSQL("from_shard", "to_shard", "DROP TABLE users")
      ).toThrow("Condition contains disallowed SQL patterns");
      expect(() =>
        generateMigrationSQL("from_shard", "to_shard", "Drop Table Users")
      ).toThrow("Condition contains disallowed SQL patterns");
    });

    it("allows valid conditions", () => {
      expect(() =>
        generateMigrationSQL("from_shard", "to_shard", "created_at < NOW()")
      ).not.toThrow();
    });

    it("allows conditions with comparison operators", () => {
      expect(() =>
        generateMigrationSQL("from_shard", "to_shard", "id = 'abc-123' AND created_at > '2024-01-01'")
      ).not.toThrow();
    });
  });
});
