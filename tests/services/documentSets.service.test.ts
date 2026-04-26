import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mock variables ─────────────────────────────────────────────────
const { mockChain, mockResult } = vi.hoisted(() => {
  const mockResult = { value: [] as unknown[] };

  const mockChain: Record<string, any> = {
    select: vi.fn(),
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
    offset: vi.fn(),
    leftJoin: vi.fn(),
    groupBy: vi.fn(),
    orderBy: vi.fn(),
    insert: vi.fn(),
    values: vi.fn(),
    update: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
    returning: vi.fn(),
    onConflictDoNothing: vi.fn(),
    execute: vi.fn(),
    then: vi.fn((resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
      return Promise.resolve(mockResult.value).then(resolve, reject);
    }),
  };

  // Wire up chaining — every method returns the chain itself
  for (const key of Object.keys(mockChain)) {
    if (key !== "then") {
      (mockChain[key] as any).mockReturnValue(mockChain);
    }
  }

  return { mockChain, mockResult };
});

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("../../src/lib/drizzle.js", () => ({
  db: mockChain,
}));

vi.mock("../../src/db/schema/documentSets.js", () => ({
  documentSets: {
    id: "documentSets.id",
    name: "documentSets.name",
    description: "documentSets.description",
    userId: "documentSets.userId",
    isPublic: "documentSets.isPublic",
    createdAt: "documentSets.createdAt",
    updatedAt: "documentSets.updatedAt",
  },
  documentSetMembers: {
    id: "documentSetMembers.id",
    documentSetId: "documentSetMembers.documentSetId",
    documentId: "documentSetMembers.documentId",
    documentTitle: "documentSetMembers.documentTitle",
    documentSource: "documentSetMembers.documentSource",
    addedAt: "documentSetMembers.addedAt",
  },
  conversationDocumentSets: {
    conversationId: "conversationDocumentSets.conversationId",
    documentSetId: "conversationDocumentSets.documentSetId",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: any[]) => ({ op: "eq", args })),
  and: vi.fn((...args: any[]) => ({ op: "and", args })),
  or: vi.fn((...args: any[]) => ({ op: "or", args })),
  desc: vi.fn((col: any) => ({ op: "desc", col })),
  inArray: vi.fn((...args: any[]) => ({ op: "inArray", args })),
  count: vi.fn(() => "count"),
}));

vi.mock("../../src/lib/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ─── Import service under test ──────────────────────────────────────────────

import {
  createDocumentSet,
  getDocumentSets,
  getDocumentSetById,
  updateDocumentSet,
  deleteDocumentSet,
  addDocumentsToSet,
  removeDocumentFromSet,
  getDocumentSetMembers,
  getDocumentSetsForConversation,
  linkDocumentSetToConversation,
  unlinkDocumentSetFromConversation,
  filterDocumentsBySet,
} from "../../src/services/documentSets.service.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function setChainResult(val: unknown[]) {
  mockResult.value = val;
  mockChain.then.mockImplementation(
    (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(val).then(resolve, reject),
  );
}

function setChainResults(...results: unknown[][]) {
  let callIdx = 0;
  mockChain.then.mockImplementation(
    (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
      const val = results[callIdx] ?? [];
      callIdx++;
      return Promise.resolve(val).then(resolve, reject);
    },
  );
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("DocumentSets Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-wire chaining after clearAllMocks
    for (const key of Object.keys(mockChain)) {
      if (key !== "then") {
        (mockChain[key] as any).mockReturnValue(mockChain);
      }
    }
    setChainResult([]);
  });

  // ────────────────────────────── createDocumentSet ──────────────────────────
  describe("createDocumentSet", () => {
    it("creates a set and returns its id", async () => {
      setChainResult([{ id: "uuid-1" }]);

      const result = await createDocumentSet({
        name: "Legal Docs",
        description: "All legal documents",
        userId: 1,
      });

      expect(result).toEqual({ id: "uuid-1" });
      expect(mockChain.insert).toHaveBeenCalled();
      expect(mockChain.values).toHaveBeenCalled();
      expect(mockChain.returning).toHaveBeenCalled();
    });

    it("throws on db error", async () => {
      mockChain.then.mockImplementation(
        (_resolve: any, reject?: (e: unknown) => void) =>
          Promise.reject(new Error("db error")).catch(reject ?? (() => {})),
      );

      await expect(
        createDocumentSet({ name: "Fail", userId: 1 }),
      ).rejects.toThrow("db error");
    });
  });

  // ────────────────────────────── getDocumentSets ───────────────────────────
  describe("getDocumentSets", () => {
    it("returns list of sets for user", async () => {
      const sets = [
        { id: "s1", name: "Set 1", userId: 1, isPublic: false },
        { id: "s2", name: "Set 2", userId: 1, isPublic: true },
      ];
      setChainResult(sets);

      const result = await getDocumentSets(1);
      expect(result).toEqual(sets);
      expect(mockChain.select).toHaveBeenCalled();
      expect(mockChain.from).toHaveBeenCalled();
      expect(mockChain.orderBy).toHaveBeenCalled();
    });

    it("throws on db error", async () => {
      mockChain.then.mockImplementation(
        (_resolve: any, reject?: (e: unknown) => void) =>
          Promise.reject(new Error("db error")).catch(reject ?? (() => {})),
      );

      await expect(getDocumentSets(1)).rejects.toThrow("db error");
    });
  });

  // ────────────────────────────── getDocumentSetById ────────────────────────
  describe("getDocumentSetById", () => {
    it("returns set with member count", async () => {
      setChainResults(
        [{ id: "s1", name: "Legal", userId: 1, isPublic: false }],
        [{ value: 5 }],
      );

      const result = await getDocumentSetById("s1", 1);
      expect(result).toMatchObject({ id: "s1", name: "Legal", memberCount: 5 });
    });

    it("returns null when set not found", async () => {
      setChainResult([]);

      const result = await getDocumentSetById("nonexistent", 1);
      expect(result).toBeNull();
    });

    it("throws on db error", async () => {
      mockChain.then.mockImplementation(
        (_resolve: any, reject?: (e: unknown) => void) =>
          Promise.reject(new Error("db error")).catch(reject ?? (() => {})),
      );

      await expect(getDocumentSetById("s1", 1)).rejects.toThrow("db error");
    });
  });

  // ────────────────────────────── updateDocumentSet ─────────────────────────
  describe("updateDocumentSet", () => {
    it("returns true on successful update", async () => {
      mockChain.then.mockImplementation(
        (resolve: (v: unknown) => void) =>
          Promise.resolve({ rowCount: 1 }).then(resolve),
      );

      const result = await updateDocumentSet("s1", 1, { name: "Renamed" });
      expect(result).toBe(true);
      expect(mockChain.update).toHaveBeenCalled();
      expect(mockChain.set).toHaveBeenCalled();
    });

    it("returns false when no rows matched", async () => {
      mockChain.then.mockImplementation(
        (resolve: (v: unknown) => void) =>
          Promise.resolve({ rowCount: 0 }).then(resolve),
      );

      const result = await updateDocumentSet("nonexistent", 1, { name: "X" });
      expect(result).toBe(false);
    });

    it("throws on db error", async () => {
      mockChain.then.mockImplementation(
        (_resolve: any, reject?: (e: unknown) => void) =>
          Promise.reject(new Error("db error")).catch(reject ?? (() => {})),
      );

      await expect(
        updateDocumentSet("s1", 1, { name: "X" }),
      ).rejects.toThrow("db error");
    });
  });

  // ────────────────────────────── deleteDocumentSet ─────────────────────────
  describe("deleteDocumentSet", () => {
    it("returns true on successful delete", async () => {
      mockChain.then.mockImplementation(
        (resolve: (v: unknown) => void) =>
          Promise.resolve({ rowCount: 1 }).then(resolve),
      );

      const result = await deleteDocumentSet("s1", 1);
      expect(result).toBe(true);
      expect(mockChain.delete).toHaveBeenCalled();
    });

    it("returns false when nothing was deleted", async () => {
      mockChain.then.mockImplementation(
        (resolve: (v: unknown) => void) =>
          Promise.resolve({ rowCount: 0 }).then(resolve),
      );

      const result = await deleteDocumentSet("nonexistent", 1);
      expect(result).toBe(false);
    });

    it("throws on db error", async () => {
      mockChain.then.mockImplementation(
        (_resolve: any, reject?: (e: unknown) => void) =>
          Promise.reject(new Error("db error")).catch(reject ?? (() => {})),
      );

      await expect(deleteDocumentSet("s1", 1)).rejects.toThrow("db error");
    });
  });

  // ────────────────────────────── addDocumentsToSet ─────────────────────────
  describe("addDocumentsToSet", () => {
    it("adds documents and returns count", async () => {
      setChainResults(
        // ownership check
        [{ id: "s1" }],
        // insert returning
        [{ id: "m1" }, { id: "m2" }],
        // update updatedAt
        [],
      );

      const result = await addDocumentsToSet("s1", ["d1", "d2"], 1);
      expect(result).toEqual({ addedCount: 2 });
    });

    it("throws when set not owned by user", async () => {
      setChainResult([]);

      await expect(
        addDocumentsToSet("s1", ["d1"], 99),
      ).rejects.toThrow("Document set not found or not owned by user");
    });

    it("throws on db error", async () => {
      mockChain.then.mockImplementation(
        (_resolve: any, reject?: (e: unknown) => void) =>
          Promise.reject(new Error("db error")).catch(reject ?? (() => {})),
      );

      await expect(
        addDocumentsToSet("s1", ["d1"], 1),
      ).rejects.toThrow("db error");
    });
  });

  // ────────────────────────────── removeDocumentFromSet ─────────────────────
  describe("removeDocumentFromSet", () => {
    it("removes a document from the set", async () => {
      setChainResults(
        // ownership check
        [{ id: "s1" }],
        // delete
        [],
        // update updatedAt
        [],
      );

      await expect(
        removeDocumentFromSet("s1", "d1", 1),
      ).resolves.toBeUndefined();
    });

    it("throws when set not owned by user", async () => {
      setChainResult([]);

      await expect(
        removeDocumentFromSet("s1", "d1", 99),
      ).rejects.toThrow("Document set not found or not owned by user");
    });
  });

  // ────────────────────────────── getDocumentSetMembers ─────────────────────
  describe("getDocumentSetMembers", () => {
    it("returns members for accessible set", async () => {
      const members = [
        { id: "m1", documentSetId: "s1", documentId: "d1", documentTitle: "Doc 1" },
      ];
      setChainResults(
        // access check
        [{ id: "s1" }],
        // members
        members,
      );

      const result = await getDocumentSetMembers("s1", 1);
      expect(result).toEqual(members);
    });

    it("throws when set not accessible", async () => {
      setChainResult([]);

      await expect(
        getDocumentSetMembers("s1", 99),
      ).rejects.toThrow("Document set not found or not accessible");
    });
  });

  // ────────────────────────────── getDocumentSetsForConversation ────────────
  describe("getDocumentSetsForConversation", () => {
    it("returns linked sets", async () => {
      const sets = [{ id: "s1", name: "Legal" }];
      setChainResults(
        // links
        [{ documentSetId: "s1" }],
        // sets
        sets,
      );

      const result = await getDocumentSetsForConversation("c1");
      expect(result).toEqual(sets);
    });

    it("returns empty array when no links", async () => {
      setChainResult([]);

      const result = await getDocumentSetsForConversation("c1");
      expect(result).toEqual([]);
    });

    it("throws on db error", async () => {
      mockChain.then.mockImplementation(
        (_resolve: any, reject?: (e: unknown) => void) =>
          Promise.reject(new Error("db error")).catch(reject ?? (() => {})),
      );

      await expect(
        getDocumentSetsForConversation("c1"),
      ).rejects.toThrow("db error");
    });
  });

  // ────────────────────────────── linkDocumentSetToConversation ─────────────
  describe("linkDocumentSetToConversation", () => {
    it("inserts link without error", async () => {
      setChainResult([]);

      await expect(
        linkDocumentSetToConversation("c1", "s1"),
      ).resolves.toBeUndefined();
      expect(mockChain.insert).toHaveBeenCalled();
      expect(mockChain.onConflictDoNothing).toHaveBeenCalled();
    });

    it("throws on db error", async () => {
      mockChain.then.mockImplementation(
        (_resolve: any, reject?: (e: unknown) => void) =>
          Promise.reject(new Error("db error")).catch(reject ?? (() => {})),
      );

      await expect(
        linkDocumentSetToConversation("c1", "s1"),
      ).rejects.toThrow("db error");
    });
  });

  // ────────────────────────────── unlinkDocumentSetFromConversation ─────────
  describe("unlinkDocumentSetFromConversation", () => {
    it("deletes link without error", async () => {
      setChainResult([]);

      await expect(
        unlinkDocumentSetFromConversation("c1", "s1"),
      ).resolves.toBeUndefined();
      expect(mockChain.delete).toHaveBeenCalled();
    });

    it("throws on db error", async () => {
      mockChain.then.mockImplementation(
        (_resolve: any, reject?: (e: unknown) => void) =>
          Promise.reject(new Error("db error")).catch(reject ?? (() => {})),
      );

      await expect(
        unlinkDocumentSetFromConversation("c1", "s1"),
      ).rejects.toThrow("db error");
    });
  });

  // ────────────────────────────── filterDocumentsBySet ──────────────────────
  describe("filterDocumentsBySet", () => {
    it("returns only matching document IDs", async () => {
      setChainResult([{ documentId: "d1" }, { documentId: "d3" }]);

      const result = await filterDocumentsBySet("s1", ["d1", "d2", "d3"]);
      expect(result).toEqual(["d1", "d3"]);
    });

    it("returns empty array for empty input", async () => {
      const result = await filterDocumentsBySet("s1", []);
      expect(result).toEqual([]);
    });

    it("throws on db error", async () => {
      mockChain.then.mockImplementation(
        (_resolve: any, reject?: (e: unknown) => void) =>
          Promise.reject(new Error("db error")).catch(reject ?? (() => {})),
      );

      await expect(
        filterDocumentsBySet("s1", ["d1"]),
      ).rejects.toThrow("db error");
    });
  });
});
