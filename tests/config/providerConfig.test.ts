import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock env
vi.mock("../../src/config/env.js", () => ({
  env: {
    PROVIDER_REGISTRY_CONFIG: undefined as string | undefined,
  },
}));

// Mock logger
vi.mock("../../src/lib/logger.js", () => ({
  default: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock fs/promises at the top level
vi.mock("fs/promises", () => ({
  readFile: vi.fn(),
  open: vi.fn(),
}));

import {
  DEFAULT_PROVIDER_CONFIG,
  loadProviderConfig,
} from "../../src/config/providerConfig.js";
import { env } from "../../src/config/env.js";

describe("DEFAULT_PROVIDER_CONFIG", () => {
  it("should have a providers array", () => {
    expect(Array.isArray(DEFAULT_PROVIDER_CONFIG.providers)).toBe(true);
    expect(DEFAULT_PROVIDER_CONFIG.providers.length).toBeGreaterThan(0);
  });

  it("should have fallbacks defined", () => {
    expect(DEFAULT_PROVIDER_CONFIG.fallbacks).toBeDefined();
    expect(DEFAULT_PROVIDER_CONFIG.fallbacks!["openai-compat"]).toBe(
      "https://api.openai.com/v1"
    );
  });

  it("each provider should have required fields", () => {
    for (const p of DEFAULT_PROVIDER_CONFIG.providers) {
      expect(p.pattern).toBeDefined();
      expect(p.type).toBeDefined();
      expect(typeof p.defaultMaxTokens).toBe("number");
    }
  });
});

describe("loadProviderConfig", () => {
  beforeEach(() => {
    vi.resetModules();
    (env as any).PROVIDER_REGISTRY_CONFIG = undefined;
  });

  it("should return defaults when no config path is set", async () => {
    const config = await loadProviderConfig();
    expect(config).toEqual(DEFAULT_PROVIDER_CONFIG);
  });

  it("should read from file when env var is set", async () => {
    (env as any).PROVIDER_REGISTRY_CONFIG = "/etc/providers.json";

    const customConfig = {
      providers: [
        {
          pattern: "custom-model",
          type: "openai-compat",
          defaultMaxTokens: 2048,
        },
      ],
    };

    const fs = await import("fs/promises");
    const mockFileHandle = {
      stat: vi.fn().mockResolvedValueOnce({ size: 100 }),
      readFile: vi.fn().mockResolvedValueOnce(JSON.stringify(customConfig)),
      close: vi.fn().mockResolvedValueOnce(undefined),
    };
    (fs.open as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockFileHandle);

    const config = await loadProviderConfig();
    expect(config.providers).toHaveLength(1);
    expect(config.providers[0].pattern).toBe("custom-model");
  });

  it("should return defaults on file read error", async () => {
    (env as any).PROVIDER_REGISTRY_CONFIG = "/nonexistent/path.json";

    const fs = await import("fs/promises");
    (fs.open as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("ENOENT: no such file or directory")
    );

    const config = await loadProviderConfig();
    expect(config).toEqual(DEFAULT_PROVIDER_CONFIG);
  });
});
