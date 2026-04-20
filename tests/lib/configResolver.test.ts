import { describe, it, expect, vi, beforeEach } from "vitest";
import { 
  validateUserConfig, 
  loadSystemProviders, 
  resolveActiveProviders, 
  selectMaster, 
  composeCouncil 
} from "../../src/lib/configResolver.js";
import { env } from "../../src/config/env.js";
import { CouncilServiceError } from "../../src/services/council.service.js";

vi.mock("../../src/config/env.js", () => ({
  env: {
    OPENAI_API_KEY: "sk-openai",
    GOOGLE_API_KEY: "goog-key",
    ANTHROPIC_API_KEY: "ant-key"
  }
}));

vi.mock("../../src/lib/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() }
}));

describe("Config Resolver", () => {
  describe("validateUserConfig", () => {
    it("should return valid for null config", () => {
      const result = validateUserConfig(null);
      expect(result.valid).toBe(true);
    });

    it("should catch invalid maxAgents", () => {
      const result = validateUserConfig({ maxAgents: 10 } as any);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("maxAgents cannot exceed 6");
    });

    it("should catch duplicate provider names", () => {
      const result = validateUserConfig({
        providers: [
          { name: "p1", enabled: true },
          { name: "p1", enabled: false }
        ]
      } as any);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("Duplicate provider names");
    });

    it("should warn about multiple masters", () => {
      const result = validateUserConfig({
        providers: [
          { name: "p1", enabled: true, role: "master" },
          { name: "p2", enabled: true, role: "master" }
        ]
      } as any);
      expect(result.warnings).toHaveLength(1);
    });
  });

  describe("loadSystemProviders", () => {
    it("should include providers based on env keys", () => {
      const providers = loadSystemProviders();
      expect(providers.some(p => p.name === "openai")).toBe(true);
      expect(providers.some(p => p.name === "ollama")).toBe(true);
    });
  });

  describe("resolveActiveProviders", () => {
    it("should merge system and user configs", () => {
      const system = [{ name: "openai", type: "api", provider: "openai", model: "m1", apiKey: "k1" } as any];
      const user = { providers: [{ name: "openai", priority: 50, role: "master" }] } as any;
      
      const resolved = resolveActiveProviders(system, user);
      expect(resolved[0].priority).toBe(50);
      expect(resolved[0].role).toBe("master");
    });
  });

  describe("selectMaster", () => {
    it("should select the user-specified master", () => {
      const resolved = [
        { name: "p1", enabled: true, role: "master", priority: 1, type: "api" },
        { name: "p2", enabled: true, role: "member", priority: 10, type: "api" }
      ] as any;
      const master = selectMaster(resolved);
      expect(master.name).toBe("p1");
    });

    it("should auto-select highest priority API provider if no custom master", () => {
      const resolved = [
        { name: "p1", enabled: true, role: "member", priority: 1, type: "api" },
        { name: "p2", enabled: true, role: "member", priority: 10, type: "api" }
      ] as any;
      const master = selectMaster(resolved);
      expect(master.name).toBe("p2");
    });

    it("should throw if no enabled providers", () => {
      expect(() => selectMaster([])).toThrow(CouncilServiceError);
    });
  });

  describe("composeCouncil", () => {
    it("should split master and members and respect maxAgents", () => {
      const resolved = [
        { name: "p1", enabled: true, priority: 10, type: "api" },
        { name: "p2", enabled: true, priority: 9, type: "api" },
        { name: "p3", enabled: true, priority: 8, type: "api" }
      ] as any;
      const userConfig = { maxAgents: 2 };
      
      const composition = composeCouncil(resolved, userConfig);
      expect(composition.master.name).toBe("p1");
      expect(composition.members).toHaveLength(1); // maxAgents 2 = 1 master + 1 member
      expect(composition.members[0].name).toBe("p2");
      expect(composition.filtered).toHaveLength(1); // p3 filtered
    });

    it("should filter RPA if disabled", () => {
      const resolved = [
        { name: "p1", enabled: true, priority: 10, type: "api" },
        { name: "p2", enabled: true, priority: 8, type: "api" },
        { name: "rpa1", enabled: true, priority: 9, type: "rpa" }
      ] as any;
      const composition = composeCouncil(resolved, { allowRPA: false });
      expect(composition.members.some(m => m.type === "rpa")).toBe(false);
      expect(composition.members.some(m => m.name === "p2")).toBe(true);
      expect(composition.appliedConstraints).toContain("RPA providers disabled by user config");
    });
  });
});
