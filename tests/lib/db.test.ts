import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock pg
vi.mock("pg", () => {
  const PoolMock = vi.fn().mockImplementation(function(this: any) {
    this.on = vi.fn();
    this.totalCount = 5;
    this.idleCount = 2;
    (PoolMock as any).mockInstance = this;
  });
  return {
    default: { Pool: PoolMock },
    Pool: PoolMock
  };
});

// Mock drizzle
vi.mock("drizzle-orm/node-postgres", () => ({
  drizzle: vi.fn(() => ({ query: {} })),
}));

// Mock logger
vi.mock("../../src/lib/logger.js", () => ({
  default: { error: vi.fn(), debug: vi.fn() }
}));

describe("Database Utilities", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("should initialize pool with correct config from env", async () => {
    // Set env before import
    process.env.DATABASE_URL = "postgres://user:pass@host:5432/db?connection_limit=10";
    
    const { pool } = await import("../../src/lib/db.js");
    const { default: pg } = await import("pg");
    
    expect(pg.Pool).toHaveBeenCalledWith(expect.objectContaining({
      connectionString: "postgres://user:pass@host:5432/db?connection_limit=10",
      max: 10
    }));
    expect(pool.on).toHaveBeenCalledWith("error", expect.any(Function));
    expect(pool.on).toHaveBeenCalledWith("acquire", expect.any(Function));
  });

  it("should initialize drizzle db with pool", async () => {
    const { pool } = await import("../../src/lib/db.js");
    const { db } = await import("../../src/lib/drizzle.js");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    
    expect(drizzle).toHaveBeenCalledWith(pool, expect.objectContaining({
      schema: expect.any(Object)
    }));
    expect(db).toBeDefined();
  });

  it("should trigger pool events", async () => {
    await import("../../src/lib/db.js");
    const { Pool } = await import("pg");
    const { default: logger } = await import("../../src/lib/logger.js");
    
    const pool = (Pool as any).mockInstance;
    // Find the acquire callback
    const callbacks = (pool.on as any).mock.calls;
    const acquireCb = callbacks.find((c: any) => c[0] === "acquire")?.[1];
    const errorCb = callbacks.find((c: any) => c[0] === "error")?.[1];
    
    if (acquireCb) acquireCb();
    expect(logger.debug).toHaveBeenCalled();
    
    if (errorCb) errorCb(new Error("Pool error"));
    expect(logger.error).toHaveBeenCalled();
  });
});
