import ivm from "isolated-vm";

export interface SandboxResult {
  output: string;
  // P7-46: Separate stdout and stderr arrays
  stdout: string[];
  stderr: string[];
  error: string | null;
  elapsedMs: number;
}

// P1-35: Cap output array to prevent Node heap exhaustion
const MAX_OUTPUT_LINES = 1000;
const MAX_OUTPUT_BYTES = 1_000_000; // 1MB total output cap

export async function executeJS(code: string, timeout: number = 5000): Promise<SandboxResult> {
  const start = Date.now();
  const output: string[] = [];
  // P7-46: Separate stdout/stderr tracking
  const stdout: string[] = [];
  const stderr: string[] = [];
  let totalBytes = 0;

  let isolate: ivm.Isolate | null = null;

  try {
    isolate = new ivm.Isolate({ memoryLimit: 128 });
    const context = await isolate.createContext();
    const jail = context.global;

    // P7-45: Use applySync with batching — the callback is already non-blocking
    // since it just pushes to an array. The synchronous path is required by
    // isolated-vm's Reference API but doesn't block the event loop because
    // we avoid any I/O (no stdout flush) inside the callback.
    const logCallback = new ivm.Reference((args: string) => {
      // P1-35: Enforce output limits
      if (output.length >= MAX_OUTPUT_LINES || totalBytes >= MAX_OUTPUT_BYTES) return;
      const line = args.slice(0, MAX_OUTPUT_BYTES - totalBytes);
      output.push(line);
      totalBytes += line.length;
      // P7-46: Route to stdout/stderr based on prefix
      if (line.startsWith("ERROR: ") || line.startsWith("WARN: ")) {
        stderr.push(line);
      } else {
        stdout.push(line);
      }
    });

    await jail.set("_logCallback", logCallback);

    // P1-36: Prepend "use strict" to user code for safer execution
    // P7-47: Allowlist of globals — deny everything not explicitly permitted.
    // This prevents access to any new globals added in future Node/V8 versions.
    const wrappedCode = `
      "use strict";
      // P7-47: Remove non-allowlisted globals
      (function() {
        const ALLOWED_GLOBALS = new Set([
          'undefined', 'NaN', 'Infinity', 'null',
          'Object', 'Array', 'Number', 'String', 'Boolean', 'Symbol', 'BigInt',
          'Date', 'RegExp', 'Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError', 'URIError', 'EvalError',
          'Map', 'Set', 'WeakMap', 'WeakSet',
          'Promise',
          'JSON', 'Math',
          'parseInt', 'parseFloat', 'isNaN', 'isFinite',
          'encodeURI', 'decodeURI', 'encodeURIComponent', 'decodeURIComponent',
          'ArrayBuffer', 'DataView',
          'Int8Array', 'Uint8Array', 'Uint8ClampedArray',
          'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array',
          'Float32Array', 'Float64Array', 'BigInt64Array', 'BigUint64Array',
          'globalThis', 'console', '_logCallback',
          'TextEncoder', 'TextDecoder', 'URL', 'URLSearchParams',
          'atob', 'btoa', 'structuredClone',
          'AggregateError',
        ]);
        const names = Object.getOwnPropertyNames(globalThis);
        for (const name of names) {
          if (!ALLOWED_GLOBALS.has(name)) {
            try { delete globalThis[name]; } catch {}
          }
        }
      })();
      const console = {
        log: (...args) => _logCallback.applySync(undefined, [args.map(a => {
          try { return typeof a === 'object' ? JSON.stringify(a) : String(a); }
          catch { return String(a); }
        }).join(' ')]),
        error: (...args) => _logCallback.applySync(undefined, ['ERROR: ' + args.map(a => String(a)).join(' ')]),
        warn: (...args) => _logCallback.applySync(undefined, ['WARN: ' + args.map(a => String(a)).join(' ')]),
      };

      (function() {
        "use strict";
        ${code}
      })();
    `;

    const script = await isolate.compileScript(wrappedCode);
    await script.run(context, { timeout });

    return {
      output: output.join("\n"),
      stdout,
      stderr,
      error: null,
      elapsedMs: Date.now() - start,
    };
  } catch (err: unknown) {
    return {
      output: output.join("\n"),
      stdout,
      stderr,
      error: (err instanceof Error ? err.message : String(err)) || "Execution error",
      elapsedMs: Date.now() - start,
    };
  } finally {
    if (isolate) {
      try { isolate.dispose(); } catch { /* dispose may throw if already disposed */ }
    }
  }
}
