import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Define table objects that will be shared between mocks and tests
const conversations = { id: "id", userId: "userId", sessionSummary: "sessionSummary", updatedAt: "updatedAt" };
const chats = { conversationId: "conversationId" };
const memories = { id: "id", userId: "userId" };

// Mock schema
vi.mock("../../src/db/schema/conversations.js", () => ({ conversations, chats }));
vi.mock("../../src/db/schema/memory.js", () => ({ memories }));

// Mock drizzle
vi.mock("../../src/lib/drizzle.js", () => {
  return {
    db: {
      select: vi.fn(),
    }
  };
});

vi.mock("../../src/services/sessionSummary.service.js", () => ({
  summarizeSession: vi.fn().mockResolvedValue({}),
}));
vi.mock("../../src/services/memoryCompaction.service.js", () => ({
  compact: vi.fn().mockResolvedValue({}),
}));
vi.mock("../../src/lib/logger.js", () => ({
  default: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    isNull: vi.fn(),
    lt: vi.fn(),
    or: vi.fn(),
    eq: vi.fn(),
    count: vi.fn(),
    sql: vi.fn(),
  };
});

describe("Memory Crons", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    // Stub Math.random to eliminate jitter
    vi.spyOn(Math, "random").mockReturnValue(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const createChainMock = (results: any[]) => ({
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    groupBy: vi.fn().mockReturnThis(),
    having: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(results),
    then: vi.fn((resolve: any) => Promise.resolve(results).then(resolve)),
  });

  it("should start and stop crons", async () => {
    const { startMemoryCrons, stopMemoryCrons } = await import("../../src/queue/memoryCrons.js");
    const setTimeoutSpy = vi.spyOn(global, "setTimeout");
    const clearTimeoutSpy = vi.spyOn(global, "clearTimeout");

    startMemoryCrons();
    // startMemoryCrons uses setTimeout for jitter, then schedules two more setTimeouts
    // With jitter=0, the first setTimeout fires immediately
    expect(setTimeoutSpy).toHaveBeenCalled();

    stopMemoryCrons();
    expect(clearTimeoutSpy).toHaveBeenCalled();
  });

  it("should run summarization on interval and call summarizeSession for active convos", async () => {
    const { startMemoryCrons, stopMemoryCrons } = await import("../../src/queue/memoryCrons.js");
    const { db } = await import("../../src/lib/drizzle.js");
    const { summarizeSession } = await import("../../src/services/sessionSummary.service.js");

    // select().from(conversations).where(...).limit(...) returns convos
    // select({count}).from(chats).where(...) returns count
    vi.mocked(db.select)
      .mockReturnValueOnce(createChainMock([{ id: "conv1", userId: 1 }]) as any) // Convos query (uses .limit())
      .mockReturnValueOnce(createChainMock([{ count: 31 }]) as any); // Chat count for conv1

    startMemoryCrons();
    // Advance past jitter (0ms) then past the summarization interval (1 hour)
    await vi.advanceTimersByTimeAsync(0); // jitter fires
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000); // summarization timer fires

    expect(summarizeSession).toHaveBeenCalledWith("conv1", 1);
    stopMemoryCrons();
  });

  it("should run compaction on interval and call compact for users with many memories", async () => {
    const { startMemoryCrons, stopMemoryCrons } = await import("../../src/queue/memoryCrons.js");
    const { db } = await import("../../src/lib/drizzle.js");
    const { compact } = await import("../../src/services/memoryCompaction.service.js");

    // Default: return empty for summarization queries, return compaction data for groupBy queries
    vi.mocked(db.select).mockImplementation((_arg?: any) => {
      const chain = createChainMock([]);
      // Override limit to check if this is a compaction query (has groupBy/having)
      let isGroupBy = false;
      const mock: any = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        groupBy: vi.fn(() => { isGroupBy = true; return mock; }),
        having: vi.fn().mockReturnThis(),
        limit: vi.fn(function() {
          if (isGroupBy) {
            return Promise.resolve([{ userId: 1, count: 51 }]);
          }
          return Promise.resolve([]);
        }),
        then: vi.fn((resolve: any) => Promise.resolve([]).then(resolve)),
      };
      return mock as any;
    });

    startMemoryCrons();
    // Advance past jitter (0ms) then past the compaction interval (1 week)
    await vi.advanceTimersByTimeAsync(0); // jitter fires
    await vi.advanceTimersByTimeAsync(7 * 24 * 60 * 60 * 1000); // compaction timer fires

    expect(compact).toHaveBeenCalledWith(1);
    stopMemoryCrons();
  });
});
