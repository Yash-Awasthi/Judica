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
  // Use base64 encoding to safely pass arbitrary JSON without escaping issues
  const inputContext = JSON.stringify(ctx.inputs);
  const b64Input = Buffer.from(inputContext).toString("base64");
  const contextPreamble = language === "python"
    ? `import json, base64\n__inputs__ = json.loads(base64.b64decode("${b64Input}").decode("utf-8"))\n`
    : `const __inputs__ = JSON.parse(atob("${b64Input}"));\n`;

  const fullCode = contextPreamble + code;

  let result: { output: string; error?: string };

  if (language === "python") {
    const pyResult = await executePython(fullCode);
    result = { output: Array.isArray(pyResult.output) ? pyResult.output.join("\n") : String(pyResult.output), error: pyResult.error ?? undefined };
  } else {
    // javascript or typescript (both use JS sandbox)
    const jsResult = await executeJS(fullCode);
    result = { output: Array.isArray(jsResult.output) ? jsResult.output.join("\n") : String(jsResult.output), error: jsResult.error ?? undefined };
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
