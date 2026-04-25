import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock db
vi.mock("../../src/lib/drizzle.js", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    transaction: vi.fn(async (fn: any) => fn({
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnThis(),
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
      }),
    })),
  }
}));

// Mock schema
vi.mock("../../src/db/schema/users.js", () => ({ userArchetypes: { userId: "userId", isActive: "isActive", createdAt: "createdAt", archetypeId: "archetypeId", id: "id" } }));
vi.mock("../../src/db/schema/conversations.js", () => ({ chats: { userId: "userId", opinions: "opinions", createdAt: "createdAt" } }));

// Mock config
vi.mock("../../src/config/archetypes.js", () => ({
  ARCHETYPES: {
    "default1": { id: "default1", name: "Default 1", thinkingStyle: "T", asks: "A", blindSpot: "B", systemPrompt: "S" }
  }
}));

describe("Archetypes Utility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should merge system and user archetypes", async () => {
    const { getUserArchetypes } = await import("../../src/lib/archetypeManager.js");
    const { db } = await import("../../src/lib/drizzle.js");

    (db.select as any).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockResolvedValue([
        { archetypeId: "ua1", name: "User Archetype 1", thinkingStyle: "T", asks: "A", blindSpot: "B", systemPrompt: "S", isActive: true }
      ])
    });

    const result = await getUserArchetypes(1);
    expect(result["default1"]).toBeDefined();
    expect(result["ua1"]).toBeDefined();
    expect(result["ua1"].name).toBe("User Archetype 1");
  });

  it("should upsert user archetype", async () => {
    const { upsertUserArchetype } = await import("../../src/lib/archetypeManager.js");
    const { db } = await import("../../src/lib/drizzle.js");

    const mockResult = { archetypeId: "new-aid", name: "New", thinkingStyle: "T", asks: "A", blindSpot: "B", systemPrompt: "S", tools: [] };
    
    (db.insert as any).mockReturnValue({
      values: vi.fn().mockReturnThis(),
      onConflictDoUpdate: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([mockResult])
    });

    const result = await upsertUserArchetype(1, mockResult as any);
    expect(result.id).toBe("new-aid");
    expect(db.insert).toHaveBeenCalled();
  });

  it("should validate archetypes strictly", async () => {
    const { validateArchetype } = await import("../../src/lib/archetypeManager.js");
    
    expect(validateArchetype({} as any).valid).toBe(false);
    
    const valid = {
      name: "Valid Name",
      thinkingStyle: "Thinking style long enough",
      asks: "Asks field long enough",
      blindSpot: "Blind spot long enough",
      systemPrompt: "System prompt must be at least 20 characters long..."
    };
    expect(validateArchetype(valid).valid).toBe(true);
    
    expect(validateArchetype({ ...valid, tools: ["invalid"] }).valid).toBe(false);
  });

  it("should toggle status", async () => {
    const { toggleArchetypeStatus } = await import("../../src/lib/archetypeManager.js");
    const { db } = await import("../../src/lib/drizzle.js");

    (db.select as any).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ isActive: true }])
    });
    
    (db.update as any).mockReturnValue({
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ isActive: false }])
    });

    const result = await toggleArchetypeStatus(1, "ua1");
    expect(result).toBe(false);
  });

  it("should calculate usage stats", async () => {
    const { getArchetypeUsage } = await import("../../src/lib/archetypeManager.js");
    const { db } = await import("../../src/lib/drizzle.js");

    (db.select as any).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([
        { opinions: [{ name: "A1" }, { name: "A2" }], createdAt: new Date() },
        { opinions: [{ name: "A1" }], createdAt: new Date() }
      ])
    });

    const usage = await getArchetypeUsage(1);
    expect(usage["A1"]).toBeGreaterThan(0);
    expect(usage["A2"]).toBeGreaterThan(0);
    expect(usage["A1"]).toBeGreaterThan(usage["A2"]);
  });

  it("should import valid archetypes and skip invalid ones", async () => {
    const { importArchetypes } = await import("../../src/lib/archetypeManager.js");
    const { db } = await import("../../src/lib/drizzle.js");

    const data = JSON.stringify([
      { name: "Valid", thinkingStyle: "Thinking", asks: "AsksField", blindSpot: "BlindSpot", systemPrompt: "System prompt long enough..." },
      { name: "Inv" } // too short
    ]);

    // importArchetypes now uses db.transaction, so mock it
    (db.transaction as any).mockImplementation(async (fn: any) => {
      const tx = {
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnThis(),
          onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
        }),
      };
      return fn(tx);
    });

    const result = await importArchetypes(1, data);
    expect(result.imported).toBe(1);
    expect(result.errors).toHaveLength(1);
  });
});
