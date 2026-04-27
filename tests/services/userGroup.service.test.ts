import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted DB mock ──────────────────────────────────────────────────────────
const {
  mockDbSelect,
  mockDbInsert,
  mockDbUpdate,
  mockDbDelete,
  mockSelectFrom,
  mockInsertValues,
} = vi.hoisted(() => {
  const mockDeleteWhere = vi.fn().mockImplementation(() =>
    Object.assign(Promise.resolve([]), { returning: vi.fn().mockResolvedValue([]) }),
  );
  const mockDbDelete = vi.fn().mockReturnValue({ where: mockDeleteWhere });

  const mockOnConflict = vi.fn().mockResolvedValue(undefined);
  const mockInsertReturning = vi.fn().mockResolvedValue([]);
  const mockInsertValues = vi.fn().mockReturnValue({
    returning: mockInsertReturning,
    onConflictDoUpdate: mockOnConflict,
  });
  const mockDbInsert = vi.fn().mockReturnValue({ values: mockInsertValues });

  const mockUpdateWhere = vi.fn().mockResolvedValue(undefined);
  const mockUpdateSet = vi.fn().mockReturnValue({ where: mockUpdateWhere });
  const mockDbUpdate = vi.fn().mockReturnValue({ set: mockUpdateSet });

  // Default select: .from() returns { where: fn } where where() resolves to []
  const mockSelectWhere = vi.fn().mockResolvedValue([]);
  const mockSelectFrom = vi.fn().mockReturnValue({ where: mockSelectWhere });
  const mockDbSelect = vi.fn().mockReturnValue({ from: mockSelectFrom });

  return {
    mockDbSelect,
    mockDbInsert,
    mockDbUpdate,
    mockDbDelete,
    mockSelectFrom,
    mockInsertValues,
  };
});

vi.mock("../../src/lib/drizzle.js", () => ({
  db: {
    select: mockDbSelect,
    insert: mockDbInsert,
    update: mockDbUpdate,
    delete: mockDbDelete,
  },
}));
vi.mock("../../src/db/schema/userGroups.js", () => ({
  userGroups: { id: "id", isPublic: "isPublic", name: "name" },
  userGroupMembers: { userId: "userId", groupId: "groupId", role: "role" },
  userGroupPermissions: {
    groupId: "groupId",
    resourceType: "resourceType",
    resourceId: "resourceId",
    permission: "permission",
  },
}));
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a, b) => ({ eq: true, a, b })),
  and: vi.fn((...args) => ({ and: true, args })),
}));

import {
  createGroup,
  listGroups,
  getGroup,
  updateGroup,
  deleteGroup,
  addMember,
  removeMember,
  setGroupPermission,
  getUserGroups,
  checkGroupAccess,
} from "../../src/services/userGroup.service.js";

// ─── Sample data ──────────────────────────────────────────────────────────────

const sampleGroup = { id: 1, name: "Researchers", description: "Research team", isPublic: false, createdBy: 10, updatedAt: new Date() };
const samplePublicGroup = { id: 2, name: "Public Group", description: "", isPublic: true, createdBy: 99, updatedAt: new Date() };
const sampleMembership = { groupId: 1, userId: 10, role: "admin" };
const samplePermission = { groupId: 1, resourceType: "document_set", resourceId: "ds-1", permission: "write" };

// ─── createGroup ──────────────────────────────────────────────────────────────

describe("createGroup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("inserts the group and returns its id", async () => {
    const mockReturning = vi.fn().mockResolvedValue([{ ...sampleGroup, id: 5 }]);
    mockInsertValues.mockReturnValueOnce({ returning: mockReturning, onConflictDoUpdate: vi.fn() });
    // Second insert for the member (no return needed)
    mockInsertValues.mockReturnValueOnce({ returning: vi.fn().mockResolvedValue([]), onConflictDoUpdate: vi.fn() });

    const result = await createGroup("Researchers", "Research team", false, 10);

    expect(result).toEqual({ id: 5 });
  });

  it("auto-adds the creator as an admin member (two insert calls)", async () => {
    const mockReturning = vi.fn().mockResolvedValue([sampleGroup]);
    mockInsertValues.mockReturnValueOnce({ returning: mockReturning, onConflictDoUpdate: vi.fn() });
    mockInsertValues.mockReturnValueOnce({ returning: vi.fn().mockResolvedValue([]), onConflictDoUpdate: vi.fn() });

    await createGroup("Researchers", "Research team", false, 10);

    expect(mockDbInsert).toHaveBeenCalledTimes(2);
    const secondInsertValues = mockInsertValues.mock.calls[1][0];
    expect(secondInsertValues.userId).toBe(10);
    expect(secondInsertValues.role).toBe("admin");
    expect(secondInsertValues.groupId).toBe(sampleGroup.id);
  });
});

// ─── listGroups ───────────────────────────────────────────────────────────────

describe("listGroups", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns public groups and groups the user is a member of", async () => {
    // First call: db.select().from(userGroups) → direct await (no .where)
    mockSelectFrom.mockResolvedValueOnce([sampleGroup, samplePublicGroup]);
    // Second call: db.select().from(userGroupMembers).where(...) → awaited directly
    mockSelectFrom.mockReturnValueOnce({ where: vi.fn().mockResolvedValue([sampleMembership]) });

    const result = await listGroups(10);

    // sampleGroup (private, but user is member) + samplePublicGroup (public)
    expect(result).toHaveLength(2);
    expect(result.map((g) => g.id)).toContain(1);
    expect(result.map((g) => g.id)).toContain(2);
  });

  it("adds isMember=true and role for groups the user belongs to", async () => {
    mockSelectFrom.mockResolvedValueOnce([sampleGroup]);
    mockSelectFrom.mockReturnValueOnce({ where: vi.fn().mockResolvedValue([sampleMembership]) });

    const [group] = await listGroups(10);

    expect(group.isMember).toBe(true);
    expect(group.role).toBe("admin");
  });

  it("adds isMember=false for public groups the user is not a member of", async () => {
    mockSelectFrom.mockResolvedValueOnce([samplePublicGroup]);
    mockSelectFrom.mockReturnValueOnce({ where: vi.fn().mockResolvedValue([]) });

    const [group] = await listGroups(99);

    expect(group.isMember).toBe(false);
    expect(group.role).toBeUndefined();
  });

  it("does not return private groups the user is not a member of", async () => {
    const privateGroup = { ...sampleGroup, isPublic: false, id: 3 };
    mockSelectFrom.mockResolvedValueOnce([privateGroup]);
    mockSelectFrom.mockReturnValueOnce({ where: vi.fn().mockResolvedValue([]) });

    const result = await listGroups(999);

    expect(result).toHaveLength(0);
  });
});

// ─── getGroup ─────────────────────────────────────────────────────────────────

describe("getGroup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when the group is not found", async () => {
    const mockLimit = vi.fn().mockResolvedValue([]);
    mockSelectFrom.mockReturnValue({ where: vi.fn().mockReturnValue({ limit: mockLimit }) });

    const result = await getGroup(999);

    expect(result).toBeNull();
  });

  it("returns the group with members and permissions arrays when found", async () => {
    // getGroup: .where().limit() pattern
    const mockLimit1 = vi.fn().mockResolvedValue([sampleGroup]);
    // members: .where() directly awaited
    const mockMembersWhere = vi.fn().mockResolvedValue([sampleMembership]);
    // permissions: .where() directly awaited
    const mockPermsWhere = vi.fn().mockResolvedValue([samplePermission]);

    mockSelectFrom
      .mockReturnValueOnce({ where: vi.fn().mockReturnValue({ limit: mockLimit1 }) })
      .mockReturnValueOnce({ where: mockMembersWhere })
      .mockReturnValueOnce({ where: mockPermsWhere });

    const result = await getGroup(1);

    expect(result).not.toBeNull();
    expect(result!.id).toBe(sampleGroup.id);
    expect(result!.members).toEqual([sampleMembership]);
    expect(result!.permissions).toEqual([samplePermission]);
  });
});

// ─── updateGroup ─────────────────────────────────────────────────────────────

describe("updateGroup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls db.update with the correct fields and updatedAt", async () => {
    const mockUpdateWhere = vi.fn().mockResolvedValue(undefined);
    const mockUpdateSet = vi.fn().mockReturnValue({ where: mockUpdateWhere });
    mockDbUpdate.mockReturnValue({ set: mockUpdateSet });

    await updateGroup(1, { name: "New Name", isPublic: true });

    expect(mockDbUpdate).toHaveBeenCalledOnce();
    const setArgs = mockUpdateSet.mock.calls[0][0];
    expect(setArgs.name).toBe("New Name");
    expect(setArgs.isPublic).toBe(true);
    expect(setArgs.updatedAt).toBeInstanceOf(Date);
  });
});

// ─── deleteGroup ──────────────────────────────────────────────────────────────

describe("deleteGroup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls db.delete with the group id", async () => {
    await deleteGroup(1);
    expect(mockDbDelete).toHaveBeenCalledOnce();
  });
});

// ─── addMember ────────────────────────────────────────────────────────────────

describe("addMember", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls insert with onConflictDoUpdate for upsert semantics", async () => {
    const mockOnConflict = vi.fn().mockResolvedValue(undefined);
    mockInsertValues.mockReturnValue({ returning: vi.fn(), onConflictDoUpdate: mockOnConflict });

    await addMember(1, 10, "member");

    expect(mockDbInsert).toHaveBeenCalledOnce();
    expect(mockOnConflict).toHaveBeenCalledOnce();
    const valuesArg = mockInsertValues.mock.calls[0][0];
    expect(valuesArg.groupId).toBe(1);
    expect(valuesArg.userId).toBe(10);
    expect(valuesArg.role).toBe("member");
  });
});

// ─── removeMember ─────────────────────────────────────────────────────────────

describe("removeMember", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls db.delete to remove the member", async () => {
    await removeMember(1, 10);
    expect(mockDbDelete).toHaveBeenCalledOnce();
  });
});

// ─── setGroupPermission ───────────────────────────────────────────────────────

describe("setGroupPermission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls insert with onConflictDoUpdate for upsert semantics", async () => {
    const mockOnConflict = vi.fn().mockResolvedValue(undefined);
    mockInsertValues.mockReturnValue({ returning: vi.fn(), onConflictDoUpdate: mockOnConflict });

    await setGroupPermission(1, "document_set", "ds-1", "write");

    expect(mockDbInsert).toHaveBeenCalledOnce();
    expect(mockOnConflict).toHaveBeenCalledOnce();
    const valuesArg = mockInsertValues.mock.calls[0][0];
    expect(valuesArg.groupId).toBe(1);
    expect(valuesArg.resourceType).toBe("document_set");
    expect(valuesArg.resourceId).toBe("ds-1");
    expect(valuesArg.permission).toBe("write");
  });
});

// ─── getUserGroups ────────────────────────────────────────────────────────────

describe("getUserGroups", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an empty array when the user has no memberships", async () => {
    // memberships query: .where() directly awaited
    mockSelectFrom.mockReturnValueOnce({ where: vi.fn().mockResolvedValue([]) });

    const result = await getUserGroups(999);

    expect(result).toEqual([]);
  });

  it("returns groups the user is a member of", async () => {
    // First call: db.select().from(userGroupMembers).where(...) → awaited directly
    mockSelectFrom.mockReturnValueOnce({ where: vi.fn().mockResolvedValue([sampleMembership]) });
    // Second call: db.select().from(userGroups) → direct await (no .where)
    mockSelectFrom.mockResolvedValueOnce([sampleGroup, samplePublicGroup]);

    const result = await getUserGroups(10);

    // sampleMembership.groupId = 1, only sampleGroup has id=1
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(1);
  });
});

// ─── checkGroupAccess ─────────────────────────────────────────────────────────

describe("checkGroupAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns false when the user has no memberships", async () => {
    // memberships: .where() directly awaited → empty array
    mockSelectFrom.mockReturnValue({ where: vi.fn().mockResolvedValue([]) });

    const result = await checkGroupAccess(999, "document_set", "ds-1", "read");

    expect(result).toBe(false);
  });

  it("returns true when the user has a sufficient permission level", async () => {
    // memberships query: .where() directly awaited
    mockSelectFrom.mockReturnValueOnce({ where: vi.fn().mockResolvedValue([sampleMembership]) });
    // permissions query: .where().limit() pattern
    const mockPermLimit = vi.fn().mockResolvedValue([{ ...samplePermission, permission: "write" }]);
    mockSelectFrom.mockReturnValueOnce({ where: vi.fn().mockReturnValue({ limit: mockPermLimit }) });

    const result = await checkGroupAccess(10, "document_set", "ds-1", "read");

    expect(result).toBe(true);
  });

  it("returns false when the user has insufficient permission level", async () => {
    // memberships query: .where() directly awaited
    mockSelectFrom.mockReturnValueOnce({ where: vi.fn().mockResolvedValue([sampleMembership]) });
    // permissions query returns read-only permission
    const mockPermLimit = vi.fn().mockResolvedValue([{ ...samplePermission, permission: "read" }]);
    mockSelectFrom.mockReturnValueOnce({ where: vi.fn().mockReturnValue({ limit: mockPermLimit }) });

    const result = await checkGroupAccess(10, "document_set", "ds-1", "admin");

    expect(result).toBe(false);
  });

  it("returns false when no matching permission is found for the resource", async () => {
    // memberships query: .where() directly awaited
    mockSelectFrom.mockReturnValueOnce({ where: vi.fn().mockResolvedValue([sampleMembership]) });
    // permissions query: no match
    const mockPermLimit = vi.fn().mockResolvedValue([]);
    mockSelectFrom.mockReturnValueOnce({ where: vi.fn().mockReturnValue({ limit: mockPermLimit }) });

    const result = await checkGroupAccess(10, "document_set", "ds-unknown", "read");

    expect(result).toBe(false);
  });
});
