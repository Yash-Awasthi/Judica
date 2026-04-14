import { describe, it, expect, vi, beforeEach } from "vitest";
import { fastifyCheckQuota } from "../../src/middleware/quota.js";

vi.mock("../../src/lib/drizzle.js", () => {
  const mockReturning = vi.fn().mockResolvedValue([{ requests: 1, tokens: 0 }]);
  const mockOnConflictDoUpdate = vi.fn(() => ({ returning: mockReturning }));
  const mockValues = vi.fn(() => ({ onConflictDoUpdate: mockOnConflictDoUpdate }));
  const mockInsert = vi.fn(() => ({ values: mockValues }));
  const mockLimit = vi.fn().mockResolvedValue([]);
  const mockWhere = vi.fn(() => ({ limit: mockLimit }));
  const mockFrom = vi.fn(() => ({ where: mockWhere }));
  const mockSelect = vi.fn(() => ({ from: mockFrom }));

  return {
    db: {
      select: mockSelect,
      insert: mockInsert,
      __mocks: { mockSelect, mockFrom, mockWhere, mockLimit, mockInsert, mockValues, mockOnConflictDoUpdate, mockReturning },
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
    mocks.mockLimit.mockResolvedValueOnce([{ requests: 5, tokens: 100 }]);
    mocks.mockReturning.mockResolvedValueOnce([{ requests: 6, tokens: 100 }]);

    const { request, reply } = createMocks(1);
    await fastifyCheckQuota(request, reply);

    expect(reply.code).not.toHaveBeenCalled();
  });

  it("returns 429 when daily requests are exceeded", async () => {
    const mocks = await getDbMocks();
    mocks.mockLimit.mockResolvedValueOnce([{ requests: 100, tokens: 500 }]);

    const { request, reply } = createMocks(1);
    await fastifyCheckQuota(request, reply);

    expect(reply.code).toHaveBeenCalledWith(429);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining("quota exceeded") })
    );
  });

  it("returns 429 when daily tokens are exceeded", async () => {
    const mocks = await getDbMocks();
    mocks.mockLimit.mockResolvedValueOnce([{ requests: 10, tokens: 1_000_000 }]);

    const { request, reply } = createMocks(1);
    await fastifyCheckQuota(request, reply);

    expect(reply.code).toHaveBeenCalledWith(429);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining("quota exceeded") })
    );
  });

  it("sets X-Quota headers on success", async () => {
    const mocks = await getDbMocks();
    mocks.mockLimit.mockResolvedValueOnce([{ requests: 10, tokens: 200 }]);
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
    mocks.mockLimit.mockResolvedValueOnce([{ requests: 100, tokens: 500 }]);

    const { request, reply } = createMocks(1);
    await fastifyCheckQuota(request, reply);

    expect(reply.header).toHaveBeenCalledWith("X-Quota-Limit", "100");
    expect(reply.header).toHaveBeenCalledWith("X-Quota-Used", "100");
    expect(reply.header).toHaveBeenCalledWith("Retry-After", "86400");
  });
});
