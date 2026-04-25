import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock logger
vi.mock("../../src/lib/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Mock env
vi.mock("../../src/config/env.js", () => ({
  env: {
    DATABASE_URL: "postgresql://test:test@localhost:5432/test",
    JWT_SECRET: "test-jwt-secret-min-16-chars",
    MASTER_ENCRYPTION_KEY: "test-master-encryption-key-min-32-characters-long",
  },
}));

import {
  loadPlugin,
  unloadPlugin,
  getPlugin,
  listPlugins,
  clearPlugins,
  setPluginEnabled,
  getAllPluginTools,
  callPluginTool,
  runBeforeDeliberationHooks,
  runAfterDeliberationHooks,
  type PluginManifest,
} from "../../src/services/pluginSDK.service.js";

function makePlugin(name: string, overrides?: Partial<PluginManifest>): PluginManifest {
  return {
    name,
    version: "1.0.0",
    description: `${name} plugin`,
    tools: [
      {
        name: `${name}_tool`,
        description: `Tool from ${name}`,
        inputSchema: { type: "object" },
        handler: async (params) => ({ output: `${name}: ${JSON.stringify(params)}` }),
      },
    ],
    ...overrides,
  };
}

describe("pluginSDK.service", () => {
  beforeEach(() => {
    clearPlugins();
  });

  describe("plugin lifecycle", () => {
    it("should load a plugin", async () => {
      await loadPlugin(makePlugin("test"));

      const plugin = getPlugin("test");
      expect(plugin).toBeDefined();
      expect(plugin!.enabled).toBe(true);
      expect(plugin!.manifest.name).toBe("test");
    });

    it("should call onLoad hook", async () => {
      const onLoad = vi.fn();
      await loadPlugin(makePlugin("hooked", { hooks: { onLoad } }));

      expect(onLoad).toHaveBeenCalledOnce();
      expect(onLoad).toHaveBeenCalledWith(expect.objectContaining({ pluginName: "hooked" }));
    });

    it("should unload a plugin and call onUnload", async () => {
      const onUnload = vi.fn();
      await loadPlugin(makePlugin("removable", { hooks: { onUnload } }));

      const removed = await unloadPlugin("removable");
      expect(removed).toBe(true);
      expect(getPlugin("removable")).toBeUndefined();
      expect(onUnload).toHaveBeenCalledOnce();
    });

    it("should return false for unloading unknown plugin", async () => {
      expect(await unloadPlugin("nonexistent")).toBe(false);
    });

    it("should list all plugins", async () => {
      await loadPlugin(makePlugin("a"));
      await loadPlugin(makePlugin("b"));

      expect(listPlugins()).toHaveLength(2);
    });

    it("should enable/disable plugins", async () => {
      await loadPlugin(makePlugin("toggle"));

      setPluginEnabled("toggle", false);
      expect(getPlugin("toggle")!.enabled).toBe(false);

      setPluginEnabled("toggle", true);
      expect(getPlugin("toggle")!.enabled).toBe(true);
    });

    it("should reject missing required config", async () => {
      const manifest = makePlugin("configured", {
        config: {
          properties: {
            apiKey: { type: "string", description: "API key", required: true },
          },
        },
      });

      await expect(loadPlugin(manifest)).rejects.toThrow('missing required config "apiKey"');
    });

    it("should use default config values", async () => {
      const manifest = makePlugin("defaults", {
        config: {
          properties: {
            timeout: { type: "number", description: "Timeout", required: true, default: 5000 },
          },
        },
      });

      await loadPlugin(manifest);
      expect(getPlugin("defaults")!.config.timeout).toBe(5000);
    });
  });

  describe("tool resolution", () => {
    it("should list tools from all enabled plugins", async () => {
      await loadPlugin(makePlugin("alpha"));
      await loadPlugin(makePlugin("beta"));

      const tools = getAllPluginTools();
      expect(tools).toHaveLength(2);
      expect(tools.map((t) => t.tool.name).sort()).toEqual(["alpha_tool", "beta_tool"]);
    });

    it("should exclude disabled plugins", async () => {
      await loadPlugin(makePlugin("active"));
      await loadPlugin(makePlugin("inactive"));
      setPluginEnabled("inactive", false);

      const tools = getAllPluginTools();
      expect(tools).toHaveLength(1);
      expect(tools[0].tool.name).toBe("active_tool");
    });

    it("should call a plugin tool", async () => {
      await loadPlugin(makePlugin("callable"));

      const result = await callPluginTool("callable_tool", { key: "value" });
      expect(result.output).toContain("callable");
      expect(result.output).toContain("value");
    });

    it("should throw for unknown tool", async () => {
      await expect(callPluginTool("nonexistent", {})).rejects.toThrow("Plugin tool not found");
    });
  });

  describe("deliberation hooks", () => {
    it("should run beforeDeliberation hooks", async () => {
      const beforeHook = vi.fn().mockImplementation(async (topic: string) => `[enhanced] ${topic}`);
      await loadPlugin(makePlugin("enhancer", { hooks: { beforeDeliberation: beforeHook } }));

      const result = await runBeforeDeliberationHooks("test topic");
      expect(result).toBe("[enhanced] test topic");
    });

    it("should chain multiple beforeDeliberation hooks", async () => {
      await loadPlugin(makePlugin("first", {
        hooks: { beforeDeliberation: async (topic) => `A(${topic})` },
      }));
      await loadPlugin(makePlugin("second", {
        hooks: { beforeDeliberation: async (topic) => `B(${topic})` },
      }));

      const result = await runBeforeDeliberationHooks("topic");
      expect(result).toBe("B(A(topic))");
    });

    it("should run afterDeliberation hooks", async () => {
      const afterHook = vi.fn();
      await loadPlugin(makePlugin("logger", { hooks: { afterDeliberation: afterHook } }));

      await runAfterDeliberationHooks({ verdict: "consensus" });
      expect(afterHook).toHaveBeenCalledOnce();
    });

    it("should handle hook failures gracefully", async () => {
      await loadPlugin(makePlugin("failing", {
        hooks: { beforeDeliberation: async () => { throw new Error("Hook crash"); } },
      }));

      // Should not throw, just log and return original topic
      const result = await runBeforeDeliberationHooks("topic");
      expect(result).toBe("topic");
    });
  });
});
