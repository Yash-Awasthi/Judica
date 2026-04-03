import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getDefaultMembers,
  getDefaultMaster,
  resolveApiKey,
  resolveMembersApiKeys,
  composeCouncilFromUserConfig,
  prepareCouncilMembers,
  CouncilServiceError
} from "../src/services/councilService.js";
import { UserCouncilConfig } from "../src/types/userConfig.js";

// Mock dependencies
vi.mock("../src/lib/configResolver.js", () => ({
  loadSystemProviders: vi.fn(),
  resolveActiveProviders: vi.fn(),
  composeCouncil: vi.fn(),
  validateUserConfig: vi.fn()
}));

vi.mock("../src/config/env.js", () => ({
  env: {
    OPENAI_API_KEY: "test-openai-key",
    GOOGLE_API_KEY: "test-google-key", 
    ANTHROPIC_API_KEY: "test-anthropic-key",
    XIAOMI_API_KEY: "test-xiaomi-key",
    XIAOMI_MIMO_API_KEY: "test-xiaomi-key",
    OPENROUTER_API_KEY: "test-openrouter-key",
    GROQ_API_KEY: "test-groq-key",
    MISTRAL_API_KEY: "test-mistral-key",
    CEREBRAS_API_KEY: "test-cerebras-key",
    NVIDIA_API_KEY: "test-nvidia-key"
  }
}));

vi.mock("../src/lib/configResolver.js", () => ({
  validateUserConfig: vi.fn(),
  loadSystemProviders: vi.fn(),
  resolveActiveProviders: vi.fn(),
  composeCouncil: vi.fn()
}));

describe("councilService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getDefaultMembers", () => {
    it("should return default members from environment API keys", () => {
      const members = getDefaultMembers(3);
      
      expect(members).toHaveLength(3);
      expect(members.map(m => m.name)).toContain("OpenAI");
      expect(members.map(m => m.name)).toContain("Gemini");
      expect(members.map(m => m.name)).toContain("Claude");
      
      members.forEach(member => {
        expect(member.type).toBe("api");
        expect(member.apiKey).toBeTruthy();
        expect(member.model).toBeTruthy();
      });
    });

    it("should duplicate providers to reach requested count", () => {
      const members = getDefaultMembers(5);
      
      expect(members).toHaveLength(5);
      // Should have duplicates since we only have 3 base providers
      const names = members.map(m => m.name);
      expect(names.filter(n => n === "OpenAI").length).toBeGreaterThanOrEqual(1);
    });

    it("should limit to requested count", () => {
      const members = getDefaultMembers(2);
      
      expect(members).toHaveLength(2);
    });

    it("should throw error when no API keys configured", async () => {
      const { env } = await import("../src/config/env.js");
      const originalKeys = { ...env };
      
      // Clear all API keys
      Object.keys(env).forEach(key => {
        if (key.endsWith("_API_KEY")) {
          delete (env as any)[key];
        }
      });
      
      expect(() => getDefaultMembers(3)).toThrow(CouncilServiceError);
      expect(() => getDefaultMembers(3)).toThrow("No AI provider API keys configured. Set OPENAI_API_KEY, GOOGLE_API_KEY, or ANTHROPIC_API_KEY in your environment.");
      
      // Restore original keys
      Object.assign(env, originalKeys);
    });
  });

  describe("getDefaultMaster", () => {
    it("should return OpenAI as highest priority master", () => {
      const master = getDefaultMaster();
      
      expect(master.name).toBe("Master");
      expect(master.type).toBe("api");
      expect(master.apiKey).toBe("test-openai-key");
      expect(master.model).toBe("gpt-4o");
    });

    it("should fall back to Google when OpenAI unavailable", async () => {
      const { env } = await import("../src/config/env.js");
      const originalOpenAI = env.OPENAI_API_KEY;
      delete env.OPENAI_API_KEY;

      const master = getDefaultMaster();
      
      expect(master.apiKey).toBe("test-google-key");
      expect(master.model).toBe("gemini-2.0-flash");

      // Restore
      env.OPENAI_API_KEY = originalOpenAI;
    });

    it("should fall back to Anthropic when others unavailable", async () => {
      const { env } = await import("../src/config/env.js");
      const originalKeys = {
        OPENAI_API_KEY: env.OPENAI_API_KEY,
        GOOGLE_API_KEY: env.GOOGLE_API_KEY
      };
      
      delete env.OPENAI_API_KEY;
      delete env.GOOGLE_API_KEY;

      const master = getDefaultMaster();
      
      expect(master.apiKey).toBe("test-anthropic-key");
      expect(master.model).toBe("claude-sonnet-4-20250514");

      // Restore
      Object.assign(env, originalKeys);
    });

    it("should throw error when no API keys available", async () => {
      const { env } = await import("../src/config/env.js");
      const originalKeys = { ...env };
      
      // Clear all API keys
      Object.keys(env).forEach(key => {
        if (key.endsWith("_API_KEY")) {
          delete (env as any)[key];
        }
      });

      expect(() => getDefaultMaster()).toThrow(CouncilServiceError);
      expect(() => getDefaultMaster()).toThrow("No AI provider API keys configured for master");

      // Restore
      Object.assign(env, originalKeys);
    });
  });

  describe("resolveApiKey", () => {
    it("should resolve by baseUrl patterns", () => {
      const tests = [
        { baseUrl: "https://api.siliconflow.com", expected: "test-xiaomi-key" },
        { baseUrl: "https://openrouter.ai/api", expected: "test-openrouter-key" },
        { baseUrl: "https://api.groq.com", expected: "test-groq-key" },
        { baseUrl: "https://api.mistral.ai", expected: "test-mistral-key" },
        { baseUrl: "https://api.cerebras.ai", expected: "test-cerebras-key" },
        { baseUrl: "https://api.nvidia.com", expected: "test-nvidia-key" }
      ];

      tests.forEach(({ baseUrl, expected }) => {
        const result = resolveApiKey({ baseUrl });
        expect(result).toBe(expected);
      });
    });

    it("should resolve by model name patterns", () => {
      const tests = [
        { model: "microsoft/wizardlm-2-8x22b", expected: "test-openrouter-key" },
        { model: "xiaomi/mimo-70b", expected: "test-xiaomi-key" },
        { model: "mistral-large", expected: "test-mistral-key" },
        { model: "qwen-3-235b", expected: "test-cerebras-key" },
        { model: "gpt-oss", expected: "test-cerebras-key" },
        { model: "llama3.1-8b", expected: "test-cerebras-key" }
      ];

      tests.forEach(({ model, expected }) => {
        const result = resolveApiKey({ model });
        expect(result).toBe(expected);
      });
    });

    it("should fallback to provider type", () => {
      const result = resolveApiKey({ type: "api" });
      expect(result).toBe("test-google-key"); // First available in fallback chain
    });

    it("should default to OpenAI", () => {
      const result = resolveApiKey({});
      expect(result).toBe("test-openai-key");
    });

    it("should return empty string when no keys available", async () => {
      const { env } = await import("../src/config/env.js");
      const originalKeys = { ...env };
      
      // Clear all API keys
      Object.keys(env).forEach(key => {
        if (key.endsWith("_API_KEY")) {
          delete (env as any)[key];
        }
      });

      const result = resolveApiKey({});
      expect(result).toBe("");

      // Restore
      Object.assign(env, originalKeys);
    });
  });

  describe("resolveMembersApiKeys", () => {
    it("should resolve API keys for all members", () => {
      const members = [
        { name: "Member1", model: "gpt-4", baseUrl: "https://api.openai.com" },
        { name: "Member2", model: "claude-3", apiKey: "existing-key" },
        { name: "Member3", model: "gemini-pro" }
      ];

      const resolved = resolveMembersApiKeys(members);

      expect(resolved).toHaveLength(3);
      expect(resolved[0].apiKey).toBe("test-openai-key");
      expect(resolved[1].apiKey).toBe("existing-key");
      expect(resolved[2].apiKey).toBe("test-google-key");
    });

    it("should set default name and model", () => {
      const members = [{}];

      const resolved = resolveMembersApiKeys(members);

      expect(resolved[0].name).toBe("Council Member");
      expect(resolved[0].model).toBe("gpt-4o");
      expect(resolved[0].type).toBe("api");
    });
  });

  describe("composeCouncilFromUserConfig", () => {
    it("should compose council from user config", async () => {
      const { validateUserConfig, loadSystemProviders, resolveActiveProviders, composeCouncil } = 
        await import("../src/lib/configResolver.js");

      (validateUserConfig as any).mockReturnValue({ valid: true, errors: [], warnings: [] });
      (loadSystemProviders as any).mockReturnValue([
        { name: "openai", type: "api", apiKey: "key", model: "gpt-4" }
      ]);
      (resolveActiveProviders as any).mockReturnValue([
        { name: "openai", enabled: true, role: "member", type: "api", apiKey: "key", model: "gpt-4", systemEnabled: true, userEnabled: true, priority: 100 }
      ]);
      (composeCouncil as any).mockReturnValue({
        members: [{ name: "openai", type: "api", apiKey: "key", model: "gpt-4" }],
        master: { name: "openai", type: "api", apiKey: "key", model: "gpt-4" },
        filtered: [],
        appliedConstraints: []
      });

      const userConfig: Partial<UserCouncilConfig> = {
        maxAgents: 3,
        providers: [{ name: "openai", enabled: true }]
      };

      const result = composeCouncilFromUserConfig(userConfig);

      expect(validateUserConfig).toHaveBeenCalledWith(userConfig);
      expect(loadSystemProviders).toHaveBeenCalled();
      expect(resolveActiveProviders).toHaveBeenCalled();
      expect(composeCouncil).toHaveBeenCalled();
      expect(result.members).toHaveLength(1);
    });

    it("should throw error for invalid config", async () => {
      const { validateUserConfig } = await import("../src/lib/configResolver.js");
      
      (validateUserConfig as any).mockReturnValue({
        valid: false,
        errors: ["Invalid configuration"],
        warnings: []
      });

      const userConfig: Partial<UserCouncilConfig> = {
        maxAgents: 0
      };

      expect(() => composeCouncilFromUserConfig(userConfig)).toThrow(CouncilServiceError);
      expect(() => composeCouncilFromUserConfig(userConfig)).toThrow("Invalid council configuration: Invalid configuration");
    });

    it("should throw error when no system providers", async () => {
      const { validateUserConfig, loadSystemProviders } = await import("../src/lib/configResolver.js");
      
      (validateUserConfig as any).mockReturnValue({ valid: true, errors: [], warnings: [] });
      (loadSystemProviders as any).mockReturnValue([]);

      expect(() => composeCouncilFromUserConfig()).toThrow(CouncilServiceError);
      expect(() => composeCouncilFromUserConfig()).toThrow("No system providers available");
    });
  });

  describe("prepareCouncilMembers", () => {
    it("should use user config when provided", async () => {
      // Mock loadSystemProviders to return some providers
      const { loadSystemProviders } = await import("../src/lib/configResolver.js");
      (loadSystemProviders as any).mockReturnValue([
        { name: "openai", type: "api", apiKey: "test-openai-key", model: "gpt-4" }
      ]);

      // Simple test that just verifies the function works with user config
      const userConfig: Partial<UserCouncilConfig> = {
        maxAgents: 2,
        providers: [{ name: "openai", enabled: true, role: "master" }]
      };

      // This should not throw and should return a valid result
      const result = prepareCouncilMembers(undefined, userConfig);
      
      expect(result).toBeDefined();
      expect(result.members).toBeDefined();
      expect(result.master).toBeDefined();
      expect(Array.isArray(result.members)).toBe(true);
    });

    it("should use legacy fallback when no user config", () => {
      const members = getDefaultMembers(2);
      const master = getDefaultMaster();

      const result = prepareCouncilMembers(members);

      expect(result.members).toEqual(members);
      expect(result.master).toEqual(master);
    });

    it("should use defaults when no members or config provided", () => {
      const result = prepareCouncilMembers();

      expect(result.members).toHaveLength(3);
      expect(result.master).toBeDefined();
    });
  });
});
