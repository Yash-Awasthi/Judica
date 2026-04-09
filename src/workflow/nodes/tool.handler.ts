import type { NodeHandler } from "../types.js";
import { executeTool } from "../../lib/tools/index.js";

// Ensure builtin tools are registered
import "../../lib/tools/builtin.js";

export const toolHandler: NodeHandler = async (ctx) => {
  const toolName = ctx.nodeData.tool_name as string;
  const toolInputs = (ctx.nodeData.tool_inputs as Record<string, unknown>) ?? {};

  // Merge workflow inputs into tool inputs (workflow inputs take precedence)
  const mergedArgs: Record<string, unknown> = { ...toolInputs, ...ctx.inputs };

  const result = await executeTool(
    {
      id: `wf_${ctx.runId}_${Date.now()}`,
      name: toolName,
      arguments: mergedArgs,
    },
    {
      userId: String(ctx.userId),
      requestId: ctx.runId,
    }
  );

  if (result.error) {
    return { result: result.result, error: result.error };
  }

  // Try to parse JSON result
  try {
    return { result: JSON.parse(result.result) };
  } catch {
    return { result: result.result };
  }
};
