import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Define table objects that will be shared between mocks and tests
const conversations = { id: "id", userId: "userId", sessionSummary: "sessionSummary", updatedAt: "updatedAt" };
const chats = { conversationId: "conversationId" };
const memories = { id: "id", userId: "userId" };

// Mock schema
vi.mock("../db/schema/conversations.js", () => ({ conversations, chats }));
vi.mock("../db/schema/memory.js", () => ({ memories }));

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

vi.mock("drizzle-orm", () => ({
  isNull: vi.fn(), lt: vi.fn(), or: vi.fn(), eq: vi.fn(), count: vi.fn(), sql: vi.fn(),
}));

describe("Memory Crons", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const createQueryMock = (results: any[]) => ({
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    groupBy: vi.fn().mockReturnThis(),
    having: vi.fn().mockReturnThis(),
    then: vi.fn((resolve) => Promise.resolve(results).then(resolve)),
  });

  it("should start and stop crons", async () => {
    const { startMemoryCrons, stopMemoryCrons } = await import("../../src/lib/memoryCrons.js");
    const spy = vi.spyOn(global, "setInterval");
    const clearSpy = vi.spyOn(global, "clearInterval");

    startMemoryCrons();
    expect(spy).toHaveBeenCalledTimes(2);

    stopMemoryCrons();
    expect(clearSpy).toHaveBeenCalledTimes(2);
  });

  it("should run summarization on interval and call summarizeSession for active convos", async () => {
    const { startMemoryCrons } = await import("../../src/lib/memoryCrons.js");
    const { db } = await import("../../src/lib/drizzle.js");
    const { summarizeSession } = await import("../../src/services/sessionSummary.service.js");

    // Sequence of select() calls in runAutoSummarization:
    // 1. db.select().from(conversations)...
    // 2. For each convo: db.select().from(chats)...
    
    vi.mocked(db.select)
      .mockReturnValueOnce(createQueryMock([{ id: "conv1", userId: 1 }]) as any) // Convos
      .mockReturnValueOnce(createQueryMock([{ count: 31 }]) as any); // Chat count for conv1

    startMemoryCrons();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000); // 1 hour

    expect(summarizeSession).toHaveBeenCalledWith("conv1", 1);
  });

  it("should run compaction on interval and call compact for users with many memories", async () => {
    const { startMemoryCrons } = await import("../../src/lib/memoryCrons.js");
    const { db } = await import("../../src/lib/drizzle.js");
    const { compact } = await import("../../src/services/memoryCompaction.service.js");

    // We advance 1 week. Hourly job runs 168 times. We need to clear those mocks or handle them.
    // Let's just mock select to return empty arrays by default, and return our compaction result once.
    
    vi.mocked(db.select).mockReturnValue(createQueryMock([]) as any); // Default empty
    
    // We want the compaction job to find something.
    // Compaction job calls select() ONCE per weekly run (at the start of the interval).
    // Actually, it runs AFTER the hourly jobs that were triggered at the same time?
    // Intervals are independent.
    
    const userCountsQuery = createQueryMock([{ userId: 1, count: 51 }]);
    
    // We need to identify the compaction call. It's the only one that uses groupBy or is from 'memories'.
    // Or we can just use mockReturnValueOnce for the 169th call? No.
    
    vi.mocked(db.select).mockImplementation((arg) => {
        // If arg (the selected columns) contains count(memories.id) or userId
        if (arg && (arg.userId || arg.count)) {
            return userCountsQuery as any;
        }
        return createQueryMock([]) as any;
    });

    startMemoryCrons();
    await vi.advanceTimersByTimeAsync(7 * 24 * 60 * 60 * 1000); // 1 week

    expect(compact).toHaveBeenCalledWith(1);
  });
});
