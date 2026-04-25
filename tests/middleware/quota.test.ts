import { describe, it, expect, vi, beforeEach } from "vitest";
import { fastifyCheckQuota } from "../../src/middleware/quota.js";

vi.mock("../../src/lib/drizzle.js", () => {
  const mockReturning = vi.fn().mockResolvedValue([{ requests: 1, tokens: 0 }]);
  const mockOnConflictDoUpdate = vi.fn(() => ({ returning: mockReturning }));
  const mockValues = vi.fn(() => ({ onConflictDoUpdate: mockOnConflictDoUpdate }));
  const mockInsert = vi.fn(() => ({ values: mockValues }));
  // For the rollback update path
  const mockUpdateWhere = vi.fn().mockResolvedValue(undefined);
  const mockUpdateSet = vi.fn(() => ({ where: mockUpdateWhere }));
  const mockUpdate = vi.fn(() => ({ set: mockUpdateSet }));

  return {
    db: {
      insert: mockInsert,
      update: mockUpdate,
      __mocks: { mockInsert, mockValues, mockOnConflictDoUpdate, mockReturning, mockUpdate, mockUpdateSet, mockUpdateWhere },
    },
  };
});

vi.mock("../../src/db/schema/users.js", () => ({
  dailyUsage: {
    userId: "userId",
    date: "date",
    requests: "requests",
    tokens: "tokens",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: any[]) => args),
  and: vi.fn((...args: any[]) => args),
  sql: vi.fn((strings: TemplateStringsArray, ...values: any[]) => ({ strings, values })),
}));

vi.mock("../../src/lib/logger.js", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../../src/config/quotas.js", () => ({
  DAILY_REQUEST_LIMIT: 100,
  DAILY_TOKEN_LIMIT: 1_000_000,
}));

function createMocks(userId?: number) {
  const request = { userId, requestId: "test-req-id" } as any;
  const headerValues: Record<string, string> = {};
  const reply = {
    header: vi.fn((name: string, value: string) => {
      headerValues[name] = value;
      return reply;
    }),
    code: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  } as any;
  return { request, reply, headerValues };
}

async function getDbMocks() {
  const drizzle = await import("../../src/lib/drizzle.js");
  return (drizzle.db as any).__mocks;
}

describe("fastifyCheckQuota middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns immediately if no userId", async () => {
    const { request, reply } = createMocks(undefined);
    await fastifyCheckQuota(request, reply);

    expect(reply.code).not.toHaveBeenCalled();
  });

  it("increments usage when under quota", async () => {
    const mocks = await getDbMocks();
    mocks.mockReturning.mockResolvedValueOnce([{ requests: 6, tokens: 100 }]);

    const { request, reply } = createMocks(1);
    await fastifyCheckQuota(request, reply);

    expect(reply.code).not.toHaveBeenCalled();
  });

  it("returns 429 when daily requests are exceeded", async () => {
    const mocks = await getDbMocks();
    // Upsert returns count exceeding limit (101 > 100)
    mocks.mockReturning.mockResolvedValueOnce([{ requests: 101, tokens: 500 }]);

    const { request, reply } = createMocks(1);
    await fastifyCheckQuota(request, reply);

    expect(reply.code).toHaveBeenCalledWith(429);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining("quota exceeded") })
    );
  });

  it("returns 429 when daily tokens are exceeded", async () => {
    const mocks = await getDbMocks();
    // Upsert returns token count exceeding limit
    mocks.mockReturning.mockResolvedValueOnce([{ requests: 10, tokens: 1_000_001 }]);

    const { request, reply } = createMocks(1);
    await fastifyCheckQuota(request, reply);

    expect(reply.code).toHaveBeenCalledWith(429);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining("quota exceeded") })
    );
  });

  it("sets X-Quota headers on success", async () => {
    const mocks = await getDbMocks();
    mocks.mockReturning.mockResolvedValueOnce([{ requests: 11, tokens: 200 }]);

    const { request, reply } = createMocks(1);
    await fastifyCheckQuota(request, reply);

    expect(reply.header).toHaveBeenCalledWith("X-Quota-Limit", "100");
    expect(reply.header).toHaveBeenCalledWith("X-Quota-Used", "11");
    expect(reply.header).toHaveBeenCalledWith("X-Quota-Remaining", "89");
    expect(reply.header).toHaveBeenCalledWith("X-Token-Limit", "1000000");
    expect(reply.header).toHaveBeenCalledWith("X-Token-Used", "200");
    expect(reply.header).toHaveBeenCalledWith("X-Token-Remaining", "999800");
  });

  it("sets X-Quota headers on 429 response", async () => {
    const mocks = await getDbMocks();
    // Upsert returns count exceeding limit (101 > 100) — then rolled back to 100
    mocks.mockReturning.mockResolvedValueOnce([{ requests: 101, tokens: 500 }]);

    const { request, reply } = createMocks(1);
    await fastifyCheckQuota(request, reply);

    expect(reply.header).toHaveBeenCalledWith("X-Quota-Limit", "100");
    // P8-48: rolled-back value is 101-1 = 100
    expect(reply.header).toHaveBeenCalledWith("X-Quota-Used", "100");
    expect(reply.header).toHaveBeenCalledWith("Retry-After", "86400");
  });
});
