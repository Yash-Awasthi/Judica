import type { NodeHandler } from "../types.js";
import { executeTool } from "../../lib/tools/index.js";
import logger from "../../lib/logger.js";

// Ensure builtin tools are registered
import "../../lib/tools/builtin.js";

// P10-118: Configurable tool execution timeout (default 60s)
const TOOL_TIMEOUT_MS = parseInt(process.env.TOOL_EXECUTION_TIMEOUT_MS || "60000", 10);

// P10-119: Max output size for tool results (default 5MB)
const MAX_TOOL_OUTPUT_SIZE = parseInt(process.env.TOOL_MAX_OUTPUT_BYTES || "5242880", 10);

// P10-120: Allowed tool whitelist (if set, only these tools can execute in workflows)
const TOOL_WHITELIST = process.env.WORKFLOW_TOOL_WHITELIST
  ? new Set(process.env.WORKFLOW_TOOL_WHITELIST.split(",").map(s => s.trim()))
  : null;

export const toolHandler: NodeHandler = async (ctx) => {
  const toolName = ctx.nodeData.tool_name as string;
  const toolInputs = (ctx.nodeData.tool_inputs as Record<string, unknown>) ?? {};

  // P10-120: Enforce tool whitelist if configured
  if (TOOL_WHITELIST && !TOOL_WHITELIST.has(toolName)) {
    throw new Error(`Tool "${toolName}" is not in the workflow tool whitelist`);
  }

  // Merge workflow inputs into tool inputs (workflow inputs take precedence)
  const mergedArgs: Record<string, unknown> = { ...toolInputs, ...ctx.inputs };

  // P10-121: Audit log of tool invocation
  logger.info({
    event: "workflow_tool_invoke",
    runId: ctx.runId,
    userId: ctx.userId,
    toolName,
    inputKeys: Object.keys(mergedArgs),
  }, `Workflow tool invocation: ${toolName}`);

  // P10-118: Execute with timeout
  let timeoutHandle: ReturnType<typeof setTimeout>;
  const result = await Promise.race([
    executeTool(
      {
        id: `wf_${ctx.runId}_${Date.now()}`,
        name: toolName,
        arguments: mergedArgs,
      },
      {
        userId: String(ctx.userId),
        requestId: ctx.runId,
      }
    ),
    new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(
        () => reject(new Error(`Tool "${toolName}" timed out after ${TOOL_TIMEOUT_MS}ms`)),
        TOOL_TIMEOUT_MS
      );
    }),
  ]).finally(() => clearTimeout(timeoutHandle!));

  // P10-117: Throw on error instead of returning {error} as a "successful" result
  if (result.error) {
    throw new Error(`Tool "${toolName}" failed: ${result.error}`);
  }

  // P10-119: Cap output size
  let output = result.result;
  if (typeof output === "string" && output.length > MAX_TOOL_OUTPUT_SIZE) {
    output = output.slice(0, MAX_TOOL_OUTPUT_SIZE) + "\n[TOOL OUTPUT TRUNCATED]";
  }

  // P10-121: Log result summary
  logger.info({
    event: "workflow_tool_complete",
    runId: ctx.runId,
    toolName,
    outputSize: typeof output === "string" ? output.length : JSON.stringify(output).length,
  }, `Workflow tool complete: ${toolName}`);

  // Try to parse JSON result
  try {
    return { result: typeof output === "string" ? JSON.parse(output) : output };
  } catch {
    return { result: output };
  }
};
