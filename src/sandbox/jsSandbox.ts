import ivm from "isolated-vm";

export interface SandboxResult {
  output: string[];
  error: string | null;
  elapsedMs: number;
}

export async function executeJS(code: string, timeout: number = 5000): Promise<SandboxResult> {
  const start = Date.now();
  const output: string[] = [];

  let isolate: ivm.Isolate | null = null;

  try {
    isolate = new ivm.Isolate({ memoryLimit: 128 });
    const context = await isolate.createContext();
    const jail = context.global;

    // Inject console.log capture
    const logCallback = new ivm.Reference((args: string) => {
      output.push(args);
    });

    await jail.set("_logCallback", logCallback);

    // Create a wrapper that captures console output
    const wrappedCode = `
      const console = {
        log: (...args) => _logCallback.applySync(undefined, [args.map(a => {
          try { return typeof a === 'object' ? JSON.stringify(a) : String(a); }
          catch { return String(a); }
        }).join(' ')]),
        error: (...args) => _logCallback.applySync(undefined, ['ERROR: ' + args.map(a => String(a)).join(' ')]),
        warn: (...args) => _logCallback.applySync(undefined, ['WARN: ' + args.map(a => String(a)).join(' ')]),
      };

      (function() {
        ${code}
      })();
    `;

    const script = await isolate.compileScript(wrappedCode);
    await script.run(context, { timeout });

    return {
      output,
      error: null,
      elapsedMs: Date.now() - start,
    };
  } catch (err: any) {
    return {
      output,
      error: err.message || "Execution error",
      elapsedMs: Date.now() - start,
    };
  } finally {
    if (isolate) {
      try { isolate.dispose(); } catch {}
    }
  }
}
