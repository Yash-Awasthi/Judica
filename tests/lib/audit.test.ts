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
