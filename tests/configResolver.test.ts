import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  validateUserConfig,
  loadSystemProviders,
  resolveActiveProviders,
  selectMaster,
  composeCouncil
} from "../src/lib/configResolver.js";
import { CouncilServiceError } from "../src/services/councilService.js";
import { Provider } from "../src/lib/providers.js";
import { UserCouncilConfig } from "../src/types/userConfig.js";

// Mock logger
vi.mock("../src/lib/logger.js", () => ({
  default: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn()
  }
}));

// Mock environment
vi.mock("../src/config/env.js", () => ({
  env: {
    OPENAI_API_KEY: "test-openai-key",
    GOOGLE_API_KEY: "test-google-key",
    ANTHROPIC_API_KEY: "test-anthropic-key"
  }
}));

describe("configResolver", () => {
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
      },
      {
        name: "ollama",
        type: "local",
        apiKey: "local",
        model: "llama3",
        baseUrl: "http://localhost:11434"
      }
    ];
  });

  describe("validateUserConfig", () => {
    it("should pass valid config", () => {
      const config: Partial<UserCouncilConfig> = {
        maxAgents: 4,
        providers: [
          { name: "openai", enabled: true, role: "master", priority: 100 },
          { name: "google", enabled: true, role: "member", priority: 90 }
        ]
      };

      const result = validateUserConfig(config);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should reject invalid maxAgents", () => {
      const config: Partial<UserCouncilConfig> = {
        maxAgents: 0
      };

      const result = validateUserConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("maxAgents must be at least 1");
    });

    it("should reject maxAgents > 6", () => {
      const config: Partial<UserCouncilConfig> = {
        maxAgents: 7
      };

      const result = validateUserConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("maxAgents cannot exceed 6");
    });

    it("should reject non-array providers", () => {
      const config: Partial<UserCouncilConfig> = {
        providers: "not-an-array" as any
      };

      const result = validateUserConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("providers must be an array");
    });

    it("should warn about multiple masters", () => {
      const config: Partial<UserCouncilConfig> = {
        providers: [
          { name: "openai", enabled: true, role: "master" },
          { name: "google", enabled: true, role: "master" }
        ]
      };

      const result = validateUserConfig(config);
      expect(result.valid).toBe(true);
      expect(result.warnings).toContain("Multiple masters specified (2), will select highest priority");
    });

    it("should reject duplicate provider names", () => {
      const config: Partial<UserCouncilConfig> = {
        providers: [
          { name: "openai", enabled: true },
          { name: "openai", enabled: true }
        ]
      };

      const result = validateUserConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Duplicate provider names: openai");
    });
  });

  describe("loadSystemProviders", () => {
    it("should load providers from environment", () => {
      const providers = loadSystemProviders();
      expect(providers).toHaveLength(4);
      expect(providers.map(p => p.name)).toContain("openai");
      expect(providers.map(p => p.name)).toContain("google");
      expect(providers.map(p => p.name)).toContain("anthropic");
      expect(providers.map(p => p.name)).toContain("ollama");
    });

    it("should include local ollama even without env key", () => {
      const providers = loadSystemProviders();
      const ollama = providers.find(p => p.name === "ollama");
      expect(ollama).toBeDefined();
      expect(ollama?.type).toBe("local");
    });
  });

  describe("resolveActiveProviders", () => {
    it("should merge system and user config", () => {
      const userConfig: Partial<UserCouncilConfig> = {
        providers: [
          { name: "openai", enabled: false },
          { name: "google", enabled: true, role: "master", priority: 150 }
        ]
      };

      const resolved = resolveActiveProviders(mockSystemProviders, userConfig);
      
      const openai = resolved.find(p => p.name === "openai");
      const google = resolved.find(p => p.name === "google");
      
      expect(openai?.enabled).toBe(false);
      expect(google?.enabled).toBe(true);
      expect(google?.role).toBe("master");
      expect(google?.priority).toBe(150);
    });

    it("should default user config to enabled", () => {
      const userConfig: Partial<UserCouncilConfig> = {
        providers: [
          { name: "openai", enabled: true } // enabled field required
        ]
      };

      const resolved = resolveActiveProviders(mockSystemProviders, userConfig);
      const openai = resolved.find(p => p.name === "openai");
      expect(openai?.enabled).toBe(true);
    });

    it("should warn about unknown providers", async () => {
      const userConfig: Partial<UserCouncilConfig> = {
        providers: [
          { name: "unknown-provider", enabled: true }
        ]
      };

      const logger = await import("../src/lib/logger.js");
      resolveActiveProviders(mockSystemProviders, userConfig);
      
      expect(logger.default.warn).toHaveBeenCalledWith(
        { providerName: "unknown-provider" },
        "User specified provider not found in system configuration"
      );
    });
  });

  describe("selectMaster", () => {
    it("should select user-specified master", () => {
      const resolved = [
        { name: "openai", enabled: true, role: "master" as const, priority: 100, type: "api" as const, apiKey: "key", model: "gpt-4", systemEnabled: true, userEnabled: true },
        { name: "google", enabled: true, role: "member" as const, priority: 90, type: "api" as const, apiKey: "key", model: "gemini", systemEnabled: true, userEnabled: true }
      ];

      const master = selectMaster(resolved);
      expect(master.name).toBe("openai");
      expect(master.role).toBe("master");
    });

    it("should select highest priority master when multiple", () => {
      const resolved = [
        { name: "openai", enabled: true, role: "master" as const, priority: 100, type: "api" as const, apiKey: "key", model: "gpt-4", systemEnabled: true, userEnabled: true },
        { name: "google", enabled: true, role: "master" as const, priority: 150, type: "api" as const, apiKey: "key", model: "gemini", systemEnabled: true, userEnabled: true }
      ];

      const master = selectMaster(resolved);
      expect(master.name).toBe("google");
    });

    it("should auto-select API provider when no master specified", () => {
      const resolved = [
        { name: "ollama", enabled: true, role: "member" as const, priority: 100, type: "local" as const, apiKey: "key", model: "llama3", systemEnabled: true, userEnabled: true },
        { name: "openai", enabled: true, role: "member" as const, priority: 90, type: "api" as const, apiKey: "key", model: "gpt-4", systemEnabled: true, userEnabled: true }
      ];

      const master = selectMaster(resolved);
      expect(master.name).toBe("openai");
      expect(master.role).toBe("master");
    });

    it("should throw error when no enabled providers", () => {
      const resolved = [
        { name: "openai", enabled: false, role: "member" as const, priority: 100, type: "api" as const, apiKey: "key", model: "gpt-4", systemEnabled: true, userEnabled: false }
      ];

      expect(() => selectMaster(resolved)).toThrow(CouncilServiceError);
      expect(() => selectMaster(resolved)).toThrow("No enabled providers available for master selection");
    });
  });

  describe("composeCouncil", () => {
    it("should compose council with master and members", () => {
      const resolved = [
        { name: "openai", enabled: true, role: "master" as const, priority: 100, type: "api" as const, apiKey: "key", model: "gpt-4", systemEnabled: true, userEnabled: true },
        { name: "google", enabled: true, role: "member" as const, priority: 90, type: "api" as const, apiKey: "key", model: "gemini", systemEnabled: true, userEnabled: true },
        { name: "anthropic", enabled: true, role: "member" as const, priority: 80, type: "api" as const, apiKey: "key", model: "claude", systemEnabled: true, userEnabled: true }
      ];

      const council = composeCouncil(resolved, { maxAgents: 3 });

      expect(council.master.name).toBe("openai");
      expect(council.members).toHaveLength(2);
      expect(council.members.map(m => m.name)).toEqual(["google", "anthropic"]);
    });

    it("should respect maxAgents limit", () => {
      const resolved = [
        { name: "openai", enabled: true, role: "master" as const, priority: 100, type: "api" as const, apiKey: "key", model: "gpt-4", systemEnabled: true, userEnabled: true },
        { name: "google", enabled: true, role: "member" as const, priority: 90, type: "api" as const, apiKey: "key", model: "gemini", systemEnabled: true, userEnabled: true },
        { name: "anthropic", enabled: true, role: "member" as const, priority: 80, type: "api" as const, apiKey: "key", model: "claude", systemEnabled: true, userEnabled: true },
        { name: "ollama", enabled: true, role: "member" as const, priority: 70, type: "local" as const, apiKey: "key", model: "llama3", systemEnabled: true, userEnabled: true }
      ];

      const council = composeCouncil(resolved, { maxAgents: 2 });

      expect(council.master.name).toBe("openai");
      expect(council.members).toHaveLength(1);
      expect(council.appliedConstraints).toContain("Limited to 1 agents (had 3)");
    });

    it("should filter out RPA when allowRPA is false", () => {
      const resolved = [
        { name: "openai", enabled: true, role: "master" as const, priority: 100, type: "api" as const, apiKey: "key", model: "gpt-4", systemEnabled: true, userEnabled: true },
        { name: "rpa-provider", enabled: true, role: "member" as const, priority: 90, type: "rpa" as const, apiKey: "key", model: "gpt-4", systemEnabled: true, userEnabled: true },
        { name: "google", enabled: true, role: "member" as const, priority: 80, type: "api" as const, apiKey: "key", model: "gemini", systemEnabled: true, userEnabled: true }
      ];

      const council = composeCouncil(resolved, { allowRPA: false, maxAgents: 3 });

      expect(council.members.map(m => m.name)).not.toContain("rpa-provider");
      expect(council.appliedConstraints).toContain("RPA providers disabled by user config");
    });

    it("should limit to 2 RPA providers", () => {
      const resolved = [
        { name: "openai", enabled: true, role: "master" as const, priority: 100, type: "api" as const, apiKey: "key", model: "gpt-4", systemEnabled: true, userEnabled: true },
        { name: "rpa1", enabled: true, role: "member" as const, priority: 90, type: "rpa" as const, apiKey: "key", model: "gpt-4", systemEnabled: true, userEnabled: true },
        { name: "rpa2", enabled: true, role: "member" as const, priority: 80, type: "rpa" as const, apiKey: "key", model: "gpt-4", systemEnabled: true, userEnabled: true },
        { name: "rpa3", enabled: true, role: "member" as const, priority: 70, type: "rpa" as const, apiKey: "key", model: "gpt-4", systemEnabled: true, userEnabled: true }
      ];

      const council = composeCouncil(resolved, { maxAgents: 5 });

      const rpaMembers = council.members.filter(m => m.type === "rpa");
      expect(rpaMembers).toHaveLength(2);
      expect(council.appliedConstraints).toContain("Limited to 2 RPA providers (had 3)");
    });

    it("should throw error when no providers", () => {
      expect(() => composeCouncil([])).toThrow(CouncilServiceError);
      expect(() => composeCouncil([])).toThrow("No enabled providers available for master selection");
    });
  });
});
