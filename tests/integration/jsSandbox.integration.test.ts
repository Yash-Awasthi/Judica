import { describe, it, expect } from "vitest";
import { executeJS } from "../../src/sandbox/jsSandbox.js";

/**
 * P6-02: Integration test with real isolated-vm — no mocking.
 * Tests actual VM isolation behavior with known safe and unsafe code.
 */
describe("jsSandbox — real isolated-vm integration", () => {
  it("executes safe code and captures output", async () => {
    const result = await executeJS("console.log('hello from sandbox')");
    expect(result.error).toBeNull();
    expect(result.output).toContain("hello from sandbox");
  });

  it("enforces timeout on infinite loops", async () => {
    const result = await executeJS("while(true) {}");
    expect(result.error).not.toBeNull();
    expect(result.error).toMatch(/timeout|terminated|timed out/i);
  });

  it("cannot access node builtins (require, process, fs)", async () => {
    const result = await executeJS("typeof require");
    expect(result.output).not.toContain("function");

    const result2 = await executeJS("typeof process");
    expect(result2.output).not.toContain("object");
  });

  it("cannot escape via constructor chain", async () => {
    const code = `
      try {
        const ForeignFunction = this.constructor.constructor;
        const proc = ForeignFunction('return process')();
        console.log(proc.env);
      } catch(e) {
        console.log('blocked: ' + e.message);
      }
    `;
    const result = await executeJS(code);
    // Should either error or print "blocked:" — never print env vars
    expect(result.output).not.toMatch(/MASTER_ENCRYPTION|DATABASE_URL|JWT_SECRET/);
  });

  it("respects memory limit", async () => {
    const code = `
      const arr = [];
      for (let i = 0; i < 1e8; i++) {
        arr.push(new Array(1000));
      }
    `;
    const result = await executeJS(code);
    // Should fail with memory or allocation error
    expect(result.error).not.toBeNull();
  });
});
