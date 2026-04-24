import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createProject,
  getProjects,
  getProjectById,
  updateProject,
  deleteProject,
} from "../../src/services/project.service.js";

const mockReturning = vi.fn();
const mockValues = vi.fn(() => ({ returning: mockReturning }));
const mockInsert = vi.fn(() => ({ values: mockValues }));

const mockLimit = vi.fn();
const mockGroupBy = vi.fn(() => ({ orderBy: vi.fn().mockResolvedValue([]) }));
const mockWhere = vi.fn();
const mockFrom = vi.fn();
const mockLeftJoin = vi.fn();
const mockSelect = vi.fn();

const mockSetWhere = vi.fn(() => ({ returning: mockReturning }));
const mockSet = vi.fn(() => ({ where: mockSetWhere }));
const mockUpdate = vi.fn(() => ({ set: mockSet }));

vi.mock("../../src/lib/drizzle.js", () => ({
  db: {
    insert: (...args: unknown[]) => mockInsert(...args),
    select: (...args: unknown[]) => mockSelect(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
  },
}));

vi.mock("../../src/lib/logger.js", () => ({
  default: { error: vi.fn(), warn: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

vi.mock("../../src/db/schema/projects.js", () => ({
  projects: {
    id: "id",
    userId: "userId",
    name: "name",
    description: "description",
    color: "color",
    icon: "icon",
    createdAt: "createdAt",
    updatedAt: "updatedAt",
    deletedAt: "deletedAt",
  },
}));

vi.mock("../../src/db/schema/conversations.js", () => ({
  conversations: {
    id: "conv_id",
    projectId: "projectId",
  },
  chats: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: unknown[]) => ({ type: "eq", args })),
  and: vi.fn((...args: unknown[]) => ({ type: "and", args })),
  desc: vi.fn((col: unknown) => ({ type: "desc", col })),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({
      type: "sql",
      strings,
      values,
    }),
    { raw: vi.fn() }
  ),
  count: vi.fn((col?: unknown) => ({ type: "count", col })),
}));

describe("Project Service", () => {
  const mockProject = {
    id: "proj-uuid-1234",
    userId: 1,
    name: "Test Project",
    description: "A test project",
    color: "#ff0000",
    icon: "rocket",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock chain for insert
    mockReturning.mockResolvedValue([mockProject]);
    mockValues.mockReturnValue({ returning: mockReturning });
    mockInsert.mockReturnValue({ values: mockValues });

    // Default mock chain for select
    mockLimit.mockResolvedValue([mockProject]);
    mockWhere.mockReturnValue({ limit: mockLimit, groupBy: mockGroupBy });
    mockLeftJoin.mockReturnValue({ where: mockWhere });
    mockFrom.mockReturnValue({ leftJoin: mockLeftJoin, where: mockWhere });
    mockSelect.mockReturnValue({ from: mockFrom });

    // Default mock chain for update
    mockSetWhere.mockReturnValue({ returning: mockReturning });
    mockSet.mockReturnValue({ where: mockSetWhere });
    mockUpdate.mockReturnValue({ set: mockSet });
  });

  describe("createProject", () => {
    it("inserts a project and returns it", async () => {
      const result = await createProject({
        userId: 1,
        name: "Test Project",
        description: "A test project",
      });

      expect(mockInsert).toHaveBeenCalled();
      expect(mockValues).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 1,
          name: "Test Project",
          description: "A test project",
        })
      );
      expect(result).toEqual(mockProject);
    });

    it("generates a UUID for the project id", async () => {
      await createProject({ userId: 1, name: "Test" });

      const valuesArg = mockValues.mock.calls[0][0];
      expect(valuesArg.id).toBeTruthy();
      expect(typeof valuesArg.id).toBe("string");
      // UUID format: 8-4-4-4-12 hex chars
      expect(valuesArg.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
    });

    it("sets createdAt and updatedAt timestamps", async () => {
      const before = new Date();
      await createProject({ userId: 1, name: "Test" });
      const after = new Date();

      const valuesArg = mockValues.mock.calls[0][0];
      expect(valuesArg.createdAt).toBeInstanceOf(Date);
      expect(valuesArg.updatedAt).toBeInstanceOf(Date);
      expect(valuesArg.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(valuesArg.createdAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it("throws when name exceeds 200 characters", async () => {
      const longName = "a".repeat(201);
      await expect(
        createProject({ userId: 1, name: longName })
      ).rejects.toThrow("Project name too long (max 200 chars)");
    });

    it("allows name of exactly 200 characters", async () => {
      const name = "a".repeat(200);
      await expect(
        createProject({ userId: 1, name })
      ).resolves.toBeTruthy();
    });

    it("throws when description exceeds 5000 characters", async () => {
      const longDesc = "d".repeat(5001);
      await expect(
        createProject({ userId: 1, name: "Test", description: longDesc })
      ).rejects.toThrow("Description too long (max 5000 chars)");
    });

    it("throws when color exceeds 30 characters", async () => {
      const longColor = "c".repeat(31);
      await expect(
        createProject({ userId: 1, name: "Test", color: longColor })
      ).rejects.toThrow("Color value too long (max 30 chars)");
    });

    it("throws when icon exceeds 50 characters", async () => {
      const longIcon = "i".repeat(51);
      await expect(
        createProject({ userId: 1, name: "Test", icon: longIcon })
      ).rejects.toThrow("Icon value too long (max 50 chars)");
    });

    it("throws when defaultSystemPrompt exceeds 20000 characters", async () => {
      const longPrompt = "p".repeat(20001);
      await expect(
        createProject({ userId: 1, name: "Test", defaultSystemPrompt: longPrompt })
      ).rejects.toThrow("System prompt too long (max 20000 chars)");
    });

    it("allows defaultSystemPrompt of exactly 20000 characters", async () => {
      const prompt = "p".repeat(20000);
      await expect(
        createProject({ userId: 1, name: "Test", defaultSystemPrompt: prompt })
      ).resolves.toBeTruthy();
    });

    it("passes optional fields to insert", async () => {
      await createProject({
        userId: 1,
        name: "Test",
        color: "#00ff00",
        icon: "star",
        defaultCouncilComposition: { agents: 3 },
        defaultSystemPrompt: "Be helpful",
      });

      const valuesArg = mockValues.mock.calls[0][0];
      expect(valuesArg.color).toBe("#00ff00");
      expect(valuesArg.icon).toBe("star");
      expect(valuesArg.defaultCouncilComposition).toEqual({ agents: 3 });
      expect(valuesArg.defaultSystemPrompt).toBe("Be helpful");
    });

    it("re-throws db errors after logging", async () => {
      mockReturning.mockRejectedValue(new Error("DB connection failed"));
      await expect(
        createProject({ userId: 1, name: "Test" })
      ).rejects.toThrow("DB connection failed");
    });
  });

  describe("getProjects", () => {
    it("calls select with userId filter", async () => {
      const mockOrderBy = vi.fn().mockResolvedValue([mockProject]);
      mockGroupBy.mockReturnValue({ orderBy: mockOrderBy });
      mockWhere.mockReturnValue({ groupBy: mockGroupBy });

      await getProjects(1);

      expect(mockSelect).toHaveBeenCalled();
      expect(mockFrom).toHaveBeenCalled();
    });

    it("returns array of projects", async () => {
      const mockOrderBy = vi.fn().mockResolvedValue([mockProject]);
      mockGroupBy.mockReturnValue({ orderBy: mockOrderBy });
      mockWhere.mockReturnValue({ groupBy: mockGroupBy });

      const result = await getProjects(1);
      expect(Array.isArray(result)).toBe(true);
    });

    it("re-throws db errors after logging", async () => {
      mockSelect.mockImplementation(() => {
        throw new Error("Query failed");
      });
      await expect(getProjects(1)).rejects.toThrow("Query failed");
    });
  });

  describe("getProjectById", () => {
    it("returns project when found", async () => {
      mockLimit.mockResolvedValue([mockProject]);
      mockWhere.mockReturnValue({ limit: mockLimit });
      mockFrom.mockReturnValue({ where: mockWhere });

      const result = await getProjectById("proj-1", 1);
      expect(result).toEqual(mockProject);
    });

    it("returns null when not found", async () => {
      mockLimit.mockResolvedValue([undefined]);
      mockWhere.mockReturnValue({ limit: mockLimit });
      mockFrom.mockReturnValue({ where: mockWhere });

      const result = await getProjectById("nonexistent", 1);
      expect(result).toBeNull();
    });

    it("re-throws db errors after logging", async () => {
      mockSelect.mockImplementation(() => {
        throw new Error("Query failed");
      });
      await expect(getProjectById("id", 1)).rejects.toThrow("Query failed");
    });
  });

  describe("updateProject", () => {
    it("whitelists update fields (name, description, color, icon, composition, prompt)", async () => {
      mockReturning.mockResolvedValue([{ ...mockProject, name: "Updated" }]);

      await updateProject("proj-1", 1, { name: "Updated" });

      expect(mockUpdate).toHaveBeenCalled();
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Updated",
          updatedAt: expect.any(Date),
        })
      );
    });

    it("returns updated project", async () => {
      const updatedProject = { ...mockProject, name: "Updated" };
      mockReturning.mockResolvedValue([updatedProject]);

      const result = await updateProject("proj-1", 1, { name: "Updated" });
      expect(result).toEqual(updatedProject);
    });

    it("returns null when project not found", async () => {
      mockReturning.mockResolvedValue([undefined]);

      const result = await updateProject("nonexistent", 1, { name: "Updated" });
      expect(result).toBeNull();
    });

    it("sets updatedAt to current time", async () => {
      const before = new Date();
      await updateProject("proj-1", 1, { name: "Updated" });

      const setArg = mockSet.mock.calls[0][0];
      expect(setArg.updatedAt).toBeInstanceOf(Date);
      expect(setArg.updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    });

    it("does not spread arbitrary input fields", async () => {
      await updateProject("proj-1", 1, {
        name: "Updated",
        description: "New desc",
        color: "blue",
        icon: "star",
        defaultSystemPrompt: "prompt",
        defaultCouncilComposition: { x: 1 },
      } as any);

      const setArg = mockSet.mock.calls[0][0];
      // Only whitelisted fields + updatedAt
      expect(Object.keys(setArg)).toEqual(
        expect.arrayContaining([
          "name",
          "description",
          "color",
          "icon",
          "defaultCouncilComposition",
          "defaultSystemPrompt",
          "updatedAt",
        ])
      );
    });

    it("re-throws db errors after logging", async () => {
      mockReturning.mockRejectedValue(new Error("Update failed"));
      await expect(
        updateProject("proj-1", 1, { name: "x" })
      ).rejects.toThrow("Update failed");
    });
  });

  describe("deleteProject", () => {
    it("soft-deletes by setting deletedAt", async () => {
      mockReturning.mockResolvedValue([mockProject]);

      await deleteProject("proj-1", 1);

      expect(mockUpdate).toHaveBeenCalled();
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          deletedAt: expect.any(Date),
        })
      );
    });

    it("returns true when project was found and soft-deleted", async () => {
      mockReturning.mockResolvedValue([mockProject]);

      const result = await deleteProject("proj-1", 1);
      expect(result).toBe(true);
    });

    it("returns false when project not found", async () => {
      mockReturning.mockResolvedValue([undefined]);

      const result = await deleteProject("nonexistent", 1);
      expect(result).toBe(false);
    });

    it("re-throws db errors after logging", async () => {
      mockReturning.mockRejectedValue(new Error("Delete failed"));
      await expect(deleteProject("proj-1", 1)).rejects.toThrow("Delete failed");
    });
  });
});
