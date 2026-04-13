import { describe, it, expect, vi, beforeEach } from "vitest";
import { getDefaultMembers, getDefaultMaster, resolveApiKey, resolveMembersApiKeys, composeCouncilFromUserConfig, prepareCouncilMembers, CouncilServiceError } from "../../src/services/councilService.js";
import { env } from "../../src/config/env.js";
import * as libConfig from "../../src/lib/configResolver.js";

vi.mock("../../src/config/env.js", () => ({
  env: {
    OPENAI_API_KEY: "sk-openai",
    GOOGLE_API_KEY: "goog-key",
    ANTHROPIC_API_KEY: "ant-key",
    MISTRAL_API_KEY: "mis-key",
    GROQ_API_KEY: "groq-key",
  }
}));

vi.mock("../../src/lib/configResolver.js", () => ({
  loadSystemProviders: vi.fn(),
  resolveActiveProviders: vi.fn(),
  composeCouncil: vi.fn(),
  validateUserConfig: vi.fn(),
}));

describe("Council Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getDefaultMembers and getDefaultMaster", () => {
    it("should return default members from env", () => {
      const members = getDefaultMembers(2);
      expect(members).toHaveLength(2);
      expect(members[0].name).toBe("Mistral");
    });

    it("should clone members if count exceeds available providers", () => {
      const members = getDefaultMembers(10);
      expect(members).toHaveLength(10);
      expect(members[5].name).toContain("Mistral-");
    });

    it("should throw if no providers available", () => {
      // Temporarily clear env
      const oldMistral = env.MISTRAL_API_KEY;
      const oldGroq = env.GROQ_API_KEY;
      const oldOpenai = env.OPENAI_API_KEY;
      const oldGoogle = env.GOOGLE_API_KEY;
      const oldAnthropic = env.ANTHROPIC_API_KEY;
      
      (env as any).MISTRAL_API_KEY = "";
      (env as any).GROQ_API_KEY = "";
      (env as any).OPENAI_API_KEY = "";
      (env as any).GOOGLE_API_KEY = "";
      (env as any).ANTHROPIC_API_KEY = "";

      expect(() => getDefaultMembers()).toThrow(CouncilServiceError);
      expect(() => getDefaultMaster()).toThrow(CouncilServiceError);

      (env as any).MISTRAL_API_KEY = oldMistral;
      (env as any).GROQ_API_KEY = oldGroq;
      (env as any).OPENAI_API_KEY = oldOpenai;
      (env as any).GOOGLE_API_KEY = oldGoogle;
      (env as any).ANTHROPIC_API_KEY = oldAnthropic;
    });

    it("should return master based on priority", () => {
      const master = getDefaultMaster();
      expect(master.name).toBe("Master");
      expect(master.model).toBe("mistral-large-latest");
    });
  });

  describe("resolveApiKey", () => {
    it("should resolve by baseUrl", () => {
      expect(resolveApiKey({ baseUrl: "https://api.groq.com/openai/v1" })).toBe("groq-key");
      expect(resolveApiKey({ baseUrl: "https://api.mistral.ai/v1" })).toBe("mis-key");
      expect(resolveApiKey({ baseUrl: "https://openrouter.ai/api/v1" })).toBe("sk-openai"); // openrouter fallback in mock? Wait, openrouter key is not in mock
    });

    it("should resolve by model name", () => {
      expect(resolveApiKey({ model: "gemini-pro" })).toBe("goog-key");
      expect(resolveApiKey({ model: "claude-3" })).toBe("ant-key");
      expect(resolveApiKey({ model: "mistral-small" })).toBe("mis-key");
    });

    it("should fallback to OpenAI if nothing matches", () => {
      expect(resolveApiKey({ model: "unknown" })).toBe("sk-openai");
    });
  });

  describe("composeCouncilFromUserConfig", () => {
    it("should compose council and handle validation", () => {
      vi.mocked(libConfig.validateUserConfig).mockReturnValue({ valid: true, errors: [], warnings: ["W1"] } as any);
      vi.mocked(libConfig.loadSystemProviders).mockReturnValue([{ name: "P1" }] as any);
      vi.mocked(libConfig.resolveActiveProviders).mockReturnValue([{ name: "P1" }] as any);
      vi.mocked(libConfig.composeCouncil).mockReturnValue({ members: [], master: {} } as any);

      const result = composeCouncilFromUserConfig({});
      expect(result).toBeDefined();
      expect(libConfig.composeCouncil).toHaveBeenCalled();
    });

    it("should throw on invalid config", () => {
      vi.mocked(libConfig.validateUserConfig).mockReturnValue({ valid: false, errors: ["E1"], warnings: [] } as any);
      expect(() => composeCouncilFromUserConfig({})).toThrow(CouncilServiceError);
    });

    it("should throw if no system providers", () => {
      vi.mocked(libConfig.validateUserConfig).mockReturnValue({ valid: true, errors: [], warnings: [] } as any);
      vi.mocked(libConfig.loadSystemProviders).mockReturnValue([]);
      expect(() => composeCouncilFromUserConfig({})).toThrow(CouncilServiceError);
    });
  });

  describe("prepareCouncilMembers", () => {
    it("should return defaults if no userConfig", () => {
      const result = prepareCouncilMembers();
      expect(result.members.length).toBeGreaterThan(0);
      expect(result.master).toBeDefined();
    });

    it("should use userConfig if provided", () => {
      const mockComposition = {
        members: [{ id: "1", type: "api", apiKey: "k1", model: "m1", name: "n1" }],
        master: { id: "0", type: "api", apiKey: "k0", model: "m0", name: "n0" }
      };
      vi.mocked(libConfig.validateUserConfig).mockReturnValue({ valid: true, errors: [], warnings: [] } as any);
      vi.mocked(libConfig.loadSystemProviders).mockReturnValue([{ name: "P1" }] as any);
      vi.mocked(libConfig.composeCouncil).mockReturnValue(mockComposition as any);

      const result = prepareCouncilMembers(undefined, { memberCount: 1 });
      expect(result.members[0].apiKey).toBe("k1");
      expect(result.master.apiKey).toBe("k0");
    });
  });
});
