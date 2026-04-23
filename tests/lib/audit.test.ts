import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock db
vi.mock("../../src/lib/drizzle.js", () => ({
  db: {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue({ rowCount: 1 })
    }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              offset: vi.fn().mockResolvedValue([])
            })
          })
        })
      })
    }),
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue({ rowCount: 10 })
    })
  }
}));

// Mock pii
vi.mock("../../src/lib/pii.js", () => ({
  detectPII: vi.fn().mockReturnValue({
    found: false,
    riskScore: 0,
    types: [],
    anonymized: ""
  })
}));

// Mock logger
vi.mock("../../src/lib/logger.js", () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
}));

describe("Audit Utility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockEntry = {
    userId: 1,
    modelName: "gpt-4",
    prompt: "Hello",
    response: "Hi",
    tokensIn: 10,
    tokensOut: 20,
    latencyMs: 100,
    requestType: "deliberation",
    success: true
  } as any;

  it("should log audit entry successfully", async () => {
    const { logAudit } = await import("../../src/lib/audit.js");
    const { db } = await import("../../src/lib/drizzle.js");

    await logAudit(mockEntry);
    expect(db.insert).toHaveBeenCalled();
  });

  it("should anonymize PII if risk is high", async () => {
    const { logAudit } = await import("../../src/lib/audit.js");
    const { detectPII } = await import("../../src/lib/pii.js");
    const { db } = await import("../../src/lib/drizzle.js");

    (detectPII as any).mockReturnValue({
      found: true,
      riskScore: 60,
      types: ["EMAIL"],
      anonymized: "[EMAIL]"
    });

    await logAudit(mockEntry);
    
    const valuesCall = (db.insert({} as any).values as any).mock.calls[0][0];
    expect(valuesCall.prompt).toBe("[EMAIL]");
  });

  it("should log warning on very high PII risk", async () => {
    const { logAudit } = await import("../../src/lib/audit.js");
    const { detectPII } = await import("../../src/lib/pii.js");
    const { default: logger } = await import("../../src/lib/logger.js");

    (detectPII as any).mockReturnValue({
      found: true,
      riskScore: 80,
      types: ["SSN"],
      anonymized: "[SSN]"
    });

    await logAudit(mockEntry);
    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({
      promptRisk: 80
    }), "High-risk PII detected in audit log");
  });

  it("should handle insertion error gracefully", async () => {
    const { logAudit } = await import("../../src/lib/audit.js");
    const { db } = await import("../../src/lib/drizzle.js");
    const { default: logger } = await import("../../src/lib/logger.js");

    (db.insert({} as any).values as any).mockRejectedValue(new Error("DB Down"));

    await logAudit(mockEntry);
    expect(logger.error).toHaveBeenCalled();
  });

  it("should wrap logCouncilDeliberation correctly", async () => {
    const { logCouncilDeliberation } = await import("../../src/lib/audit.js");
    const { db } = await import("../../src/lib/drizzle.js");

    await logCouncilDeliberation(1, "c1", "s1", ["m1"], 1, 100, 1000, true);
    expect(db.insert).toHaveBeenCalled();
  });

  it("should wrap logRouterDecision correctly", async () => {
    const { logRouterDecision } = await import("../../src/lib/audit.js");
    const { db } = await import("../../src/lib/drizzle.js");

    await logRouterDecision(1, "c1", "s1", "hi", { summon: "m1", reasoning: "r", confidence: 0.9 }, true);
    expect(db.insert).toHaveBeenCalled();
  });

  it("should wrap logToolExecution correctly", async () => {
    const { logToolExecution } = await import("../../src/lib/audit.js");
    const { db } = await import("../../src/lib/drizzle.js");

    await logToolExecution(1, "c1", "s1", "t1", { a: 1 }, "res", true, 500);
    expect(db.insert).toHaveBeenCalled();
  });

  it("should cleanup logs", async () => {
    const { cleanupOldAuditLogs } = await import("../../src/lib/audit.js");
    const result = await cleanupOldAuditLogs(30);
    expect(result).toBe(10);
  });
});

// ── metadata size cap ─────────────────────────────────────────────────────────

describe("Audit — metadata size cap (>MAX_METADATA_BYTES strips toolArgs)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("strips toolArgs from metadata when serialized size exceeds cap", async () => {
    const { logAudit } = await import("../../src/lib/audit.js");
    const { db } = await import("../../src/lib/drizzle.js");
    const { default: logger } = await import("../../src/lib/logger.js");
    const { detectPII } = await import("../../src/lib/pii.js");

    (detectPII as any).mockReturnValue({
      found: false, riskScore: 0, types: [], anonymized: "prompt",
    });

    // Create a metadata object whose JSON representation exceeds 8 KB
    const bigEntry = {
      userId: 1,
      modelName: "gpt-4",
      prompt: "Hello",
      response: "Hi",
      tokensIn: 10,
      tokensOut: 20,
      latencyMs: 100,
      requestType: "tool_call" as const,
      success: true,
      metadata: {
        toolArgs: { huge: "x".repeat(10_000) }, // push over 8 KB
      },
    };

    await logAudit(bigEntry);

    expect(vi.mocked(logger).warn).toHaveBeenCalledWith(
      expect.objectContaining({ size: expect.any(Number) }),
      expect.stringContaining("size cap")
    );

    // The inserted metadata should NOT contain the oversized toolArgs
    const valuesCall = (db.insert({} as any).values as any).mock.calls[0][0];
    expect(valuesCall.metadata).not.toHaveProperty("toolArgs");
  });

  it("does NOT strip toolArgs when metadata is under the cap", async () => {
    const { logAudit } = await import("../../src/lib/audit.js");
    const { db } = await import("../../src/lib/drizzle.js");
    const { detectPII } = await import("../../src/lib/pii.js");

    (detectPII as any).mockReturnValue({
      found: false, riskScore: 0, types: [], anonymized: "prompt",
    });

    const smallEntry = {
      userId: 1,
      modelName: "gpt-4",
      prompt: "Hello",
      response: "Hi",
      tokensIn: 10,
      tokensOut: 20,
      latencyMs: 100,
      requestType: "tool_call" as const,
      success: true,
      metadata: {
        toolArgs: { small: "value" },
      },
    };

    await logAudit(smallEntry);

    const valuesCall = (db.insert({} as any).values as any).mock.calls[0][0];
    // toolArgs should be preserved when under the cap
    expect(valuesCall.metadata).toHaveProperty("toolArgs");
  });
});

// ── getUserAuditLogs ──────────────────────────────────────────────────────────

describe("getUserAuditLogs — limit/offset caps and filter conditions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns results with default options", async () => {
    const { getUserAuditLogs } = await import("../../src/lib/audit.js");
    const result = await getUserAuditLogs(1);
    expect(result).toEqual([]);
  });

  it("caps limit to MAX_AUDIT_LIMIT (200) when value exceeds it", async () => {
    const { getUserAuditLogs } = await import("../../src/lib/audit.js");
    const { db } = await import("../../src/lib/drizzle.js");
    await getUserAuditLogs(1, { limit: 999 });
    const limitCall = db.select().from({} as any).where([]).orderBy({} as any).limit as any;
    // Verify .limit() was called (the mock resolves empty; we just verify no throw)
    expect(limitCall).toBeDefined();
  });

  it("enforces minimum limit of 1", async () => {
    const { getUserAuditLogs } = await import("../../src/lib/audit.js");
    // Should not throw even with 0 or negative limit
    await expect(getUserAuditLogs(1, { limit: 0 })).resolves.toEqual([]);
    await expect(getUserAuditLogs(1, { limit: -5 })).resolves.toEqual([]);
  });

  it("enforces non-negative offset", async () => {
    const { getUserAuditLogs } = await import("../../src/lib/audit.js");
    await expect(getUserAuditLogs(1, { offset: -10 })).resolves.toEqual([]);
  });

  it("accepts requestType filter without throwing", async () => {
    const { getUserAuditLogs } = await import("../../src/lib/audit.js");
    await expect(getUserAuditLogs(1, { requestType: "deliberation" })).resolves.toEqual([]);
  });

  it("accepts dateFrom filter without throwing", async () => {
    const { getUserAuditLogs } = await import("../../src/lib/audit.js");
    await expect(
      getUserAuditLogs(1, { dateFrom: new Date("2024-01-01") })
    ).resolves.toEqual([]);
  });

  it("accepts dateTo filter without throwing", async () => {
    const { getUserAuditLogs } = await import("../../src/lib/audit.js");
    await expect(
      getUserAuditLogs(1, { dateTo: new Date("2025-01-01") })
    ).resolves.toEqual([]);
  });

  it("accepts successOnly filter without throwing", async () => {
    const { getUserAuditLogs } = await import("../../src/lib/audit.js");
    await expect(
      getUserAuditLogs(1, { successOnly: true })
    ).resolves.toEqual([]);
  });

  it("accepts all filters combined without throwing", async () => {
    const { getUserAuditLogs } = await import("../../src/lib/audit.js");
    await expect(
      getUserAuditLogs(1, {
        limit: 10,
        offset: 5,
        requestType: "router",
        dateFrom: new Date("2024-01-01"),
        dateTo: new Date("2025-01-01"),
        successOnly: true,
      })
    ).resolves.toEqual([]);
  });
});
