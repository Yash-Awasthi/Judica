import { describe, it, expect } from "vitest";
import {
  generatePartitionMigration,
  generatePartitionHealthCheck,
} from "../../src/db/vectorPartitioning.js";

describe("vectorPartitioning", () => {
  // ─── generatePartitionMigration ──────────────────────────────────────────

  describe("generatePartitionMigration", () => {
    it("should generate valid SQL with default parameters", () => {
      const sql = generatePartitionMigration("Memory");
      expect(sql).toContain('ALTER TABLE "Memory" RENAME TO "Memory_old"');
      expect(sql).toContain("PARTITION BY HASH");
      expect(sql).toContain("BEGIN;");
      expect(sql).toContain("COMMIT;");
    });

    it("should create the correct number of partitions", () => {
      const sql = generatePartitionMigration("Memory", 4);
      // Should have 4 partition CREATE TABLE statements
      expect(sql).toContain('"Memory_p0"');
      expect(sql).toContain('"Memory_p1"');
      expect(sql).toContain('"Memory_p2"');
      expect(sql).toContain('"Memory_p3"');
      expect(sql).not.toContain('"Memory_p4"');
    });

    it("should default to 16 partitions", () => {
      const sql = generatePartitionMigration("Memory");
      expect(sql).toContain('"Memory_p15"');
      expect(sql).not.toContain('"Memory_p16"');
    });

    it("should create HNSW indexes for each partition", () => {
      const sql = generatePartitionMigration("TestTable", 3);
      expect(sql).toContain('"TestTable_p0_hnsw_idx"');
      expect(sql).toContain('"TestTable_p1_hnsw_idx"');
      expect(sql).toContain('"TestTable_p2_hnsw_idx"');
      expect(sql).toContain("USING hnsw");
      expect(sql).toContain("vector_cosine_ops");
    });

    it("should use the specified vector column name", () => {
      const sql = generatePartitionMigration("Memory", 2, "vec");
      expect(sql).toContain('"vec" vector_cosine_ops');
    });

    it("should include data migration step", () => {
      const sql = generatePartitionMigration("Memory", 2);
      expect(sql).toContain('INSERT INTO "Memory" SELECT * FROM "Memory_old"');
    });

    it("should include commented-out drop table step", () => {
      const sql = generatePartitionMigration("Memory", 2);
      expect(sql).toContain('-- DROP TABLE "Memory_old"');
    });

    it("should include MODULUS and REMAINDER for each partition", () => {
      const sql = generatePartitionMigration("T", 3);
      expect(sql).toContain("MODULUS 3, REMAINDER 0");
      expect(sql).toContain("MODULUS 3, REMAINDER 1");
      expect(sql).toContain("MODULUS 3, REMAINDER 2");
    });

    // ─── Validation ──────────────────────────────────────────────────────

    it("should reject table names with SQL injection characters", () => {
      expect(() => generatePartitionMigration("table; DROP TABLE users--")).toThrow(
        "Invalid table name",
      );
    });

    it("should reject empty table name", () => {
      expect(() => generatePartitionMigration("")).toThrow("Invalid table name");
    });

    it("should reject table names starting with a digit", () => {
      expect(() => generatePartitionMigration("1table")).toThrow("Invalid table name");
    });

    it("should accept valid identifier with underscores", () => {
      const sql = generatePartitionMigration("my_table_v2");
      expect(sql).toContain('"my_table_v2"');
    });

    it("should reject partitionCount of 0", () => {
      expect(() => generatePartitionMigration("Memory", 0)).toThrow(
        "Invalid partitionCount",
      );
    });

    it("should reject partitionCount greater than 256", () => {
      expect(() => generatePartitionMigration("Memory", 257)).toThrow(
        "Invalid partitionCount",
      );
    });

    it("should reject non-integer partitionCount", () => {
      expect(() => generatePartitionMigration("Memory", 3.5)).toThrow(
        "Invalid partitionCount",
      );
    });

    it("should reject negative partitionCount", () => {
      expect(() => generatePartitionMigration("Memory", -1)).toThrow(
        "Invalid partitionCount",
      );
    });

    it("should accept partitionCount of 1 (minimum)", () => {
      const sql = generatePartitionMigration("Memory", 1);
      expect(sql).toContain('"Memory_p0"');
      expect(sql).not.toContain('"Memory_p1"');
    });

    it("should accept partitionCount of 256 (maximum)", () => {
      const sql = generatePartitionMigration("Memory", 256);
      expect(sql).toContain('"Memory_p255"');
      expect(sql).not.toContain('"Memory_p256"');
    });

    it("should include HNSW tuning parameters m=16 and ef_construction=64", () => {
      const sql = generatePartitionMigration("Memory", 1);
      expect(sql).toContain("m = 16");
      expect(sql).toContain("ef_construction = 64");
    });
  });

  // ─── generatePartitionHealthCheck ────────────────────────────────────────

  describe("generatePartitionHealthCheck", () => {
    it("should generate a partition health check query", () => {
      const sql = generatePartitionHealthCheck("Memory");
      expect(sql).toContain("pg_size_pretty");
      expect(sql).toContain("n_live_tup");
      expect(sql).toContain("Memory_p%");
    });

    it("should reject invalid table names", () => {
      expect(() => generatePartitionHealthCheck("bad;name")).toThrow(
        "Invalid table name",
      );
    });

    it("should include ORDER BY clause", () => {
      const sql = generatePartitionHealthCheck("Memory");
      expect(sql).toContain("ORDER BY c.relname");
    });

    it("should reference the correct LIKE pattern", () => {
      const sql = generatePartitionHealthCheck("CodeFile");
      expect(sql).toContain("CodeFile_p%");
    });

    it("should include partition size and row count columns", () => {
      const sql = generatePartitionHealthCheck("Memory");
      expect(sql).toContain("size");
      expect(sql).toContain("row_count");
    });
  });
});
