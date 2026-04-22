import logger from "../lib/logger.js";

/**
 * Plugin SDK: register custom tool packages that extend AIBYAI capabilities.
 * Plugins declare tools, lifecycle hooks, and configuration schemas.
 */

export interface PluginManifest {
  name: string;
  version: string;
  description: string;
  author?: string;
  tools: PluginToolDef[];
  hooks?: PluginHooks;
  config?: PluginConfigSchema;
}

export interface PluginToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (params: Record<string, unknown>, ctx: PluginContext) => Promise<PluginToolResult>;
}

export interface PluginToolResult {
  output: string;
  metadata?: Record<string, unknown>;
}

export interface PluginContext {
  pluginName: string;
  config: Record<string, unknown>;
  userId?: string;
}

export interface PluginHooks {
  onLoad?: (ctx: PluginContext) => Promise<void>;
  onUnload?: (ctx: PluginContext) => Promise<void>;
  beforeDeliberation?: (topic: string, ctx: PluginContext) => Promise<string>;
  afterDeliberation?: (result: unknown, ctx: PluginContext) => Promise<void>;
}

export interface PluginConfigSchema {
  properties: Record<string, { type: string; description: string; default?: unknown; required?: boolean }>;
}

export interface LoadedPlugin {
  manifest: PluginManifest;
  config: Record<string, unknown>;
  enabled: boolean;
  loadedAt: string;
}

// ─── Plugin Registry ────────────────────────────────────────────────────────

const MAX_PLUGINS = 100;
const plugins = new Map<string, LoadedPlugin>();
const MAX_TOOLS_PER_PLUGIN = 500;

/**
 * Load and register a plugin.
 */
export async function loadPlugin(
  manifest: PluginManifest,
  config: Record<string, unknown> = {},
): Promise<void> {
  // Enforce plugin limit
  if (!plugins.has(manifest.name) && plugins.size >= MAX_PLUGINS) {
    throw new Error(`Plugin limit reached (${MAX_PLUGINS}). Unload a plugin before loading a new one.`);
  }

  // Validate required config
  if (manifest.config) {
    for (const [key, schema] of Object.entries(manifest.config.properties)) {
      if (schema.required && !(key in config)) {
        if (schema.default !== undefined) {
          config[key] = schema.default;
        } else {
          throw new Error(`Plugin ${manifest.name}: missing required config "${key}"`);
        }
      }
    }
  }

  const loaded: LoadedPlugin = {
    manifest,
    config,
    enabled: true,
    loadedAt: new Date().toISOString(),
  };

  plugins.set(manifest.name, loaded);

  // Call onLoad hook
  if (manifest.hooks?.onLoad) {
    const ctx: PluginContext = { pluginName: manifest.name, config };
    await manifest.hooks.onLoad(ctx);
  }

  logger.info({ pluginName: manifest.name, version: manifest.version, tools: manifest.tools.length }, "Plugin loaded");
}

/**
 * Unload a plugin.
 */
export async function unloadPlugin(name: string): Promise<boolean> {
  const plugin = plugins.get(name);
  if (!plugin) return false;

  if (plugin.manifest.hooks?.onUnload) {
    const ctx: PluginContext = { pluginName: name, config: plugin.config };
    await plugin.manifest.hooks.onUnload(ctx);
  }

  plugins.delete(name);
  logger.info({ pluginName: name }, "Plugin unloaded");
  return true;
}

/**
 * Get a loaded plugin.
 */
export function getPlugin(name: string): LoadedPlugin | undefined {
  return plugins.get(name);
}

/**
 * List all loaded plugins.
 */
export function listPlugins(): LoadedPlugin[] {
  return [...plugins.values()];
}

/**
 * Clear all plugins (for testing).
 */
export function clearPlugins(): void {
  plugins.clear();
}

/**
 * Enable/disable a plugin.
 */
export function setPluginEnabled(name: string, enabled: boolean): boolean {
  const plugin = plugins.get(name);
  if (!plugin) return false;
  plugin.enabled = enabled;
  logger.info({ pluginName: name, enabled }, "Plugin status changed");
  return true;
}

// ─── Tool Resolution ────────────────────────────────────────────────────────

/**
 * Get all tools from all enabled plugins.
 */
export function getAllPluginTools(): { pluginName: string; tool: PluginToolDef }[] {
  const tools: { pluginName: string; tool: PluginToolDef }[] = [];

  for (const [name, plugin] of plugins) {
    if (!plugin.enabled) continue;
    for (const tool of plugin.manifest.tools) {
      tools.push({ pluginName: name, tool });
    }
  }

  return tools;
}

/**
 * Find and call a plugin tool by name.
 */
export async function callPluginTool(
  toolName: string,
  params: Record<string, unknown>,
  userId?: string,
): Promise<PluginToolResult> {
  for (const [name, plugin] of plugins) {
    if (!plugin.enabled) continue;

    const tool = plugin.manifest.tools.find((t) => t.name === toolName);
    if (tool) {
      const ctx: PluginContext = { pluginName: name, config: plugin.config, userId };
      return tool.handler(params, ctx);
    }
  }

  throw new Error(`Plugin tool not found: ${toolName}`);
}

// ─── Hook Execution ─────────────────────────────────────────────────────────

/**
 * Run beforeDeliberation hooks across all enabled plugins.
 */
export async function runBeforeDeliberationHooks(topic: string): Promise<string> {
  let modifiedTopic = topic;

  for (const [name, plugin] of plugins) {
    if (!plugin.enabled || !plugin.manifest.hooks?.beforeDeliberation) continue;

    try {
      const ctx: PluginContext = { pluginName: name, config: plugin.config };
      modifiedTopic = await plugin.manifest.hooks.beforeDeliberation(modifiedTopic, ctx);
    } catch (err) {
      logger.warn({ err, pluginName: name }, "beforeDeliberation hook failed");
    }
  }

  return modifiedTopic;
}

/**
 * Run afterDeliberation hooks across all enabled plugins.
 */
export async function runAfterDeliberationHooks(result: unknown): Promise<void> {
  for (const [name, plugin] of plugins) {
    if (!plugin.enabled || !plugin.manifest.hooks?.afterDeliberation) continue;

    try {
      const ctx: PluginContext = { pluginName: name, config: plugin.config };
      await plugin.manifest.hooks.afterDeliberation(result, ctx);
    } catch (err) {
      logger.warn({ err, pluginName: name }, "afterDeliberation hook failed");
    }
  }
}
