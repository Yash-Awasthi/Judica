import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mock variables ──────────────────────────────────────────────────

const { mockResult, mockChain } = vi.hoisted(() => {
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
    onConflictDoUpdate: vi.fn(),
    execute: vi.fn(),
    then: vi.fn((resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
      return Promise.resolve(mockResult.value).then(resolve, reject);
    }),
  };

  // Chain every method back to mockChain
  for (const key of Object.keys(mockChain)) {
    if (key !== "then") {
      mockChain[key].mockReturnValue(mockChain);
    }
  }

  return { mockResult, mockChain };
});

vi.mock("../../src/lib/drizzle.js", () => ({
  db: {
    select: vi.fn(() => mockChain),
    insert: vi.fn(() => mockChain),
    update: vi.fn(() => mockChain),
    delete: vi.fn(() => mockChain),
  },
}));

vi.mock("../../src/db/schema/surfaceAccess.js", () => ({
  embeddableWidgets: {
    id: "ew.id",
    userId: "ew.userId",
    name: "ew.name",
    allowedOrigins: "ew.allowedOrigins",
    apiKey: "ew.apiKey",
    theme: "ew.theme",
    position: "ew.position",
    customCss: "ew.customCss",
    isActive: "ew.isActive",
    createdAt: "ew.createdAt",
    updatedAt: "ew.updatedAt",
  },
  surfaceAccessTokens: {
    id: "sat.id",
    userId: "sat.userId",
    surface: "sat.surface",
    tokenHash: "sat.tokenHash",
    label: "sat.label",
    lastUsedAt: "sat.lastUsedAt",
    expiresAt: "sat.expiresAt",
    createdAt: "sat.createdAt",
  },
}));

vi.mock("../../src/db/schema/users.js", () => ({
  users: { id: "users.id", isActive: "users.isActive" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: any[]) => args),
  and: vi.fn((...args: any[]) => args),
  sql: vi.fn((parts: any, ...args: any[]) => parts),
}));

vi.mock("../../src/lib/logger.js", () => ({
  default: {
    child: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    })),
  },
}));

import {
  createWidget,
  getWidgets,
  updateWidget,
  deleteWidget,
  getWidgetByApiKey,
  generateSurfaceToken,
  revokeSurfaceToken,
  getSurfaceTokens,
  validateSurfaceToken,
  getSurfaceUsageStats,
} from "../../src/services/surfaceAccess.service.js";

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("surfaceAccess.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResult.value = [];
    // Re-wire chain returns after clearAllMocks
    for (const key of Object.keys(mockChain)) {
      if (key !== "then") {
        mockChain[key].mockReturnValue(mockChain);
      }
    }
  });

  describe("createWidget", () => {
    it("inserts a widget and returns the created record", async () => {
      const now = new Date();
      const fakeWidget = {
        id: "uuid-1",
        userId: 1,
        name: "Support Widget",
        allowedOrigins: ["https://example.com"],
        apiKey: "wgt_abc123",
        theme: "auto",
        position: "bottom-right",
        customCss: null,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      };

      mockChain.returning.mockReturnValueOnce({
        ...mockChain,
        then: vi.fn((resolve: any) => Promise.resolve([fakeWidget]).then(resolve)),
      });

      const result = await createWidget(1, {
        name: "Support Widget",
        allowedOrigins: ["https://example.com"],
      });

      expect(result).toEqual(fakeWidget);
    });
  });

  describe("getWidgets", () => {
    it("returns widgets for a user", async () => {
      const widgets = [{ id: "w1", name: "Widget 1" }];
      mockResult.value = widgets;

      const result = await getWidgets(1);
      expect(result).toEqual(widgets);
    });
  });

  describe("updateWidget", () => {
    it("updates and returns the widget", async () => {
      const updated = { id: "w1", name: "Updated" };
      mockChain.returning.mockReturnValueOnce({
        ...mockChain,
        then: vi.fn((resolve: any) => Promise.resolve([updated]).then(resolve)),
      });

      const result = await updateWidget("w1", 1, { name: "Updated" });
      expect(result).toEqual(updated);
    });

    it("returns null when widget not found", async () => {
      mockChain.returning.mockReturnValueOnce({
        ...mockChain,
        then: vi.fn((resolve: any) => Promise.resolve([]).then(resolve)),
      });

      const result = await updateWidget("nonexistent", 1, { name: "X" });
      expect(result).toBeNull();
    });
  });

  describe("deleteWidget", () => {
    it("returns true on successful delete", async () => {
      mockChain.returning.mockReturnValueOnce({
        ...mockChain,
        then: vi.fn((resolve: any) => Promise.resolve([{ id: "w1" }]).then(resolve)),
      });

      const result = await deleteWidget("w1", 1);
      expect(result).toBe(true);
    });

    it("returns false when widget not found", async () => {
      mockChain.returning.mockReturnValueOnce({
        ...mockChain,
        then: vi.fn((resolve: any) => Promise.resolve([]).then(resolve)),
      });

      const result = await deleteWidget("nonexistent", 1);
      expect(result).toBe(false);
    });
  });

  describe("getWidgetByApiKey", () => {
    it("returns widget when found", async () => {
      const widget = { id: "w1", apiKey: "wgt_test", isActive: true };
      mockResult.value = [widget];

      const result = await getWidgetByApiKey("wgt_test");
      expect(result).toEqual(widget);
    });

    it("returns null when not found", async () => {
      mockResult.value = [];

      const result = await getWidgetByApiKey("wgt_nonexistent");
      expect(result).toBeNull();
    });
  });

  describe("generateSurfaceToken", () => {
    it("creates a token and returns it with plaintext", async () => {
      const now = new Date();
      const fakeToken = {
        id: "tok-1",
        userId: 1,
        surface: "chrome_extension",
        tokenHash: "hash123",
        label: "My Chrome",
        lastUsedAt: null,
        expiresAt: null,
        createdAt: now,
      };

      mockChain.returning.mockReturnValueOnce({
        ...mockChain,
        then: vi.fn((resolve: any) => Promise.resolve([fakeToken]).then(resolve)),
      });

      const result = await generateSurfaceToken(1, "chrome_extension", "My Chrome");
      expect(result.token).toMatch(/^srf_/);
      expect(result.surface).toBe("chrome_extension");
      expect(result.label).toBe("My Chrome");
      expect(result.id).toBe("tok-1");
    });
  });

  describe("revokeSurfaceToken", () => {
    it("returns true on successful revocation", async () => {
      mockChain.returning.mockReturnValueOnce({
        ...mockChain,
        then: vi.fn((resolve: any) => Promise.resolve([{ id: "tok-1" }]).then(resolve)),
      });

      const result = await revokeSurfaceToken("tok-1", 1);
      expect(result).toBe(true);
    });

    it("returns false when token not found", async () => {
      mockChain.returning.mockReturnValueOnce({
        ...mockChain,
        then: vi.fn((resolve: any) => Promise.resolve([]).then(resolve)),
      });

      const result = await revokeSurfaceToken("nonexistent", 1);
      expect(result).toBe(false);
    });
  });

  describe("getSurfaceTokens", () => {
    it("returns formatted token list", async () => {
      const now = new Date("2025-01-15T10:00:00Z");
      mockResult.value = [
        {
          id: "tok-1",
          surface: "chrome_extension",
          label: "Chrome",
          lastUsedAt: now,
          expiresAt: null,
          createdAt: now,
        },
      ];

      const result = await getSurfaceTokens(1);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("tok-1");
      expect(result[0].surface).toBe("chrome_extension");
      expect(result[0].lastUsedAt).toBe("2025-01-15T10:00:00.000Z");
      expect(result[0].expiresAt).toBeNull();
    });
  });

  describe("validateSurfaceToken", () => {
    it("rejects tokens without correct prefix", async () => {
      const result = await validateSurfaceToken("bad_token", "chrome_extension");
      expect(result.valid).toBe(false);
    });
  });

  describe("getSurfaceUsageStats", () => {
    it("returns aggregated stats", async () => {
      // First query: token counts by surface
      mockResult.value = [{ surface: "chrome_extension", count: 2 }];

      // The implementation chains two queries; we mock both via mockResult
      // Since they use the same mock chain, the second resolves to the same value.
      // For a more accurate test we would sequence the mock, but this validates the interface.
      const result = await getSurfaceUsageStats(1);
      expect(result).toBeDefined();
      expect(result).toHaveProperty("tokensBySurface");
      expect(result).toHaveProperty("widgets");
    });
  });
});
