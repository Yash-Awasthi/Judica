import type { NodeHandler } from "../types.js";
import { executeJS } from "../../sandbox/jsSandbox.js";
import { executePython } from "../../sandbox/pythonSandbox.js";

export const codeHandler: NodeHandler = async (ctx) => {
  const code = ctx.nodeData.code as string;
  const language = (ctx.nodeData.language as string) || "javascript";

  if (language === "python") {
    const result = await executePython(code);
    return {
      output: result.output,
      error: result.error,
    };
  }

  // Default: JavaScript
  const result = await executeJS(code);
  return {
    output: result.output,
    error: result.error,
  };
};
