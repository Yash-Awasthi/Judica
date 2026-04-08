import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getDefaultMembers,
  getDefaultMaster,
  resolveApiKey,
  resolveMembersApiKeys,
  composeCouncilFromUserConfig,
  prepareCouncilMembers,
  CouncilServiceError,
} from "../src/services/councilService.js";
import type { UserCouncilConfig } from "../src/types/userConfig.js";

// ─── 1. Hoist mocks BEFORE any imports that use them ─────────────────────────

// Mock the env module — return a MUTABLE object so tests can mutate values

const mockEnv = {
  OPENAI_API_KEY:    "test-openai-key",
  GOOGLE_API_KEY:    "test-google-key",
  ANTHROPIC_API_KEY: "test-anthropic-key",
  XIAOMI_API_KEY:    "test-xiaomi-key",
  XIAOMI_MIMO_API_KEY: "test-xiaomi-key",
  OPENROUTER_API_KEY: "test-openrouter-key",
  GROQ_API_KEY:      "test-groq-key",
  MISTRAL_API_KEY:   "test-mistral-key",
  CEREBRAS_API_KEY:  "test-cerebras-key",
  NVIDIA_API_KEY:    "test-nvidia-key",
};

vi.mock("../src/config/env.js", () => {
  return {
    env: {
      get OPENAI_API_KEY() { return mockEnv.OPENAI_API_KEY; },
      get GOOGLE_API_KEY() { return mockEnv.GOOGLE_API_KEY; },
      get ANTHROPIC_API_KEY() { return mockEnv.ANTHROPIC_API_KEY; },
      get XIAOMI_API_KEY() { return mockEnv.XIAOMI_API_KEY; },
      get XIAOMI_MIMO_API_KEY() { return mockEnv.XIAOMI_MIMO_API_KEY; },
      get OPENROUTER_API_KEY() { return mockEnv.OPENROUTER_API_KEY; },
      get GROQ_API_KEY() { return mockEnv.GROQ_API_KEY; },
      get MISTRAL_API_KEY() { return mockEnv.MISTRAL_API_KEY; },
      get CEREBRAS_API_KEY() { return mockEnv.CEREBRAS_API_KEY; },
      get NVIDIA_API_KEY() { return mockEnv.NVIDIA_API_KEY; }
    }
  };
});

vi.mock("../src/lib/configResolver.js", () => ({
  loadSystemProviders:   vi.fn(),
  resolveActiveProviders: vi.fn(),
  composeCouncil:        vi.fn(),
  validateUserConfig:    vi.fn(),
}));

vi.mock("../src/lib/logger.js", () => ({
  default: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

// ─── 2. Import mocked modules AFTER vi.mock() calls ──────────────────────────
// Vitest hoists vi.mock() to the top automatically, so these imports
// will receive the mocked versions.
import {
  loadSystemProviders,
  resolveActiveProviders,
  composeCouncil,
  validateUserConfig,
} from "../src/lib/configResolver.js";

// ─── 3. Helper: reset env to known-good state after each mutation test ────────
const ORIGINAL_ENV = { ...mockEnv };

function resetEnv() {
  Object.assign(mockEnv, ORIGINAL_ENV);
}

// ─────────────────────────────────────────────────────────────────────────────

describe("councilService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetEnv(); // ← replaces ALL the vi.mocked(require(...)) restore calls
  });

  // ── getDefaultMembers ──────────────────────────────────────────────────────
  describe("getDefaultMembers", () => {
    it("should return default members from environment API keys", () => {
      const members = getDefaultMembers(3);
      expect(members).toHaveLength(3);
      expect(members.map((m) => m.name)).toContain("Mistral");
      expect(members.map((m) => m.name)).toContain("Groq");
      expect(members.map((m) => m.name)).toContain("OpenAI");
    });

    it("should duplicate providers to reach requested count", () => {
      // Blank every key except OpenAI
      mockEnv.MISTRAL_API_KEY   = "";
      mockEnv.GROQ_API_KEY      = "";
      mockEnv.GOOGLE_API_KEY    = "";
      mockEnv.ANTHROPIC_API_KEY = "";
      // OPENAI_API_KEY stays "test-openai-key"

      const members = getDefaultMembers(3);
      expect(members).toHaveLength(3);
      expect(members[0].name).toBe("OpenAI");
      expect(members[1].name).toBe("OpenAI");
      expect(members[2].name).toBe("OpenAI");
      // resetEnv() runs in next beforeEach — no manual restore needed
    });

    it("should limit to requested count", () => {
      const members = getDefaultMembers(2);
      expect(members).toHaveLength(2);
    });

    it("should throw error when no API keys configured", () => {
      mockEnv.OPENAI_API_KEY    = "";
      mockEnv.GOOGLE_API_KEY    = "";
      mockEnv.ANTHROPIC_API_KEY = "";
      mockEnv.MISTRAL_API_KEY   = "";
      mockEnv.GROQ_API_KEY      = "";

      expect(() => getDefaultMembers()).toThrow(CouncilServiceError);
      expect(() => getDefaultMembers()).toThrow("No AI provider API keys configured");
    });
  });

  // ── getDefaultMaster ───────────────────────────────────────────────────────
  describe("getDefaultMaster", () => {
    it("should return Mistral as highest priority master", () => {
      const master = getDefaultMaster();
      expect(master.name).toBe("Master");
      expect(master.type).toBe("api");
      expect(master.apiKey).toBe("test-mistral-key");
      expect(master.model).toBe("mistral-large-latest");
    });

    it("should fall back to Groq when Mistral unavailable", () => {
      mockEnv.MISTRAL_API_KEY = "";
      const master = getDefaultMaster();
      expect(master.apiKey).toBe("test-groq-key");
      expect(master.model).toBe("llama-3.3-70b-versatile");
    });

    it("should fall back to OpenAI when Mistral and Groq unavailable", () => {
      mockEnv.MISTRAL_API_KEY = "";
      mockEnv.GROQ_API_KEY    = "";
      const master = getDefaultMaster();
      expect(master.apiKey).toBe("test-openai-key");
      expect(master.model).toBe("gpt-4o");
    });

    it("should fall back to Google when OpenAI/Mistral/Groq unavailable", () => {
      mockEnv.OPENAI_API_KEY  = "";
      mockEnv.MISTRAL_API_KEY = "";
      mockEnv.GROQ_API_KEY    = "";
      const master = getDefaultMaster();
      expect(master.apiKey).toBe("test-google-key");
      expect(master.model).toBe("gemini-2.0-flash");
    });

    it("should throw error when no API keys available", () => {
      mockEnv.OPENAI_API_KEY    = "";
      mockEnv.GOOGLE_API_KEY    = "";
      mockEnv.ANTHROPIC_API_KEY = "";
      mockEnv.MISTRAL_API_KEY   = "";
      mockEnv.GROQ_API_KEY      = "";
      expect(() => getDefaultMaster()).toThrow(CouncilServiceError);
    });
  });

  // ── resolveApiKey ──────────────────────────────────────────────────────────
  describe("resolveApiKey", () => {
    it("should resolve by baseUrl patterns", () => {
      expect(resolveApiKey({ baseUrl: "https://api.openrouter.ai/v1" })).toBe("test-openrouter-key");
      expect(resolveApiKey({ baseUrl: "https://api.groq.com/openai/v1" })).toBe("test-groq-key");
      expect(resolveApiKey({ baseUrl: "https://api.mistral.ai/v1" })).toBe("test-mistral-key");
      expect(resolveApiKey({ baseUrl: "https://integrate.api.nvidia.com/v1" })).toBe("test-nvidia-key");
    });

    it("should resolve by model name patterns", () => {
      expect(resolveApiKey({ model: "gemini-pro" })).toBe("test-google-key");
      expect(resolveApiKey({ model: "claude-3-opus" })).toBe("test-anthropic-key");
      expect(resolveApiKey({ model: "mistral-large" })).toBe("test-mistral-key");
      expect(resolveApiKey({ model: "llama3.1-8b" })).toBe("test-cerebras-key");
    });

    it("should fallback to provider type", () => {
      const result = resolveApiKey({ type: "api" });
      // First available in the google → anthropic → openai fallback chain
      expect(result).toBe("test-google-key");
    });

    it("should default to OpenAI key", () => {
      const result = resolveApiKey({});
      expect(result).toBe("test-openai-key");
    });

    it("should return empty string when no keys available", () => {
      mockEnv.OPENAI_API_KEY    = "";
      mockEnv.GOOGLE_API_KEY    = "";
      mockEnv.ANTHROPIC_API_KEY = "";
      const result = resolveApiKey({ model: "unknown-model" });
      expect(result).toBe("");
    });
  });

  // ── resolveMembersApiKeys ──────────────────────────────────────────────────
  describe("resolveMembersApiKeys", () => {
    it("should resolve API keys for all members", () => {
      const members = [
        { type: "api", model: "gpt-4" },
        { type: "api", apiKey: "existing-key", model: "claude-3" },
        { type: "api", model: "gemini-pro" },
      ];
      const resolved = resolveMembersApiKeys(members);
      expect(resolved).toHaveLength(3);
      expect(resolved[0].apiKey).toBe("test-google-key");
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

  // ── composeCouncilFromUserConfig ───────────────────────────────────────────
  describe("composeCouncilFromUserConfig", () => {
    it("should compose council from user config", () => {
      const mockUserConfig: UserCouncilConfig = {
        providers: [{ name: "openai", enabled: true }],
      };
      const mockSystemProviders = [{ name: "openai", type: "api", apiKey: "key" }];
      const mockResolvedProviders = [{ name: "openai", type: "api", apiKey: "key", enabled: true }];
      const mockComposition = {
        members: [{ name: "openai", type: "api", apiKey: "key" }],
        master:  { name: "openai", type: "api", apiKey: "key" },
      };

      vi.mocked(validateUserConfig).mockReturnValue({ valid: true, errors: [], warnings: [] });
      vi.mocked(loadSystemProviders).mockReturnValue(mockSystemProviders as any);
      vi.mocked(resolveActiveProviders).mockReturnValue(mockResolvedProviders as any);
      vi.mocked(composeCouncil).mockReturnValue(mockComposition as any);

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
        warnings: [],
      });
      expect(() => composeCouncilFromUserConfig({})).toThrow(CouncilServiceError);
      expect(() => composeCouncilFromUserConfig({})).toThrow(
        "Invalid council configuration: Invalid config"
      );
    });

    it("should throw error when no system providers", () => {
      vi.mocked(validateUserConfig).mockReturnValue({ valid: true, errors: [], warnings: [] });
      vi.mocked(loadSystemProviders).mockReturnValue([]);
      expect(() => composeCouncilFromUserConfig({})).toThrow(CouncilServiceError);
      expect(() => composeCouncilFromUserConfig({})).toThrow("No system providers available");
    });
  });

  // ── prepareCouncilMembers ──────────────────────────────────────────────────
  describe("prepareCouncilMembers", () => {
    it("should use user config when provided", () => {
      const mockUserConfig: UserCouncilConfig = {
        providers: [{ name: "openai", enabled: true }],
      };
      const mockComposition = {
        members: [{ name: "openai", type: "api", apiKey: "key", model: "gpt-4o" }],
        master:  { name: "openai", type: "api", apiKey: "key", model: "gpt-4o" },
      };

      vi.mocked(validateUserConfig).mockReturnValue({ valid: true, errors: [], warnings: [] });
      vi.mocked(loadSystemProviders).mockReturnValue([mockComposition.master] as any);
      vi.mocked(resolveActiveProviders).mockReturnValue([
        { ...mockComposition.master, enabled: true },
      ] as any);
      vi.mocked(composeCouncil).mockReturnValue(mockComposition as any);

      const result = prepareCouncilMembers(undefined, mockUserConfig);
      expect(result.members).toHaveLength(1);
      expect(result.master.name).toBe("openai");
    });

    it("should use legacy fallback when no user config", () => {
      const legacyMembers = [
        { type: "api" as const, apiKey: "key1", model: "model1", name: "Agent1" },
      ];
      const result = prepareCouncilMembers(legacyMembers);
      expect(result.members).toEqual(legacyMembers);
      expect(result.master.name).toBe("Master");
    });

    it("should use defaults when nothing is provided", () => {
      const result = prepareCouncilMembers();
      expect(result.members.length).toBeGreaterThan(0);
      expect(result.master).toBeDefined();
      expect(result.master.name).toBe("Master");
    });
  });
});
