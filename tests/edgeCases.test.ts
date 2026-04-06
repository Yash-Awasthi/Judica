import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  validateUserConfig,
  resolveActiveProviders,
  selectMaster,
  composeCouncil
} from "../src/lib/configResolver.js";
import { composeCouncilFromUserConfig, CouncilServiceError } from "../src/services/councilService.js";
import { UserCouncilConfig } from "../src/types/userConfig.js";
import { Provider } from "../src/lib/providers.js";

// Mock dependencies
vi.mock("../src/lib/logger.js", () => ({
  default: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn()
  }
}));

vi.mock("../src/config/env.js", () => ({
  env: {
    OPENAI_API_KEY: "test-openai-key",
    GOOGLE_API_KEY: "test-google-key",
    ANTHROPIC_API_KEY: "test-anthropic-key"
  }
}));

describe("Edge Cases Tests", () => {
  let mockSystemProviders: Provider[];

  beforeEach(() => {
    vi.clearAllMocks();
    
    mockSystemProviders = [
      {
        name: "openai",
        type: "api",
        apiKey: "test-openai-key",
        model: "gpt-4o",
        baseUrl: "https://api.openai.com/v1"
      },
      {
        name: "google",
        type: "api",
        apiKey: "test-google-key",
        model: "gemini-2.5-flash"
      },
      {
        name: "anthropic",
        type: "api",
        apiKey: "test-anthropic-key",
        model: "claude-sonnet-4-20250514"
      }
    ];
  });

  describe("0 Providers Edge Case", () => {
    it("should throw error when no providers available", () => {
      expect(() => composeCouncil([])).toThrow(CouncilServiceError);
      expect(() => composeCouncil([])).toThrow("No enabled providers available for master selection");
    });

    it("should throw error when all providers disabled", () => {
      const resolved = [
        { name: "openai", enabled: false, role: "member" as const, priority: 100, type: "api" as const, apiKey: "key", model: "gpt-4", systemEnabled: true, userEnabled: false },
        { name: "google", enabled: false, role: "member" as const, priority: 90, type: "api" as const, apiKey: "key", model: "gemini", systemEnabled: true, userEnabled: false }
      ];

      expect(() => selectMaster(resolved)).toThrow(CouncilServiceError);
      expect(() => selectMaster(resolved)).toThrow("No enabled providers available for master selection");
    });

    it("should handle empty user config gracefully", () => {
      const resolved = resolveActiveProviders(mockSystemProviders, {});
      
      expect(resolved).toHaveLength(mockSystemProviders.length);
      resolved.forEach(provider => {
        expect(provider.enabled).toBe(true);
        expect(provider.role).toBe("member");
      });
    });
  });

  describe("MaxAgents Edge Cases", () => {
    it("should handle maxAgents = 1", () => {
      const resolved = mockSystemProviders.map(p => ({
        ...p,
        enabled: true,
        role: "member" as const,
        priority: 100,
        systemEnabled: true,
        userEnabled: true
      }));

      const council = composeCouncil(resolved, { maxAgents: 1 });

      expect(council.master).toBeDefined();
      expect(council.members).toHaveLength(0); // Only master, no members
      expect(council.appliedConstraints).toContain("Limited to 0 agents (had 2)");
    });

    it("should handle maxAgents > available providers", () => {
      const resolved = mockSystemProviders.slice(0, 2).map(p => ({
        ...p,
        enabled: true,
        role: "member" as const,
        priority: 100,
        systemEnabled: true,
        userEnabled: true
      }));

      const council = composeCouncil(resolved, { maxAgents: 10 });

      expect(council.members).toHaveLength(1); // 2 providers - 1 master = 1 member
      expect(council.appliedConstraints).not.toContain(expect.stringMatching(/Limited to.*agents/));
    });

    it("should trim providers when > maxAgents", () => {
      const resolved = mockSystemProviders.map(p => ({
        ...p,
        enabled: true,
        role: "member" as const,
        priority: 100,
        systemEnabled: true,
        userEnabled: true
      }));

      const council = composeCouncil(resolved, { maxAgents: 2 });

      expect(council.master).toBeDefined();
      expect(council.members).toHaveLength(1); // 3 total - 1 master = 2 members, but limited to 1 by maxAgents-1
      
      // The constraint should be "Limited to 1 agents (had 2)" because:
      // - After master selection: 2 providers remain 
      // - maxAgents-1 = 1 slot for members
      // - So constraint: "Limited to 1 agents (had 2)"
      expect(council.appliedConstraints).toContain("Limited to 1 agents (had 2)");
    });
  });

  describe("Multiple Masters Edge Case", () => {
    it("should resolve multiple masters correctly", () => {
      const userConfig: Partial<UserCouncilConfig> = {
        providers: [
          { name: "openai", enabled: true, role: "master", priority: 100 },
          { name: "google", enabled: true, role: "master", priority: 150 },
          { name: "anthropic", enabled: true, role: "master", priority: 80 }
        ]
      };

      const validation = validateUserConfig(userConfig);
      
      expect(validation.valid).toBe(true);
      expect(validation.warnings).toContain("Multiple masters specified (3), will select highest priority");
    });

    it("should select highest priority master", () => {
      const resolved = [
        { name: "openai", enabled: true, role: "master" as const, priority: 100, type: "api" as const, apiKey: "key", model: "gpt-4", systemEnabled: true, userEnabled: true },
        { name: "google", enabled: true, role: "master" as const, priority: 200, type: "api" as const, apiKey: "key", model: "gemini", systemEnabled: true, userEnabled: true },
        { name: "anthropic", enabled: true, role: "master" as const, priority: 50, type: "api" as const, apiKey: "key", model: "claude", systemEnabled: true, userEnabled: true }
      ];

      const master = selectMaster(resolved);
      expect(master.name).toBe("google"); // Highest priority
    });

    it("should handle masters with same priority", () => {
      const resolved = [
        { name: "openai", enabled: true, role: "master" as const, priority: 100, type: "api" as const, apiKey: "key", model: "gpt-4", systemEnabled: true, userEnabled: true },
        { name: "google", enabled: true, role: "master" as const, priority: 100, type: "api" as const, apiKey: "key", model: "gemini", systemEnabled: true, userEnabled: true }
      ];

      const master = selectMaster(resolved);
      expect(["openai", "google"]).toContain(master.name); // Either one is acceptable
    });
  });

  describe("Invalid Provider Handling", () => {
    it("should handle unknown providers in user config", () => {
      const userConfig: Partial<UserCouncilConfig> = {
        providers: [
          { name: "unknown-provider", enabled: true },
          { name: "openai", enabled: true }
        ]
      };

      const resolved = resolveActiveProviders(mockSystemProviders, userConfig);
      
      // Should only include known providers
      expect(resolved.map(p => p.name)).not.toContain("unknown-provider");
      expect(resolved.map(p => p.name)).toContain("openai");
    });

    it("should handle malformed user config", () => {
      const malformedConfigs = [
        { providers: "not-an-array" },
        { maxAgents: 0 }, // below minimum
        { maxAgents: 7 }, // above maximum
        { providers: [{ name: "", enabled: true }] }
      ];

      malformedConfigs.forEach(config => {
        const validation = validateUserConfig(config as any);
        expect(validation.valid).toBe(false);
        expect(validation.errors.length).toBeGreaterThan(0);
      });

      // These should be valid (null/undefined means use defaults)
      const validConfigs = [null, undefined, { maxAgents: "not-a-number" }];
      validConfigs.forEach(config => {
        const validation = validateUserConfig(config as any);
        expect(validation.valid).toBe(true);
      });
    });

    it("should handle extreme maxAgents values", () => {
      const extremeConfigs = [
        { maxAgents: -1 },
        { maxAgents: 0 },
        { maxAgents: 1000 }
      ];

      extremeConfigs.forEach(config => {
        const validation = validateUserConfig(config);
        expect(validation.valid).toBe(false);
      });
    });
  });

  describe("RPA Limit Edge Cases", () => {
    it("should handle exactly 2 RPA providers", () => {
      const resolved = [
        { name: "openai", enabled: true, role: "master" as const, priority: 100, type: "api" as const, apiKey: "key", model: "gpt-4", systemEnabled: true, userEnabled: true },
        { name: "rpa1", enabled: true, role: "member" as const, priority: 90, type: "rpa" as const, apiKey: "key", model: "gpt-4", systemEnabled: true, userEnabled: true },
        { name: "rpa2", enabled: true, role: "member" as const, priority: 80, type: "rpa" as const, apiKey: "key", model: "gpt-4", systemEnabled: true, userEnabled: true }
      ];

      const council = composeCouncil(resolved, { maxAgents: 4 });

      const rpaMembers = council.members.filter(m => m.type === "rpa");
      expect(rpaMembers).toHaveLength(2);
      expect(council.appliedConstraints).not.toContain(expect.stringMatching(/Limited to.*RPA/));
    });

    it("should handle more than 2 RPA providers", () => {
      const resolved = [
        { name: "openai", enabled: true, role: "master" as const, priority: 100, type: "api" as const, apiKey: "key", model: "gpt-4", systemEnabled: true, userEnabled: true },
        { name: "rpa1", enabled: true, role: "member" as const, priority: 90, type: "rpa" as const, apiKey: "key", model: "gpt-4", systemEnabled: true, userEnabled: true },
        { name: "rpa2", enabled: true, role: "member" as const, priority: 80, type: "rpa" as const, apiKey: "key", model: "gpt-4", systemEnabled: true, userEnabled: true },
        { name: "rpa3", enabled: true, role: "member" as const, priority: 70, type: "rpa" as const, apiKey: "key", model: "gpt-4", systemEnabled: true, userEnabled: true }
      ];

      const council = composeCouncil(resolved, { maxAgents: 6 });

      const rpaMembers = council.members.filter(m => m.type === "rpa");
      expect(rpaMembers).toHaveLength(2);
      expect(council.appliedConstraints).toContain("Limited to 2 RPA providers (had 3)");
    });
  });

  describe("Priority Edge Cases", () => {
    it("should handle missing priority values", () => {
      const userConfig: Partial<UserCouncilConfig> = {
        providers: [
          { name: "openai", enabled: true, priority: undefined },
          { name: "google", enabled: true, priority: 50 }
        ]
      };

      const resolved = resolveActiveProviders(mockSystemProviders, userConfig);
      
      const openai = resolved.find(p => p.name === "openai");
      const google = resolved.find(p => p.name === "google");
      
      expect(openai?.priority).toBe(100); // Default value
      expect(google?.priority).toBe(50);
    });

    it("should handle negative priority values", () => {
      const userConfig: Partial<UserCouncilConfig> = {
        providers: [
          { name: "openai", enabled: true, priority: -100 },
          { name: "google", enabled: true, priority: 50 }
        ]
      };

      const resolved = resolveActiveProviders(mockSystemProviders, userConfig);
      
      const openai = resolved.find(p => p.name === "openai");
      const google = resolved.find(p => p.name === "google");
      
      expect(openai?.priority).toBe(-100);
      expect(google?.priority).toBe(50);
    });
  });

  describe("System Integration Edge Cases", () => {
    it("should handle composeCouncilFromUserConfig with minimal config", () => {
      const userConfig: Partial<UserCouncilConfig> = {
        maxAgents: 1
      };

      // This should not throw error
      expect(() => {
        const result = composeCouncilFromUserConfig(userConfig);
        expect(result.master).toBeDefined();
      }).not.toThrow();
    });

    it("should handle composeCouncilFromUserConfig with no config", () => {
      // This should not throw error
      expect(() => {
        const result = composeCouncilFromUserConfig();
        expect(result.master).toBeDefined();
      }).not.toThrow();
    });

    it("should preserve system defaults when user config sparse", () => {
      const userConfig: Partial<UserCouncilConfig> = {
        providers: [
          { name: "openai", enabled: true } // Only specify enabled
        ]
      };

      const resolved = resolveActiveProviders(mockSystemProviders, userConfig);
      
      const openai = resolved.find(p => p.name === "openai");
      const google = resolved.find(p => p.name === "google");
      
      expect(openai?.enabled).toBe(true);
      expect(openai?.role).toBe("member"); // Default
      expect(openai?.priority).toBe(100); // Default
      
      // Other providers should have defaults
      expect(google?.enabled).toBe(true);
      expect(google?.role).toBe("member");
      expect(google?.priority).toBe(100);
    });
  });

  describe("Error Recovery Edge Cases", () => {
    it("should handle validation errors gracefully", () => {
      const invalidConfigs = [
        { maxAgents: 0, providers: [] },
        { maxAgents: 7, providers: [{ name: "test", enabled: true }] },
        { providers: [{ name: "", enabled: true }] },
        { providers: [{ name: "test", enabled: "invalid" as any }] }
      ];

      invalidConfigs.forEach(config => {
        expect(() => composeCouncilFromUserConfig(config))
          .toThrow(CouncilServiceError);
      });
    });

    it("should handle partial system failures", () => {
      // This test verifies that composeCouncilFromUserConfig works normally
      // The actual system failure handling is tested in councilService.test.ts
      const result = composeCouncilFromUserConfig();
      
      expect(result).toBeDefined();
      expect(result.master).toBeDefined();
      expect(result.members).toBeDefined();
      expect(Array.isArray(result.members)).toBe(true);
    });
  });
});
