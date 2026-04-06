import logger from "../logger.js";

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
}

export interface ToolExecutionContext {
  userId?: string;
  conversationId?: string;
  requestId?: string;
  metadata?: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  tool_call_id: string;
  name: string;
  result: string;
  error?: string;
}

export type ToolExecutor = (args: Record<string, unknown>, context?: ToolExecutionContext) => Promise<string>;

export interface ToolInstance {
  definition: ToolDefinition;
  execute: ToolExecutor;
}

const toolRegistry = new Map<string, { definition: ToolDefinition; execute: ToolExecutor }>();

export function registerTool(definition: ToolDefinition, execute: ToolExecutor) {
  toolRegistry.set(definition.name, { definition, execute });
}

export function getToolDefinitions(toolNames?: string[]): ToolDefinition[] {
  const allTools = Array.from(toolRegistry.values()).map(t => t.definition);
  if (toolNames && toolNames.length > 0) {
    return allTools.filter(t => toolNames.includes(t.name));
  }
  return allTools;
}

export function getToolDefinition(name: string): ToolDefinition | undefined {
  return toolRegistry.get(name)?.definition;
}

export function validateToolResult(result: string): string {
  try {
    const parsed = JSON.parse(result);
    if (parsed && typeof parsed === "object" && "error" in parsed) {
      return "[No useful data from tool]";
    }
  } catch (error) {
    logger.warn({ err: error instanceof Error ? error.message : String(error) }, "Tool execution failed");
    return "[Tool execution failed - please try again]";
  }

  const trimmedResult = result.trim();
  if (trimmedResult.startsWith("{") || trimmedResult.startsWith("[")) {
    try {
      JSON.parse(trimmedResult); // Validate structure
    } catch {
      logger.warn({ result }, "Tool returned malformed JSON");
      return "[Tool returned malformed data - please try again]";
    }
  }

  if (!result || result === "[]") {
    logger.warn({ result }, "Tool returned empty result");
    return "[Tool returned no data - verify query and try again]";
  }

  if (result.length > 2000) {
    return result.slice(0, 2000) + "...";
  }

  return result;
}

export async function executeTool(call: ToolCall, context?: ToolExecutionContext): Promise<ToolResult> {
  const entry = toolRegistry.get(call.name);
  if (!entry) {
    return { tool_call_id: call.id, name: call.name, result: "", error: `Tool "${call.name}" not found` };
  }
  try {
    const rawResult = await entry.execute(call.arguments, context);
    const validatedResult = validateToolResult(rawResult);
    return { tool_call_id: call.id, name: call.name, result: validatedResult };
  } catch (err) {
    return { tool_call_id: call.id, name: call.name, result: "", error: (err as Error).message };
  }
}

export const callTool = executeTool;

export function formatToolResults(results: ToolResult[]): string {
  return results.map(r => {
    if (r.error) return `[Tool: ${r.name}] Error: ${r.error}`;
    return `[Tool: ${r.name}] ${r.result}`;
  }).join("\n\n");
}