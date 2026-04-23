import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock drizzle
vi.mock("../../src/lib/drizzle.js", () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    onConflictDoUpdate: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    transaction: vi.fn(),
  },
}));

// Mock DB schema modules
vi.mock("../../src/db/schema/users.js", () => ({
  userArchetypes: {
    userId: "userId",
    archetypeId: "archetypeId",
    isActive: "isActive",
    createdAt: "createdAt",
  },
}));

vi.mock("../../src/db/schema/conversations.js", () => ({
  chats: {
    userId: "userId",
    opinions: "opinions",
    createdAt: "createdAt",
  },
}));

// Mock archetypes config
vi.mock("../../src/config/archetypes.js", () => ({
  ARCHETYPES: {
    architect: {
      id: "architect",
      name: "The Architect",
      thinkingStyle: "Systems thinking, structure-first",
      asks: "What's the underlying structure?",
      blindSpot: "Can over-engineer simple problems",
      systemPrompt: "You are The Architect. Your thinking style is systems-oriented.",
      tools: ["execute_code"],
      icon: "architecture",
      colorBg: "#60a5fa",
    },
    contrarian: {
      id: "contrarian",
      name: "The Contrarian",
      thinkingStyle: "Inversion, devil's advocate",
      asks: "What if the opposite is true?",
      blindSpot: "Can be contrarian for its own sake",
      systemPrompt: "You are The Contrarian. Your role is inversion and playing devil's advocate.",
      icon: "compare_arrows",
      colorBg: "#f43f5e",
    },
    empiricist: {
      id: "empiricist",
      name: "The Empiricist",
      thinkingStyle: "Data-driven, evidence-first",
      asks: "What does the evidence actually show?",
      blindSpot: "Can miss what can't be measured",
      systemPrompt: "You are The Empiricist. Your reasoning is anchored in verifiable data.",
      tools: ["web_search", "read_webpage"],
      icon: "analytics",
      colorBg: "#34d399",
    },
  },
}));

// Mock logger
vi.mock("../../src/lib/logger.js", () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  getValidTools,
  TOOL_REGISTRY,
  validateArchetype,
  rankArchetypesByEngagement,
  cloneDefaultArchetype,
} from "../../src/lib/archetypeManager.js";
import type { UserArchetypeInput } from "../../src/lib/archetypeManager.js";

function makeValidArchetype(overrides: Partial<UserArchetypeInput> = {}): UserArchetypeInput {
  return {
    name: "Test Archetype",
    thinkingStyle: "Analytical and methodical",
    asks: "What is the root cause?",
    blindSpot: "May miss emotional context",
    systemPrompt: "You are a test archetype with analytical thinking patterns.",
    tools: ["web_search"],
    ...overrides,
  };
}

describe("archetypeManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---------- TOOL_REGISTRY / getValidTools ----------

  describe("TOOL_REGISTRY", () => {
    it("contains expected tool IDs", () => {
      expect(TOOL_REGISTRY).toHaveProperty("web_search");
      expect(TOOL_REGISTRY).toHaveProperty("execute_code");
      expect(TOOL_REGISTRY).toHaveProperty("read_webpage");
      expect(TOOL_REGISTRY).toHaveProperty("file_upload");
      expect(TOOL_REGISTRY).toHaveProperty("image_gen");
    });

    it("each tool entry has id, name, description", () => {
      for (const tool of Object.values(TOOL_REGISTRY)) {
        expect(tool).toHaveProperty("id");
        expect(tool).toHaveProperty("name");
        expect(tool).toHaveProperty("description");
        expect(typeof tool.id).toBe("string");
        expect(typeof tool.name).toBe("string");
        expect(typeof tool.description).toBe("string");
      }
    });
  });

  describe("getValidTools", () => {
    it("returns all tool IDs from registry", () => {
      const tools = getValidTools();
      expect(tools).toContain("web_search");
      expect(tools).toContain("execute_code");
      expect(tools).toContain("read_webpage");
      expect(tools).toContain("file_upload");
      expect(tools).toContain("image_gen");
      expect(tools.length).toBe(Object.keys(TOOL_REGISTRY).length);
    });
  });

  // ---------- validateArchetype ----------

  describe("validateArchetype", () => {
    it("valid archetype passes", () => {
      const result = validateArchetype(makeValidArchetype());
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("missing name fails", () => {
      const result = validateArchetype(makeValidArchetype({ name: "" }));
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Name must be at least 2 characters long");
    });

    it("short name (1 char) fails", () => {
      const result = validateArchetype(makeValidArchetype({ name: "A" }));
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("Name"))).toBe(true);
    });

    it("name exactly 2 chars passes", () => {
      const result = validateArchetype(makeValidArchetype({ name: "AB" }));
      expect(result.valid).toBe(true);
    });

    it("name > 100 chars fails", () => {
      const result = validateArchetype(makeValidArchetype({ name: "x".repeat(101) }));
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("less than 100"))).toBe(true);
    });

    it("missing thinkingStyle fails", () => {
      const result = validateArchetype(makeValidArchetype({ thinkingStyle: "" }));
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("Thinking style"))).toBe(true);
    });

    it("short thinkingStyle (< 5 chars) fails", () => {
      const result = validateArchetype(makeValidArchetype({ thinkingStyle: "abc" }));
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("Thinking style"))).toBe(true);
    });

    it("missing asks fails", () => {
      const result = validateArchetype(makeValidArchetype({ asks: "" }));
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("Asks"))).toBe(true);
    });

    it("short asks (< 5 chars) fails", () => {
      const result = validateArchetype(makeValidArchetype({ asks: "why" }));
      expect(result.valid).toBe(false);
    });

    it("missing blindSpot fails", () => {
      const result = validateArchetype(makeValidArchetype({ blindSpot: "" }));
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("Blind spot"))).toBe(true);
    });

    it("short blindSpot (< 5 chars) fails", () => {
      const result = validateArchetype(makeValidArchetype({ blindSpot: "nah" }));
      expect(result.valid).toBe(false);
    });

    it("missing systemPrompt fails", () => {
      const result = validateArchetype(makeValidArchetype({ systemPrompt: "" }));
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("System prompt"))).toBe(true);
    });

    it("short systemPrompt (< 20 chars) fails", () => {
      const result = validateArchetype(makeValidArchetype({ systemPrompt: "Too short." }));
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("System prompt must be at least 20"))).toBe(true);
    });

    it("systemPrompt > 5000 chars fails", () => {
      const result = validateArchetype(
        makeValidArchetype({ systemPrompt: "x".repeat(5001) })
      );
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("less than 5000"))).toBe(true);
    });

    it("invalid tools detected", () => {
      const result = validateArchetype(
        makeValidArchetype({ tools: ["web_search", "nonexistent_tool"] })
      );
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("Invalid tools"))).toBe(true);
      expect(result.errors.some((e) => e.includes("nonexistent_tool"))).toBe(true);
    });

    it("valid tools pass", () => {
      const result = validateArchetype(
        makeValidArchetype({ tools: ["web_search", "execute_code"] })
      );
      expect(result.valid).toBe(true);
    });

    it("no tools is valid", () => {
      const result = validateArchetype(makeValidArchetype({ tools: undefined }));
      expect(result.valid).toBe(true);
    });

    it("empty tools array is valid", () => {
      const result = validateArchetype(makeValidArchetype({ tools: [] }));
      expect(result.valid).toBe(true);
    });

    it("accumulates multiple errors", () => {
      const result = validateArchetype({
        name: "",
        thinkingStyle: "",
        asks: "",
        blindSpot: "",
        systemPrompt: "",
      });
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(5);
    });
  });

  // ---------- rankArchetypesByEngagement ----------

  describe("rankArchetypesByEngagement", () => {
    it("returns sorted by score descending", () => {
      const usage = {
        "The Architect": 5.0,
        "The Contrarian": 10.0,
        "The Empiricist": 2.0,
      };

      const ranked = rankArchetypesByEngagement(usage);

      expect(ranked[0].name).toBe("The Contrarian");
      expect(ranked[0].score).toBe(10.0);
      expect(ranked[1].name).toBe("The Architect");
      expect(ranked[1].score).toBe(5.0);
      expect(ranked[2].name).toBe("The Empiricist");
      expect(ranked[2].score).toBe(2.0);
    });

    it("works with empty usage (all scores 0)", () => {
      const ranked = rankArchetypesByEngagement({});

      expect(ranked.length).toBe(3); // 3 mocked archetypes
      ranked.forEach((r) => expect(r.score).toBe(0));
    });

    it("works with partial usage", () => {
      const usage = { "The Architect": 3.5 };

      const ranked = rankArchetypesByEngagement(usage);
      expect(ranked[0].name).toBe("The Architect");
      expect(ranked[0].score).toBe(3.5);
      // Others should have score 0
      expect(ranked.filter((r) => r.score === 0).length).toBe(2);
    });

    it("includes custom archetypes in ranking", () => {
      const customArchetypes = {
        custom_1: {
          id: "custom_1",
          name: "My Custom Agent",
          thinkingStyle: "Custom thinking",
          asks: "Custom asks",
          blindSpot: "Custom blindspot",
          systemPrompt: "Custom system prompt",
        },
      };
      const usage = { "My Custom Agent": 20.0 };

      const ranked = rankArchetypesByEngagement(usage, customArchetypes as any);

      expect(ranked[0].name).toBe("My Custom Agent");
      expect(ranked[0].score).toBe(20.0);
      expect(ranked.length).toBe(4); // 3 built-in + 1 custom
    });

    it("custom archetypes override built-in with same key", () => {
      const customArchetypes = {
        architect: {
          id: "architect",
          name: "Overridden Architect",
          thinkingStyle: "Custom",
          asks: "Custom",
          blindSpot: "Custom",
          systemPrompt: "Custom",
        },
      };

      const ranked = rankArchetypesByEngagement({}, customArchetypes as any);
      const architectEntry = ranked.find((r) => r.id === "architect");
      expect(architectEntry!.name).toBe("Overridden Architect");
    });

    it("returns objects with id, name, and score", () => {
      const ranked = rankArchetypesByEngagement({});
      ranked.forEach((r) => {
        expect(r).toHaveProperty("id");
        expect(r).toHaveProperty("name");
        expect(r).toHaveProperty("score");
        expect(typeof r.id).toBe("string");
        expect(typeof r.name).toBe("string");
        expect(typeof r.score).toBe("number");
      });
    });
  });

  // ---------- cloneDefaultArchetype ----------

  describe("cloneDefaultArchetype", () => {
    it("clones with 'Custom ' prefix", () => {
      const clone = cloneDefaultArchetype("architect");

      expect(clone.name).toBe("Custom The Architect");
      expect(clone.thinkingStyle).toBe("Systems thinking, structure-first");
      expect(clone.asks).toBe("What's the underlying structure?");
      expect(clone.blindSpot).toBe("Can over-engineer simple problems");
      expect(clone.systemPrompt).toContain("The Architect");
      expect(clone.tools).toEqual(["execute_code"]);
    });

    it("clones icon and colorBg", () => {
      const clone = cloneDefaultArchetype("architect");
      expect(clone.icon).toBe("architecture");
      expect(clone.colorBg).toBe("#60a5fa");
    });

    it("clones archetype without tools (defaults to empty array)", () => {
      const clone = cloneDefaultArchetype("contrarian");
      expect(clone.tools).toEqual([]);
    });

    it("throws for unknown archetype", () => {
      expect(() => cloneDefaultArchetype("nonexistent")).toThrow(
        "Default archetype 'nonexistent' not found"
      );
    });

    it("cloned result does not have archetypeId set", () => {
      const clone = cloneDefaultArchetype("architect");
      expect(clone.archetypeId).toBeUndefined();
    });

    it("cloned result passes validation", () => {
      const clone = cloneDefaultArchetype("architect");
      const result = validateArchetype(clone);
      expect(result.valid).toBe(true);
    });
  });
});
