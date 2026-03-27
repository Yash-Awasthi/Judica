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
  execute: async ({ code }: { code: string }) => {
    const isolate = new ivm.Isolate({ memoryLimit: 128 });
    try {
      const context = await isolate.createContext();
      const jail = context.global;
      // standard globals (Math, Date, JSON, etc.) are already in the isolate
      
      const script = await isolate.compileScript(code);
      const result = await script.run(context, { timeout: 1000 });

      isolate.dispose();

      if (result === undefined) return "undefined";
      if (typeof result === "object") return JSON.stringify(result, null, 2);
      return String(result);
    } catch (err: any) {
      if (!isolate.isDisposed) isolate.dispose();
      return `Execution Error: ${err.message}`;
    }
  }
};
