/**
 * Tool federation service.
 *
 * Browse, install, and manage MCP ecosystem tools from external registries.
 * Tools are installed into the local plugin registry and become available
 * for agent use in deliberations and workflows.
 */

import crypto from "crypto";
import logger from "../lib/logger.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface FederatedTool {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  category: ToolCategory;
  mcpServerUrl?: string;
  schema: ToolSchema;
  tags: string[];
  downloads: number;
  rating: number;
  verified: boolean;
  publishedAt: Date;
}

export type ToolCategory =
  | "search" | "data" | "code" | "communication"
  | "productivity" | "analytics" | "devops" | "ai" | "other";

export interface ToolSchema {
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
}

export interface InstalledTool {
  toolId: string;
  name: string;
  version: string;
  installedAt: Date;
  installedBy: number;
  enabled: boolean;
  config?: Record<string, unknown>;
}

export interface ToolSearchOptions {
  query?: string;
  category?: ToolCategory;
  verified?: boolean;
  sortBy?: "downloads" | "rating" | "recent";
  limit?: number;
  offset?: number;
}

// ─── Registry (in-memory, upgradeable to external registry) ─────────────────

// P27-05: Cap registry and installed maps to prevent unbounded memory growth
const MAX_REGISTRY_SIZE = 1000;
const MAX_INSTALLED_SIZE = 5000;

const registry = new Map<string, FederatedTool>();
const installed = new Map<string, InstalledTool>(); // key: `userId:toolId`

const MAX_REGISTRY_SIZE = 5_000;
const MAX_INSTALLED_SIZE = 50_000;

// Seed with built-in tools
const BUILT_IN_TOOLS: FederatedTool[] = [
  {
    id: "tool_web_search",
    name: "Web Search",
    version: "1.0.0",
    description: "Search the web using Tavily or SerpAPI",
    author: "aibyai",
    category: "search",
    schema: { inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
    tags: ["search", "web", "tavily"],
    downloads: 0,
    rating: 5.0,
    verified: true,
    publishedAt: new Date("2026-01-01"),
  },
  {
    id: "tool_code_exec",
    name: "Code Executor",
    version: "1.0.0",
    description: "Execute JavaScript or Python code in a sandboxed environment",
    author: "aibyai",
    category: "code",
    schema: { inputSchema: { type: "object", properties: { language: { type: "string" }, code: { type: "string" } }, required: ["language", "code"] } },
    tags: ["code", "sandbox", "execution"],
    downloads: 0,
    rating: 4.8,
    verified: true,
    publishedAt: new Date("2026-01-01"),
  },
  {
    id: "tool_data_query",
    name: "Database Query",
    version: "1.0.0",
    description: "Execute read-only SQL queries against connected databases",
    author: "aibyai",
    category: "data",
    schema: { inputSchema: { type: "object", properties: { sql: { type: "string" }, database: { type: "string" } }, required: ["sql"] } },
    tags: ["sql", "database", "query"],
    downloads: 0,
    rating: 4.5,
    verified: true,
    publishedAt: new Date("2026-01-01"),
  },
];

for (const tool of BUILT_IN_TOOLS) {
  registry.set(tool.id, tool);
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Search the tool registry.
 */
export function searchTools(options: ToolSearchOptions = {}): { tools: FederatedTool[]; total: number } {
  let results = [...registry.values()];

  // Filter by query
  if (options.query) {
    const q = options.query.toLowerCase();
    results = results.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.tags.some((tag) => tag.toLowerCase().includes(q)),
    );
  }

  // Filter by category
  if (options.category) {
    results = results.filter((t) => t.category === options.category);
  }

  // Filter by verified
  if (options.verified !== undefined) {
    results = results.filter((t) => t.verified === options.verified);
  }

  // Sort
  const sortBy = options.sortBy ?? "downloads";
  results.sort((a, b) => {
    if (sortBy === "downloads") return b.downloads - a.downloads;
    if (sortBy === "rating") return b.rating - a.rating;
    return b.publishedAt.getTime() - a.publishedAt.getTime();
  });

  const total = results.length;
  const offset = options.offset ?? 0;
  const limit = options.limit ?? 20;
  results = results.slice(offset, offset + limit);

  return { tools: results, total };
}

/**
 * Get a specific tool from the registry.
 */
export function getTool(toolId: string): FederatedTool | undefined {
  return registry.get(toolId);
}

/**
 * Publish a tool to the registry.
 */
export function publishTool(
  tool: Omit<FederatedTool, "id" | "downloads" | "rating" | "publishedAt">,
): FederatedTool {
  // Validate tool metadata
  if (!tool.name || tool.name.length > 100) {
    throw new Error("Tool name is required and must be under 100 characters");
  }
  if (!tool.description || tool.description.length > 2000) {
    throw new Error("Tool description is required and must be under 2000 characters");
  }
  if (tool.tags && tool.tags.length > 20) {
    throw new Error("Maximum 20 tags allowed");
  }
  if (tool.author && tool.author.length > 100) {
    throw new Error("Author name must be under 100 characters");
  }
  // Cap registry size to prevent unbounded growth
  if (registry.size > 10000) {
    throw new Error("Tool registry is full");
  }

  const id = `tool_${crypto.randomBytes(8).toString("hex")}`;
  const published: FederatedTool = {
    ...tool,
    id,
    downloads: 0,
    rating: 0,
    publishedAt: new Date(),
  };

  if (registry.size >= MAX_REGISTRY_SIZE) {
    throw new Error("Tool registry is at capacity. Remove unused tools before publishing new ones.");
  }
  registry.set(id, published);
  logger.info({ toolId: id, name: tool.name }, "Tool published to registry");
  return published;
}

/**
 * Install a tool for a user.
 */
export function installTool(
  userId: number,
  toolId: string,
  config?: Record<string, unknown>,
): { success: boolean; error?: string } {
  const tool = registry.get(toolId);
  if (!tool) return { success: false, error: "Tool not found in registry" };

  const key = `${userId}:${toolId}`;
  if (installed.has(key)) return { success: false, error: "Tool already installed" };

  if (installed.size >= MAX_INSTALLED_SIZE) {
    return { success: false, error: "Installation limit reached. Uninstall unused tools first." };
  }
  installed.set(key, {
    toolId,
    name: tool.name,
    version: tool.version,
    installedAt: new Date(),
    installedBy: userId,
    enabled: true,
    config,
  });

  tool.downloads++;

  logger.info({ userId, toolId, name: tool.name }, "Tool installed");
  return { success: true };
}

/**
 * Uninstall a tool for a user.
 */
export function uninstallTool(userId: number, toolId: string): boolean {
  return installed.delete(`${userId}:${toolId}`);
}

/**
 * List installed tools for a user.
 */
export function listInstalledTools(userId: number): InstalledTool[] {
  const result: InstalledTool[] = [];
  for (const [key, tool] of installed.entries()) {
    if (key.startsWith(`${userId}:`)) {
      result.push(tool);
    }
  }
  return result.sort((a, b) => b.installedAt.getTime() - a.installedAt.getTime());
}

/**
 * Toggle a tool's enabled state.
 */
export function toggleTool(userId: number, toolId: string, enabled: boolean): boolean {
  const key = `${userId}:${toolId}`;
  const tool = installed.get(key);
  if (!tool) return false;
  tool.enabled = enabled;
  return true;
}

/**
 * Update tool configuration.
 */
export function updateToolConfig(
  userId: number,
  toolId: string,
  config: Record<string, unknown>,
): boolean {
  const key = `${userId}:${toolId}`;
  const tool = installed.get(key);
  if (!tool) return false;
  tool.config = { ...tool.config, ...config };
  return true;
}

/**
 * Get enabled tools for a user (for agent tool resolution).
 */
export function getEnabledTools(userId: number): InstalledTool[] {
  return listInstalledTools(userId).filter((t) => t.enabled);
}
