import type { NodeHandler } from "../types.js";
import { executeJS } from "../../sandbox/jsSandbox.js";
import { executePython } from "../../sandbox/pythonSandbox.js";

// P10-97: Strict language whitelist
const ALLOWED_LANGUAGES = new Set(["javascript", "typescript", "python"]);

// P10-98: Configurable output size limit (bytes)
const MAX_OUTPUT_SIZE = parseInt(process.env.CODE_NODE_MAX_OUTPUT_BYTES || "1048576", 10); // 1MB default

export const codeHandler: NodeHandler = async (ctx) => {
  const code = ctx.nodeData.code as string;
  const language = (ctx.nodeData.language as string) || "javascript";

  // P10-97: Validate language against whitelist
  if (!ALLOWED_LANGUAGES.has(language)) {
    return {
      output: "",
      error: `Unsupported language "${language}". Allowed: ${[...ALLOWED_LANGUAGES].join(", ")}`,
    };
  }

  // P10-96: Inject upstream node inputs into execution context
  const inputContext = JSON.stringify(ctx.inputs);
  const contextPreamble = language === "python"
    ? `import json\n__inputs__ = json.loads('${inputContext.replace(/'/g, "\\'")}')\n`
    : `const __inputs__ = ${inputContext};\n`;

  const fullCode = contextPreamble + code;

  let result: { output: string; error?: string };

  if (language === "python") {
    result = await executePython(fullCode);
  } else {
    // javascript or typescript (both use JS sandbox)
    result = await executeJS(fullCode);
  }

  // P10-98: Cap output size to prevent heap exhaustion
  let output = result.output;
  if (output && output.length > MAX_OUTPUT_SIZE) {
    output = output.slice(0, MAX_OUTPUT_SIZE) + "\n[OUTPUT TRUNCATED — exceeded " + MAX_OUTPUT_SIZE + " bytes]";
  }

  return {
    output,
    error: result.error,
  };
};
