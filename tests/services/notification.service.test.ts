import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mock state ───────────────────────────────────────────────────────

const {
  mockInsert,
  mockValues,
  mockReturning,
  mockSelect,
  mockFrom,
  mockWhere,
  mockOrderBy,
  mockLimit,
  mockOffset,
  mockUpdate,
  mockSet,
  mockSetWhere,
  mockDelete,
  mockDeleteWhere,
} = vi.hoisted(() => {
  const mockReturning = vi.fn().mockResolvedValue([{ id: 1 }]);
  const mockValues = vi.fn().mockReturnValue({ returning: mockReturning });
  const mockInsert = vi.fn().mockReturnValue({ values: mockValues });

  const mockOffset = vi.fn().mockResolvedValue([]);
  const mockLimit = vi.fn().mockReturnValue({ offset: mockOffset });
  const mockOrderBy = vi.fn().mockReturnValue({ limit: mockLimit });
  const mockWhere = vi.fn().mockReturnValue({ orderBy: mockOrderBy });
  const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
  const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });

  const mockSetWhere = vi.fn().mockResolvedValue([]);
  const mockSet = vi.fn().mockReturnValue({ where: mockSetWhere });
  const mockUpdate = vi.fn().mockReturnValue({ set: mockSet });

  const mockDeleteWhere = vi.fn().mockResolvedValue(undefined);
  const mockDelete = vi.fn().mockReturnValue({ where: mockDeleteWhere });

  return {
    mockInsert,
    mockValues,
    mockReturning,
    mockSelect,
    mockFrom,
    mockWhere,
    mockOrderBy,
    mockLimit,
    mockOffset,
    mockUpdate,
    mockSet,
    mockSetWhere,
    mockDelete,
    mockDeleteWhere,
  };
});

// ─── Mocks (before import) ────────────────────────────────────────────────────

vi.mock("../../src/lib/drizzle.js", () => ({
  db: {
    get insert() { return mockInsert; },
    get select() { return mockSelect; },
    get update() { return mockUpdate; },
    get delete() { return mockDelete; },
  },
}));

vi.mock("../../src/lib/logger.js", () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    })),
  },
}));

vi.mock("../../src/db/schema/notifications.js", () => ({
  notifications: {
    id: "id",
    userId: "userId",
    type: "type",
    title: "title",
    message: "message",
    dismissed: "dismissed",
    read: "read",
    actionUrl: "actionUrl",
    metadata: "metadata",
    createdAt: "createdAt",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a, b) => ({ eq: true, a, b })),
  and: vi.fn((...args) => ({ and: true, args })),
  desc: vi.fn((col) => ({ desc: true, col })),
  count: vi.fn(() => "count(*)"),
  sql: vi.fn(() => "sql"),
  gte: vi.fn((a, b) => ({ gte: true, a, b })),
  lte: vi.fn((a, b) => ({ lte: true, a, b })),
  isNull: vi.fn((a) => ({ isNull: true, a })),
  ne: vi.fn((a, b) => ({ ne: true, a, b })),
}));

// ─── Import under test (after mocks) ─────────────────────────────────────────

import {
  createNotification,
  getUserNotifications,
  getUnreadCount,
  markAsRead,
  dismissNotification,
  dismissAll,
} from "../../src/services/notification.service.js";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("createNotification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReturning.mockResolvedValue([{ id: 42 }]);
  });

  it("inserts a notification and returns its id", async () => {
    const result = await createNotification({
      userId: 1,
      type: "system",
      title: "Hello",
      message: "World",
    });

    expect(mockInsert).toHaveBeenCalledOnce();
    expect(mockValues).toHaveBeenCalledOnce();
    expect(mockReturning).toHaveBeenCalledOnce();
    expect(result).toEqual({ id: 42 });
  });

  it("passes all required fields to insert.values()", async () => {
    await createNotification({
      userId: 5,
      type: "deliberation_update",
      title: "Update",
      message: "A deliberation was updated",
    });

    const valuesArg = mockValues.mock.calls[0][0];
    expect(valuesArg.userId).toBe(5);
    expect(valuesArg.type).toBe("deliberation_update");
    expect(valuesArg.title).toBe("Update");
    expect(valuesArg.message).toBe("A deliberation was updated");
  });

  it("passes optional actionUrl when provided", async () => {
    await createNotification({
      userId: 1,
      type: "mention",
      title: "Mentioned",
      message: "You were mentioned",
      actionUrl: "/deliberations/99",
    });

    const valuesArg = mockValues.mock.calls[0][0];
    expect(valuesArg.actionUrl).toBe("/deliberations/99");
  });

  it("passes metadata when provided", async () => {
    await createNotification({
      userId: 1,
      type: "system",
      title: "T",
      message: "M",
      metadata: { deliberationId: 7 },
    });

    const valuesArg = mockValues.mock.calls[0][0];
    expect(valuesArg.metadata).toEqual({ deliberationId: 7 });
  });

  it("defaults metadata to empty object when not provided", async () => {
    await createNotification({
      userId: 1,
      type: "system",
      title: "T",
      message: "M",
    });

    const valuesArg = mockValues.mock.calls[0][0];
    expect(valuesArg.metadata).toEqual({});
  });

  it("throws when insert returns empty rows", async () => {
    mockReturning.mockResolvedValueOnce([]);

    await expect(
      createNotification({ userId: 1, type: "system", title: "T", message: "M" }),
    ).rejects.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("getUserNotifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOffset.mockResolvedValue([
      { id: 1, userId: 10, type: "system", title: "Hello", message: "World", dismissed: false, read: false },
    ]);
  });

  it("returns notifications for a user", async () => {
    const rows = await getUserNotifications(10);
    expect(mockSelect).toHaveBeenCalledOnce();
    expect(mockFrom).toHaveBeenCalledOnce();
    expect(mockWhere).toHaveBeenCalledOnce();
    expect(rows).toHaveLength(1);
  });

  it("applies default limit of 50", async () => {
    await getUserNotifications(10);
    expect(mockLimit).toHaveBeenCalledWith(50);
  });

  it("applies default offset of 0", async () => {
    await getUserNotifications(10);
    expect(mockOffset).toHaveBeenCalledWith(0);
  });

  it("respects custom limit option", async () => {
    await getUserNotifications(10, { limit: 20 });
    expect(mockLimit).toHaveBeenCalledWith(20);
  });

  it("caps limit at 200 regardless of input", async () => {
    await getUserNotifications(10, { limit: 9999 });
    expect(mockLimit).toHaveBeenCalledWith(200);
  });

  it("respects custom offset option", async () => {
    await getUserNotifications(10, { offset: 30 });
    expect(mockOffset).toHaveBeenCalledWith(30);
  });

  it("excludes dismissed by default (condition built into where)", async () => {
    await getUserNotifications(10);
    // where() should have been called with an AND condition including dismissed=false
    expect(mockWhere).toHaveBeenCalledOnce();
    const whereArg = mockWhere.mock.calls[0][0];
    // The `and` mock returns { and: true, args }
    expect(whereArg).toMatchObject({ and: true });
  });

  it("includes dismissed when includeDismissed=true", async () => {
    await getUserNotifications(10, { includeDismissed: true });
    expect(mockWhere).toHaveBeenCalledOnce();
    const whereArg = mockWhere.mock.calls[0][0];
    // Only one condition (userId eq), not an AND with dismissed
    expect(whereArg).toMatchObject({ and: true });
  });

  it("orders by createdAt descending", async () => {
    await getUserNotifications(10);
    expect(mockOrderBy).toHaveBeenCalledOnce();
    const orderArg = mockOrderBy.mock.calls[0][0];
    expect(orderArg).toMatchObject({ desc: true });
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("getUnreadCount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the count of unread notifications", async () => {
    // getUnreadCount awaits the chain directly — use mockOffset as it's the
    // last thenable in the chain built by getUserNotifications, but
    // getUnreadCount uses a different chain (no orderBy/limit/offset).
    // Wire mockWhere to resolve directly for this describe.
    mockWhere.mockResolvedValueOnce([{ id: 1 }, { id: 2 }, { id: 3 }]);

    const count = await getUnreadCount(7);
    expect(count).toBe(3);
  });

  it("returns 0 when there are no unread notifications", async () => {
    mockWhere.mockResolvedValueOnce([]);

    const count = await getUnreadCount(7);
    expect(count).toBe(0);
  });

  it("calls select().from().where() with userId condition", async () => {
    mockWhere.mockResolvedValueOnce([]);

    await getUnreadCount(99);

    expect(mockSelect).toHaveBeenCalledOnce();
    expect(mockFrom).toHaveBeenCalledOnce();
    expect(mockWhere).toHaveBeenCalledOnce();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("markAsRead", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSetWhere.mockResolvedValue([]);
  });

  it("calls update().set({ read: true }).where()", async () => {
    await markAsRead(1, 10);

    expect(mockUpdate).toHaveBeenCalledOnce();
    expect(mockSet).toHaveBeenCalledOnce();
    expect(mockSetWhere).toHaveBeenCalledOnce();

    const setArg = mockSet.mock.calls[0][0];
    expect(setArg).toEqual({ read: true });
  });

  it("does not throw on success", async () => {
    await expect(markAsRead(1, 10)).resolves.toBeUndefined();
  });

  it("propagates errors from the database", async () => {
    mockSetWhere.mockRejectedValueOnce(new Error("DB error"));
    await expect(markAsRead(1, 10)).rejects.toThrow("DB error");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("dismissNotification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSetWhere.mockResolvedValue([]);
  });

  it("sets dismissed=true and read=true", async () => {
    await dismissNotification(1, 5);

    const setArg = mockSet.mock.calls[0][0];
    expect(setArg).toEqual({ dismissed: true, read: true });
  });

  it("calls update().set().where()", async () => {
    await dismissNotification(1, 5);

    expect(mockUpdate).toHaveBeenCalledOnce();
    expect(mockSet).toHaveBeenCalledOnce();
    expect(mockSetWhere).toHaveBeenCalledOnce();
  });

  it("does not throw on success", async () => {
    await expect(dismissNotification(2, 99)).resolves.toBeUndefined();
  });

  it("propagates DB errors", async () => {
    mockSetWhere.mockRejectedValueOnce(new Error("constraint violation"));
    await expect(dismissNotification(1, 1)).rejects.toThrow("constraint violation");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("dismissAll", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSetWhere.mockResolvedValue([]);
  });

  it("sets dismissed=true and read=true for all user notifications", async () => {
    await dismissAll(3);

    const setArg = mockSet.mock.calls[0][0];
    expect(setArg).toEqual({ dismissed: true, read: true });
  });

  it("calls update().set().where() once", async () => {
    await dismissAll(3);

    expect(mockUpdate).toHaveBeenCalledOnce();
    expect(mockSet).toHaveBeenCalledOnce();
    expect(mockSetWhere).toHaveBeenCalledOnce();
  });

  it("does not throw on success", async () => {
    await expect(dismissAll(3)).resolves.toBeUndefined();
  });

  it("propagates DB errors", async () => {
    mockSetWhere.mockRejectedValueOnce(new Error("timeout"));
    await expect(dismissAll(3)).rejects.toThrow("timeout");
  });
});
