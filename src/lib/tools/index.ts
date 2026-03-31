import { env } from "../../config/env.js";
import logger from "../logger.js";

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: any;
}

export interface ToolInstance {
  definition: ToolDefinition;
  execute: (args: any) => Promise<string>;
}

const registry: Map<string, ToolInstance> = new Map();

export function registerTool(tool: ToolInstance) {
  registry.set(tool.definition.name, tool);
  logger.info({ tool: tool.definition.name }, "Tool registered");
}

export function getToolDefinitions(names: string[]): ToolDefinition[] {
  return names
    .map(name => registry.get(name)?.definition)
    .filter((d): d is ToolDefinition => !!d);
}

export async function callTool(name: string, args: any): Promise<string> {
  const tool = registry.get(name);
  if (!tool) throw new Error(`Tool ${name} not found`);
  
  logger.debug({ tool: name, args }, "Executing tool");
  try {
    return await tool.execute(args);
  } catch (err: any) {
    logger.error({ tool: name, err: err.message }, "Tool execution failed");
    return `Error: ${err.message}`;
  }
}

// Standard tools initialization
import { searchTool } from "./search.js";
import { readWebpageTool } from "./read_webpage.js";
import { executeCodeTool } from "./execute_code.js";

registerTool(searchTool);
registerTool(readWebpageTool);
registerTool(executeCodeTool);
