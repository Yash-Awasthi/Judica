import { ToolInstance } from "./index.js";
import ivm from "isolated-vm";

export const executeCodeTool: ToolInstance = {
  definition: {
    name: "execute_code",
    description: "Execute Javascript code securely. Useful for precise mathematical calculations, sorting data, or logical problem solving. The last expression evaluated will be the return value.",
    parameters: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description: "The Javascript source code to execute. Standard JS objects (Math, Date, JSON, String, Array) are available."
        }
      },
      required: ["code"]
    }
  },
  execute: async (args: Record<string, unknown>) => {
    const code = args.code as string;
    const isolate = new ivm.Isolate({ memoryLimit: 128 });
    try {
      const context = await isolate.createContext();
      const _jail = context.global;

      const script = await isolate.compileScript(code);
      const result = await script.run(context, { timeout: 1000 });

      isolate.dispose();

      if (result === undefined) return "undefined";
      if (typeof result === "object") return JSON.stringify(result, null, 2);
      return String(result);
    } catch (err) {
      if (!isolate.isDisposed) isolate.dispose();
      return `Execution Error: ${(err as Error).message}`;
    }
  }
};
