import { describe, it, expect } from "vitest";

import {
  parseOffsetPagination,
  parseCursorPagination,
  buildOffsetMeta,
  buildCursorMeta,
} from "../../src/lib/pagination.js";

describe("Pagination", () => {
  // -------------------------------------------------------------------
  // parseOffsetPagination
  // -------------------------------------------------------------------
  describe("parseOffsetPagination", () => {
    it("returns defaults when no query params provided", () => {
      const result = parseOffsetPagination({});
      expect(result).toEqual({ page: 1, limit: 20, offset: 0 });
    });

    it("parses page and limit from query strings", () => {
      const result = parseOffsetPagination({ page: "3", limit: "10" });
      expect(result).toEqual({ page: 3, limit: 10, offset: 20 });
    });

    it("clamps limit to MAX_LIMIT of 100", () => {
      const result = parseOffsetPagination({ limit: "500" });
      expect(result.limit).toBe(100);
    });

    it("falls back to default for limit 0 (falsy parseInt result)", () => {
      const result = parseOffsetPagination({ limit: "0" });
      // parseInt("0") is 0 which is falsy, so || DEFAULT_LIMIT kicks in
      expect(result.limit).toBe(20);
    });

    it("clamps negative limit to 1", () => {
      const result = parseOffsetPagination({ limit: "-5" });
      expect(result.limit).toBe(1);
    });

    it("clamps limit of 1 correctly (minimum positive)", () => {
      const result = parseOffsetPagination({ limit: "1" });
      expect(result.limit).toBe(1);
    });

    it("clamps page to minimum 1", () => {
      const result = parseOffsetPagination({ page: "0" });
      expect(result.page).toBe(1);
    });

    it("clamps negative page to 1", () => {
      const result = parseOffsetPagination({ page: "-3" });
      expect(result.page).toBe(1);
    });

    it("handles non-numeric page gracefully", () => {
      const result = parseOffsetPagination({ page: "abc" });
      expect(result.page).toBe(1);
    });

    it("handles non-numeric limit gracefully", () => {
      const result = parseOffsetPagination({ limit: "xyz" });
      expect(result.limit).toBe(20);
    });

    it("calculates offset correctly for page 5 limit 25", () => {
      const result = parseOffsetPagination({ page: "5", limit: "25" });
      expect(result.offset).toBe(100); // (5-1)*25
    });

    it("handles undefined values in query", () => {
      const result = parseOffsetPagination({ page: undefined, limit: undefined });
      expect(result).toEqual({ page: 1, limit: 20, offset: 0 });
    });
  });

  // -------------------------------------------------------------------
  // parseCursorPagination
  // -------------------------------------------------------------------
  describe("parseCursorPagination", () => {
    it("returns null cursor and default limit when no params", () => {
      const result = parseCursorPagination({});
      expect(result).toEqual({ cursor: null, limit: 20 });
    });

    it("returns cursor string when provided", () => {
      const result = parseCursorPagination({ cursor: "abc123" });
      expect(result.cursor).toBe("abc123");
    });

    it("clamps limit to MAX_LIMIT of 100", () => {
      const result = parseCursorPagination({ limit: "200" });
      expect(result.limit).toBe(100);
    });

    it("falls back to default for limit 0 (falsy parseInt result)", () => {
      const result = parseCursorPagination({ limit: "0" });
      expect(result.limit).toBe(20);
    });

    it("clamps limit of 1 correctly (minimum positive)", () => {
      const result = parseCursorPagination({ limit: "1" });
      expect(result.limit).toBe(1);
    });

    it("uses default limit for non-numeric input", () => {
      const result = parseCursorPagination({ limit: "notanumber" });
      expect(result.limit).toBe(20);
    });

    it("returns null cursor for empty string", () => {
      const result = parseCursorPagination({ cursor: "" });
      expect(result.cursor).toBeNull();
    });
  });

  // -------------------------------------------------------------------
  // buildOffsetMeta
  // -------------------------------------------------------------------
  describe("buildOffsetMeta", () => {
    it("returns hasMore true when page*limit < total", () => {
      const meta = buildOffsetMeta(1, 20, 100);
      expect(meta.hasMore).toBe(true);
    });

    it("returns hasMore false when page*limit >= total", () => {
      const meta = buildOffsetMeta(5, 20, 100);
      expect(meta.hasMore).toBe(false);
    });

    it("returns hasMore false when page*limit > total", () => {
      const meta = buildOffsetMeta(10, 20, 100);
      expect(meta.hasMore).toBe(false);
    });

    it("includes page, limit, and total in response", () => {
      const meta = buildOffsetMeta(2, 10, 50);
      expect(meta).toEqual({
        page: 2,
        limit: 10,
        total: 50,
        hasMore: true,
      });
    });

    it("handles total of 0", () => {
      const meta = buildOffsetMeta(1, 20, 0);
      expect(meta.hasMore).toBe(false);
      expect(meta.total).toBe(0);
    });

    it("handles single-page result exactly at limit", () => {
      const meta = buildOffsetMeta(1, 20, 20);
      expect(meta.hasMore).toBe(false);
    });
  });

  // -------------------------------------------------------------------
  // buildCursorMeta
  // -------------------------------------------------------------------
  describe("buildCursorMeta", () => {
    it("returns nextCursor from last item id when items >= limit", () => {
      const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
      const meta = buildCursorMeta(3, items);
      expect(meta.nextCursor).toBe("c");
      expect(meta.hasMore).toBe(true);
    });

    it("returns null nextCursor when items < limit", () => {
      const items = [{ id: "a" }, { id: "b" }];
      const meta = buildCursorMeta(5, items);
      expect(meta.nextCursor).toBeNull();
      expect(meta.hasMore).toBe(false);
    });

    it("returns null nextCursor for empty items", () => {
      const meta = buildCursorMeta(10, []);
      expect(meta.nextCursor).toBeNull();
      expect(meta.hasMore).toBe(false);
    });

    it("uses custom cursorField when specified", () => {
      const items = [{ id: "a", createdAt: "2024-01-01" }, { id: "b", createdAt: "2024-01-02" }];
      const meta = buildCursorMeta(2, items, "createdAt");
      expect(meta.nextCursor).toBe("2024-01-02");
    });

    it("includes limit in response", () => {
      const meta = buildCursorMeta(15, []);
      expect(meta.limit).toBe(15);
    });

    it("P57-07: returns null nextCursor when cursor field is undefined", () => {
      const items = [{ id: "a" }, { id: "b", notId: "x" }];
      // cursorField "missing" doesn't exist on last item
      const meta = buildCursorMeta(2, items, "missing");
      expect(meta.nextCursor).toBeNull();
    });

    it("P57-07: returns null nextCursor when cursor field is null", () => {
      const items = [{ id: "a" }, { id: null }];
      const meta = buildCursorMeta(2, items);
      expect(meta.nextCursor).toBeNull();
    });

    it("converts numeric cursor values to string", () => {
      const items = [{ id: 1 }, { id: 2 }, { id: 3 }];
      const meta = buildCursorMeta(3, items);
      expect(meta.nextCursor).toBe("3");
      expect(typeof meta.nextCursor).toBe("string");
    });

    it("handles items with more items than limit (hasMore from length >= limit)", () => {
      const items = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
      const meta = buildCursorMeta(3, items);
      expect(meta.hasMore).toBe(true);
      expect(meta.nextCursor).toBe("d");
    });
  });
});
