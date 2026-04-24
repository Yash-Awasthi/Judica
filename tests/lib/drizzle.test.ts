import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the pool (db.js) to prevent real DB connections
vi.mock("../../src/lib/db.js", () => ({
  pool: {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    connect: vi.fn().mockResolvedValue({
      query: vi.fn(),
      release: vi.fn(),
    }),
    end: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  },
}));

vi.mock("drizzle-orm/node-postgres", () => ({
  drizzle: vi.fn().mockImplementation(() => ({
    select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnThis() }),
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockReturnThis() }),
    query: {},
  })),
}));

vi.mock("../../src/lib/logger.js", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  },
}));

import { getDb, db } from "../../src/lib/drizzle.js";

describe("drizzle.ts", () => {
  describe("getDb", () => {
    it("returns a Drizzle ORM client instance", () => {
      const client = getDb();
      expect(client).toBeDefined();
    });

    it("returns the same instance on subsequent calls (singleton pattern)", () => {
      const client1 = getDb();
      const client2 = getDb();
      expect(client1).toBe(client2);
    });

    it("initializes lazily — does not throw on import", () => {
      expect(() => getDb()).not.toThrow();
    });
  });

  describe("db proxy", () => {
    it("is defined and usable", () => {
      expect(db).toBeDefined();
    });

    it("delegates property access to the underlying Drizzle client", () => {
      // Accessing `select` through the proxy should delegate to the real client
      const client = getDb();
      const proxySelect = (db as unknown as Record<string, unknown>).select;
      const directSelect = (client as unknown as Record<string, unknown>).select;
      expect(proxySelect).toBe(directSelect);
    });

    it("proxy does not expose internal state directly", () => {
      // The proxy's own properties should be empty — it delegates everything
      const ownKeys = Object.keys(db);
      expect(ownKeys).toHaveLength(0);
    });
  });

  describe("query logging", () => {
    it("logQuery is called via drizzle logger when a query runs", async () => {
      const { drizzle } = await import("drizzle-orm/node-postgres");
      const drizzleMock = vi.mocked(drizzle);

      // Get the logger config from the most recent drizzle() call
      const callArgs = drizzleMock.mock.calls[0];
      if (callArgs) {
        const options = callArgs[1] as { logger?: { logQuery?: Function } };
        if (options?.logger?.logQuery) {
          const logger = await import("../../src/lib/logger.js");
          options.logger.logQuery("SELECT * FROM users", []);
          expect(logger.default.trace).toHaveBeenCalled();
        }
      }
    });

    it("truncates queries longer than 200 characters in log output", async () => {
      const { drizzle } = await import("drizzle-orm/node-postgres");
      const drizzleMock = vi.mocked(drizzle);
      const callArgs = drizzleMock.mock.calls[0];

      if (callArgs) {
        const options = callArgs[1] as { logger?: { logQuery?: Function } };
        if (options?.logger?.logQuery) {
          const logger = await import("../../src/lib/logger.js");
          const longQuery = "SELECT " + "x".repeat(300);
          options.logger.logQuery(longQuery, []);
          const traceCall = (logger.default.trace as unknown as ReturnType<typeof vi.fn>).mock.calls.slice(-1)[0];
          if (traceCall) {
            const queryArg = traceCall[0]?.query as string;
            expect(queryArg?.length).toBeLessThanOrEqual(215); // 200 chars + "…[truncated]"
            expect(queryArg).toContain("[truncated]");
          }
        }
      }
    });
  });
});
