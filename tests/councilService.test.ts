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

vi.mock("../src/lib/logger.js", () => ({
  default: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn()
  }
}));

describe("councilService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getDefaultMembers", () => {
    it("should return default members from environment API keys", () => {
      const members = getDefaultMembers(3);
      expect(members).toHaveLength(3);
      expect(members.map(m => m.name)).toContain("Mistral");
      expect(members.map(m => m.name)).toContain("Groq");
      expect(members.map(m => m.name)).toContain("OpenAI");
    });

    it("should duplicate providers to reach requested count", () => {
      // Mock env to only have one key
      vi.mocked(require("../src/config/env.js").env).OPENAI_API_KEY = "test";
      vi.mocked(require("../src/config/env.js").env).MISTRAL_API_KEY = "";
      vi.mocked(require("../src/config/env.js").env).GROQ_API_KEY = "";
      vi.mocked(require("../src/config/env.js").env).GOOGLE_API_KEY = "";
      vi.mocked(require("../src/config/env.js").env).ANTHROPIC_API_KEY = "";
      
      const members = getDefaultMembers(3);
      expect(members).toHaveLength(3);
      expect(members[0].name).toBe("OpenAI");
      expect(members[1].name).toBe("OpenAI");
      expect(members[2].name).toBe("OpenAI");

      // restore env
      vi.mocked(require("../src/config/env.js").env).MISTRAL_API_KEY = "test-mistral-key";
      vi.mocked(require("../src/config/env.js").env).GROQ_API_KEY = "test-groq-key";
      vi.mocked(require("../src/config/env.js").env).GOOGLE_API_KEY = "test-google-key";
      vi.mocked(require("../src/config/env.js").env).ANTHROPIC_API_KEY = "test-anthropic-key";
      vi.mocked(require("../src/config/env.js").env).OPENAI_API_KEY = "test-openai-key";
    });

    it("should limit to requested count", () => {
      const members = getDefaultMembers(2);
      expect(members).toHaveLength(2);
    });

    it("should throw error when no API keys configured", () => {
      vi.mocked(require("../src/config/env.js").env).OPENAI_API_KEY = "";
      vi.mocked(require("../src/config/env.js").env).GOOGLE_API_KEY = "";
      vi.mocked(require("../src/config/env.js").env).ANTHROPIC_API_KEY = "";
      vi.mocked(require("../src/config/env.js").env).MISTRAL_API_KEY = "";
      vi.mocked(require("../src/config/env.js").env).GROQ_API_KEY = "";

      expect(() => getDefaultMembers()).toThrow(CouncilServiceError);
      expect(() => getDefaultMembers()).toThrow("No AI provider API keys configured");

      // Restore env
      vi.mocked(require("../src/config/env.js").env).OPENAI_API_KEY = "test-openai-key";
      vi.mocked(require("../src/config/env.js").env).GOOGLE_API_KEY = "test-google-key";
      vi.mocked(require("../src/config/env.js").env).ANTHROPIC_API_KEY = "test-anthropic-key";
      vi.mocked(require("../src/config/env.js").env).MISTRAL_API_KEY = "test-mistral-key";
      vi.mocked(require("../src/config/env.js").env).GROQ_API_KEY = "test-groq-key";
    });
  });

  describe("getDefaultMaster", () => {
    it("should return Mistral as highest priority master", () => {
      const master = getDefaultMaster();
      
      expect(master.name).toBe("Master");
      expect(master.type).toBe("api");
      expect(master.apiKey).toBe("test-mistral-key");
      expect(master.model).toBe("mistral-large-latest");
    });

    it("should fall back to Groq when Mistral unavailable", () => {
      vi.mocked(require("../src/config/env.js").env).MISTRAL_API_KEY = "";
      const master = getDefaultMaster();
      
      expect(master.apiKey).toBe("test-groq-key");
      expect(master.model).toBe("llama-3.3-70b-versatile");

      // Restore env
      vi.mocked(require("../src/config/env.js").env).MISTRAL_API_KEY = "test-mistral-key";
    });

    it("should fall back to OpenAI when Mistral and Groq unavailable", () => {
      vi.mocked(require("../src/config/env.js").env).MISTRAL_API_KEY = "";
      vi.mocked(require("../src/config/env.js").env).GROQ_API_KEY = "";
      const master = getDefaultMaster();
      
      expect(master.apiKey).toBe("test-openai-key");
      expect(master.model).toBe("gpt-4o");

      // Restore env
      vi.mocked(require("../src/config/env.js").env).MISTRAL_API_KEY = "test-mistral-key";
      vi.mocked(require("../src/config/env.js").env).GROQ_API_KEY = "test-groq-key";
    });

    it("should fall back to Google when OpenAI unavailable", () => {
      vi.mocked(require("../src/config/env.js").env).OPENAI_API_KEY = "";
      vi.mocked(require("../src/config/env.js").env).MISTRAL_API_KEY = "";
      vi.mocked(require("../src/config/env.js").env).GROQ_API_KEY = "";
      const master = getDefaultMaster();
      
      expect(master.apiKey).toBe("test-google-key");
      expect(master.model).toBe("gemini-2.0-flash");

      // Restore env
      vi.mocked(require("../src/config/env.js").env).OPENAI_API_KEY = "test-openai-key";
      vi.mocked(require("../src/config/env.js").env).MISTRAL_API_KEY = "test-mistral-key";
      vi.mocked(require("../src/config/env.js").env).GROQ_API_KEY = "test-groq-key";
    });

    it("should throw error when no API keys available", () => {
      vi.mocked(require("../src/config/env.js").env).OPENAI_API_KEY = "";
      vi.mocked(require("../src/config/env.js").env).GOOGLE_API_KEY = "";
      vi.mocked(require("../src/config/env.js").env).ANTHROPIC_API_KEY = "";
      vi.mocked(require("../src/config/env.js").env).MISTRAL_API_KEY = "";
      vi.mocked(require("../src/config/env.js").env).GROQ_API_KEY = "";

      expect(() => getDefaultMaster()).toThrow(CouncilServiceError);

      // Restore env
      vi.mocked(require("../src/config/env.js").env).OPENAI_API_KEY = "test-openai-key";
      vi.mocked(require("../src/config/env.js").env).GOOGLE_API_KEY = "test-google-key";
      vi.mocked(require("../src/config/env.js").env).ANTHROPIC_API_KEY = "test-anthropic-key";
      vi.mocked(require("../src/config/env.js").env).MISTRAL_API_KEY = "test-mistral-key";
      vi.mocked(require("../src/config/env.js").env).GROQ_API_KEY = "test-groq-key";
    });
  });

  describe("resolveApiKey", () => {
    it("should resolve by baseUrl patterns", () => {
      expect(resolveApiKey({ baseUrl: "api.openrouter.ai" })).toBe("test-openrouter-key");
      expect(resolveApiKey({ baseUrl: "api.groq.com" })).toBe("test-groq-key");
      expect(resolveApiKey({ baseUrl: "api.mistral.ai" })).toBe("test-mistral-key");
      expect(resolveApiKey({ baseUrl: "integrate.api.nvidia.com" })).toBe("test-nvidia-key");
    });

    it("should resolve by model name patterns", () => {
      expect(resolveApiKey({ model: "gemini-pro" })).toBe("test-google-key");
      expect(resolveApiKey({ model: "claude-3-opus" })).toBe("test-anthropic-key");
      expect(resolveApiKey({ model: "mistral-large" })).toBe("test-mistral-key");
      expect(resolveApiKey({ model: "llama3.1-8b" })).toBe("test-cerebras-key");
    });

    it("should fallback to provider type", () => {
      const result = resolveApiKey({ type: "api" });
      expect(result).toBe("test-google-key"); // First available in fallback chain
    });

    it("should default to OpenAI", () => {
      const result = resolveApiKey({});
      expect(result).toBe("test-openai-key");
    });

    it("should return empty string when no keys available", () => {
      vi.mocked(require("../src/config/env.js").env).OPENAI_API_KEY = "";
      vi.mocked(require("../src/config/env.js").env).GOOGLE_API_KEY = "";
      vi.mocked(require("../src/config/env.js").env).ANTHROPIC_API_KEY = "";
      
      const result = resolveApiKey({ model: "unknown-model" });
      expect(result).toBe("");

      // Restore env
      vi.mocked(require("../src/config/env.js").env).OPENAI_API_KEY = "test-openai-key";
      vi.mocked(require("../src/config/env.js").env).GOOGLE_API_KEY = "test-google-key";
      vi.mocked(require("../src/config/env.js").env).ANTHROPIC_API_KEY = "test-anthropic-key";
    });
  });

  describe("resolveMembersApiKeys", () => {
    it("should resolve API keys for all members", () => {
      const members = [
        { type: "api", model: "gpt-4" },
        { type: "api", apiKey: "existing-key", model: "claude-3" },
        { type: "api", model: "gemini-pro" }
      ];

      const resolved = resolveMembersApiKeys(members);

      expect(resolved).toHaveLength(3);
      expect(resolved[0].apiKey).toBe("test-openai-key");
      expect(resolved[1].apiKey).toBe("existing-key");
      expect(resolved[2].apiKey).toBe("test-google-key");
    });

    it("should set default name and model", () => {
      const members = [{ type: "api" }];
      const resolved = resolveMembersApiKeys(members);

      expect(resolved[0].name).toBe("Council Member");
      expect(resolved[0].model).toBe("gpt-4o");
    });
  });

  describe("composeCouncilFromUserConfig", () => {
    const { validateUserConfig, loadSystemProviders, resolveActiveProviders, composeCouncil } = require("../src/lib/configResolver.js");

    it("should compose council from user config", () => {
      const mockUserConfig: UserCouncilConfig = {
        providers: [{ name: "openai", enabled: true }]
      };

      const mockSystemProviders = [{ name: "openai", type: "api", apiKey: "key" }];
      const mockResolvedProviders = [{ name: "openai", type: "api", apiKey: "key", enabled: true }];
      const mockComposition = {
        members: [{ name: "openai", type: "api", apiKey: "key" }],
        master: { name: "openai", type: "api", apiKey: "key" }
      };

      vi.mocked(validateUserConfig).mockReturnValue({ valid: true, errors: [], warnings: [] });
      vi.mocked(loadSystemProviders).mockReturnValue(mockSystemProviders);
      vi.mocked(resolveActiveProviders).mockReturnValue(mockResolvedProviders);
      vi.mocked(composeCouncil).mockReturnValue(mockComposition);

      const result = composeCouncilFromUserConfig(mockUserConfig);

      expect(result).toEqual(mockComposition);
      expect(validateUserConfig).toHaveBeenCalledWith(mockUserConfig);
      expect(loadSystemProviders).toHaveBeenCalled();
      expect(resolveActiveProviders).toHaveBeenCalledWith(mockSystemProviders, mockUserConfig);
      expect(composeCouncil).toHaveBeenCalledWith(mockResolvedProviders, mockUserConfig);
    });

    it("should throw error for invalid config", () => {
      vi.mocked(validateUserConfig).mockReturnValue({
        valid: false,
        errors: ["Invalid config"],
        warnings: []
      });

      expect(() => composeCouncilFromUserConfig({})).toThrow(CouncilServiceError);
      expect(() => composeCouncilFromUserConfig({})).toThrow("Invalid council configuration: Invalid config");
    });

    it("should throw error when no system providers", () => {
      vi.mocked(validateUserConfig).mockReturnValue({ valid: true, errors: [], warnings: [] });
      vi.mocked(loadSystemProviders).mockReturnValue([]);

      expect(() => composeCouncilFromUserConfig({})).toThrow(CouncilServiceError);
      expect(() => composeCouncilFromUserConfig({})).toThrow("No system providers available");
    });
  });

  describe("prepareCouncilMembers", () => {
    it("should use user config when provided", () => {
      const mockUserConfig: UserCouncilConfig = {
        providers: [{ name: "openai", enabled: true }]
      };

      const { validateUserConfig, loadSystemProviders, resolveActiveProviders, composeCouncil } = require("../src/lib/configResolver.js");
      
      const mockComposition = {
        members: [{ name: "openai", type: "api", apiKey: "key" }],
        master: { name: "openai", type: "api", apiKey: "key" }
      };

      vi.mocked(validateUserConfig).mockReturnValue({ valid: true, errors: [], warnings: [] });
      vi.mocked(loadSystemProviders).mockReturnValue([mockComposition.master]);
      vi.mocked(resolveActiveProviders).mockReturnValue([{...mockComposition.master, enabled: true}]);
      vi.mocked(composeCouncil).mockReturnValue(mockComposition);

      const result = prepareCouncilMembers(undefined, mockUserConfig);

      expect(result.members).toHaveLength(1);
      expect(result.master.name).toBe("openai");
    });

    it("should use legacy fallback when no user config", () => {
      const legacyMembers = [
        { type: "api", apiKey: "key1", model: "model1", name: "Agent1" }
      ];

      const result = prepareCouncilMembers(legacyMembers as any);

      expect(result.members).toEqual(legacyMembers);
      expect(result.master.name).toBe("Master");
    });

    it("should use defaults when no members or config provided", () => {
      const result = prepareCouncilMembers();

      expect(result.members).toHaveLength(3);
      expect(result.master.name).toBe("Master");
    });
  });
});
