import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkQuota } from "../../src/middleware/quota.js";

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
  const req: any = { userId, requestId: "test-req-id" };
  const headersSet: Record<string, string> = {};
  const res: any = {
    locals: {},
    setHeader: vi.fn((name: string, value: string) => {
      headersSet[name] = value;
    }),
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  const next = vi.fn();
  return { req, res, next, headersSet };
}

async function getDbMocks() {
  const drizzle = await import("../../src/lib/drizzle.js");
  return (drizzle.db as any).__mocks;
}

describe("checkQuota middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls next immediately if no userId", async () => {
    const { req, res, next } = createMocks(undefined);
    await checkQuota(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledWith();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("calls next and increments usage when under quota", async () => {
    const mocks = await getDbMocks();
    mocks.mockLimit.mockResolvedValueOnce([{ requests: 5, tokens: 100 }]);
    mocks.mockReturning.mockResolvedValueOnce([{ requests: 6, tokens: 100 }]);

    const { req, res, next } = createMocks(1);
    await checkQuota(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledWith();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("returns 429 when daily requests are exceeded", async () => {
    const mocks = await getDbMocks();
    mocks.mockLimit.mockResolvedValueOnce([{ requests: 100, tokens: 500 }]);

    const { req, res, next } = createMocks(1);
    await checkQuota(req, res, next);

    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining("quota exceeded") })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 429 when daily tokens are exceeded", async () => {
    const mocks = await getDbMocks();
    mocks.mockLimit.mockResolvedValueOnce([{ requests: 10, tokens: 1_000_000 }]);

    const { req, res, next } = createMocks(1);
    await checkQuota(req, res, next);

    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining("quota exceeded") })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("sets X-Quota headers on success", async () => {
    const mocks = await getDbMocks();
    mocks.mockLimit.mockResolvedValueOnce([{ requests: 10, tokens: 200 }]);
    mocks.mockReturning.mockResolvedValueOnce([{ requests: 11, tokens: 200 }]);

    const { req, res, next, headersSet } = createMocks(1);
    await checkQuota(req, res, next);

    expect(res.setHeader).toHaveBeenCalledWith("X-Quota-Limit", "100");
    expect(res.setHeader).toHaveBeenCalledWith("X-Quota-Used", "11");
    expect(res.setHeader).toHaveBeenCalledWith("X-Quota-Remaining", "89");
    expect(res.setHeader).toHaveBeenCalledWith("X-Token-Limit", "1000000");
    expect(res.setHeader).toHaveBeenCalledWith("X-Token-Used", "200");
    expect(res.setHeader).toHaveBeenCalledWith("X-Token-Remaining", "999800");
  });

  it("sets X-Quota headers on 429 response", async () => {
    const mocks = await getDbMocks();
    mocks.mockLimit.mockResolvedValueOnce([{ requests: 100, tokens: 500 }]);

    const { req, res, next } = createMocks(1);
    await checkQuota(req, res, next);

    expect(res.setHeader).toHaveBeenCalledWith("X-Quota-Limit", "100");
    expect(res.setHeader).toHaveBeenCalledWith("X-Quota-Used", "100");
    expect(res.setHeader).toHaveBeenCalledWith("Retry-After", "86400");
  });

  it("passes errors to next", async () => {
    const mocks = await getDbMocks();
    const testError = new Error("DB connection failed");
    mocks.mockLimit.mockRejectedValueOnce(testError);

    const { req, res, next } = createMocks(1);
    await checkQuota(req, res, next);

    expect(next).toHaveBeenCalledWith(testError);
  });
});
