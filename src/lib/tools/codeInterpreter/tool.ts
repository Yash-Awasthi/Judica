/**
 * Code Interpreter Tool — registers as a tool in aibyai's tool registry.
 *
 * Wraps the CodeInterpreterClient for use as an LLM tool call.
 * Handles file caching, output truncation, and graceful fallback.
 */

import { registerTool } from "../index.js";
import { CodeInterpreterClient } from "./client.js";
import logger from "../../logger.js";

const client = new CodeInterpreterClient({
  baseUrl: process.env.CODE_INTERPRETER_URL ?? "http://localhost:8888",
});

// File cache by (filename, contentHash) to avoid re-uploading
const fileCache = new Map<string, string>();

registerTool(
  {
    name: "execute_python",
    description:
      "Execute Python code in a secure sandbox. " +
      "Use this for data analysis, calculations, visualizations, file processing, etc. " +
      "The sandbox has pandas, numpy, matplotlib, scipy, scikit-learn, and other common libraries. " +
      "Output files (charts, CSVs, etc.) are returned as base64.",
    parameters: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description: "Python code to execute",
        },
        stdin: {
          type: "string",
          description: "Optional stdin input for the code",
        },
      },
      required: ["code"],
    },
  },
  async (args) => {
    const code = args.code as string;
    const stdin = args.stdin as string | undefined;

    // Check sandbox availability
    const available = await client.isAvailable();
    if (!available) {
      return JSON.stringify({
        error: "Python sandbox is not available. Ensure the code-interpreter service is running.",
        hint: "Start with: docker run -p 8888:8888 onyxdotapp/code-interpreter",
      });
    }

    const result = await client.execute({ code, stdin });

    // Format output for the LLM
    const parts: string[] = [];

    if (result.success) {
      parts.push(`Exit code: 0 (success)`);
    } else {
      parts.push(`Exit code: ${result.exitCode} (error)`);
    }

    if (result.stdout) {
      parts.push(`--- stdout ---\n${result.stdout}`);
    }
    if (result.stderr) {
      parts.push(`--- stderr ---\n${result.stderr}`);
    }
    if (result.error) {
      parts.push(`Error: ${result.error}`);
    }

    const outputFileNames = Object.keys(result.outputFiles);
    if (outputFileNames.length > 0) {
      parts.push(`Output files: ${outputFileNames.join(", ")}`);
    }

    parts.push(`Execution time: ${result.executionTimeMs}ms`);

    return parts.join("\n\n");
  },
);

logger.info("Code interpreter tool registered (execute_python)");
