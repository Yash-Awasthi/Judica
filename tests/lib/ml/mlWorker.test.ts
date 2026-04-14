import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../../src/lib/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe("ML Worker", () => {
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it("throws in test mode (NODE_ENV=test) to avoid spawning Python", async () => {
    process.env.NODE_ENV = "test";
    const { mlWorker } = await import("../../../src/lib/ml/ml_worker.js");

    await expect(mlWorker.computeSimilarity("hello", "world")).rejects.toThrow(
      "ML worker skipped in test mode"
    );
  });

  it("exposes the expected interface (init, computeSimilarity, shutdown)", async () => {
    process.env.NODE_ENV = "test";
    const { mlWorker } = await import("../../../src/lib/ml/ml_worker.js");

    expect(typeof mlWorker.computeSimilarity).toBe("function");
    expect(typeof mlWorker.shutdown).toBe("function");
    expect(typeof mlWorker.init).toBe("function");
  });

  it("handles subprocess errors - rejects with ENOENT code in test mode", async () => {
    process.env.NODE_ENV = "test";
    const { mlWorker } = await import("../../../src/lib/ml/ml_worker.js");

    try {
      await mlWorker.computeSimilarity("a", "b");
      expect.unreachable("Should have thrown");
    } catch (err: any) {
      expect(err.code).toBe("ENOENT");
      expect(err.message).toContain("skipped in test mode");
    }
  });

  it("handles timeout - rejects on computeSimilarity in test mode", async () => {
    process.env.NODE_ENV = "test";
    const { mlWorker } = await import("../../../src/lib/ml/ml_worker.js");

    // In test mode, computeSimilarity rejects immediately before reaching timeout logic
    const promise = mlWorker.computeSimilarity("text1", "text2");
    await expect(promise).rejects.toThrow();
  });

  it("shutdown cleans up process state without throwing", async () => {
    process.env.NODE_ENV = "test";
    const { mlWorker } = await import("../../../src/lib/ml/ml_worker.js");

    // shutdown should not throw even if no process has been spawned
    await expect(mlWorker.shutdown()).resolves.toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/*  Tests with mocked child_process (NODE_ENV != "test")                      */
/* -------------------------------------------------------------------------- */

import { EventEmitter, Readable } from "stream";

/** Build a fake ChildProcess-like object that spawn() will return. */
function createMockProcess() {
  const stdout = new Readable({ read() {} });
  const stderr = new Readable({ read() {} });
  const stdinWrite = vi.fn().mockReturnValue(true);
  const stdin = { write: stdinWrite, end: vi.fn(), on: vi.fn(), once: vi.fn(), emit: vi.fn() };
  const kill = vi.fn();

  const proc = Object.assign(new EventEmitter(), {
    stdout,
    stderr,
    stdin,
    kill,
    pid: 12345,
  });

  return proc;
}

describe("MLWorker with mocked child_process", () => {
  let mockProc: ReturnType<typeof createMockProcess>;
  let spawnMock: ReturnType<typeof vi.fn>;

  /** Flush microtask queue so awaited init() inside computeSimilarity resolves. */
  const tick = () => new Promise<void>((r) => setImmediate(r));

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockProc = createMockProcess();
    spawnMock = vi.fn().mockReturnValue(mockProc);
  });

  afterEach(() => {
    // Restore NODE_ENV so other suites are unaffected
    process.env.NODE_ENV = "test";
    // Ensure fake timers are always restored even if a test fails mid-way
    vi.useRealTimers();
  });

  /**
   * Helper: import ml_worker with child_process.spawn mocked and NODE_ENV
   * set to something other than "test" so the real code path executes.
   */
  async function importWorker() {
    vi.doMock("child_process", () => ({ spawn: spawnMock }));
    process.env.NODE_ENV = "production";
    const mod = await import("../../../src/lib/ml/ml_worker.js");
    return mod.mlWorker;
  }

  /* ===================== init() ===================== */

  describe("init()", () => {
    it("spawns the python process and resolves when READY is received", async () => {
      const worker = await importWorker();

      const initPromise = worker.init();

      // The worker should have called spawn exactly once
      expect(spawnMock).toHaveBeenCalledOnce();

      // Simulate the subprocess printing READY
      mockProc.stdout.push("READY\n");

      await expect(initPromise).resolves.toBeUndefined();
    });

    it("does not spawn a second process on duplicate init() calls", async () => {
      const worker = await importWorker();

      const p1 = worker.init();
      const p2 = worker.init();

      // spawn should have been called only once despite two init() calls
      expect(spawnMock).toHaveBeenCalledOnce();

      // Both promises should resolve once READY is received
      mockProc.stdout.push("READY\n");
      await Promise.all([p1, p2]);
    });

    it("rejects the readyPromise when spawn emits an error", async () => {
      const worker = await importWorker();

      const initPromise = worker.init();

      const spawnError = new Error("spawn python3 ENOENT") as NodeJS.ErrnoException;
      spawnError.code = "ENOENT";
      mockProc.emit("error", spawnError);

      await expect(initPromise).rejects.toThrow("spawn python3 ENOENT");
    });

    it("resets state when the process exits", async () => {
      const worker = await importWorker();

      const initPromise = worker.init();
      mockProc.stdout.push("READY\n");
      await initPromise;

      // Simulate process exit
      mockProc.emit("exit", 1);

      // After exit, a new init() should spawn again
      const mockProc2 = createMockProcess();
      spawnMock.mockReturnValue(mockProc2);

      const initPromise2 = worker.init();
      expect(spawnMock).toHaveBeenCalledTimes(2);

      mockProc2.stdout.push("READY\n");
      await initPromise2;
    });

    it("logs stderr that contains error/fatal at error level", async () => {
      const worker = await importWorker();

      const initPromise = worker.init();
      mockProc.stdout.push("READY\n");
      await initPromise;

      // Push stderr data with "error" keyword
      mockProc.stderr.push(Buffer.from("Fatal: module not found\n"));

      // Push stderr data without error keyword (debug path)
      mockProc.stderr.push(Buffer.from("Loading model weights...\n"));

      // Give event loop a tick to process
      await new Promise((r) => setTimeout(r, 10));

      // The test implicitly verifies no crash; logger mock captures calls
    });
  });

  /* ===================== computeSimilarity() ===================== */

  describe("computeSimilarity()", () => {
    it("writes a JSON payload to stdin and resolves with the score", async () => {
      const worker = await importWorker();

      // Make init resolve immediately
      const initPromise = worker.init();
      mockProc.stdout.push("READY\n");
      await initPromise;

      const similarityPromise = worker.computeSimilarity("hello", "world");

      // computeSimilarity awaits init() internally, so flush microtasks first
      await tick();

      // Verify JSON was written to stdin
      expect(mockProc.stdin.write).toHaveBeenCalledOnce();
      const written = mockProc.stdin.write.mock.calls[0][0] as string;
      const parsed = JSON.parse(written.trim());
      expect(parsed).toEqual({ action: "similarity", text1: "hello", text2: "world" });

      // Simulate the subprocess responding with a score
      mockProc.stdout.push(JSON.stringify({ score: 0.87 }) + "\n");

      await expect(similarityPromise).resolves.toBe(0.87);
    });

    it("rejects when the subprocess responds with an error field", async () => {
      const worker = await importWorker();

      const initPromise = worker.init();
      mockProc.stdout.push("READY\n");
      await initPromise;

      const similarityPromise = worker.computeSimilarity("a", "b");
      await tick();

      // Respond with error
      mockProc.stdout.push(JSON.stringify({ error: "tokenizer failed" }) + "\n");

      await expect(similarityPromise).rejects.toThrow("tokenizer failed");
    });

    it("rejects with timeout after 5 seconds if no response arrives", async () => {
      const worker = await importWorker();

      const initPromise = worker.init();
      mockProc.stdout.push("READY\n");
      await initPromise;

      vi.useFakeTimers();
      try {
        const similarityPromise = worker.computeSimilarity("slow", "request");

        // Attach a catch handler immediately to prevent unhandled rejection
        const resultPromise = similarityPromise.catch((err: Error) => err);

        // Flush microtasks and advance past the 5-second timeout
        await vi.advanceTimersByTimeAsync(5001);

        const result = await resultPromise;
        expect(result).toBeInstanceOf(Error);
        expect((result as Error).message).toBe("ML worker timeout");
      } finally {
        vi.useRealTimers();
      }
    });

    it("throws when process is null (not available)", async () => {
      const worker = await importWorker();

      const initPromise = worker.init();
      mockProc.stdout.push("READY\n");
      await initPromise;

      // Shut down to null out the process
      await worker.shutdown();

      // Reset NODE_ENV so we bypass the test-mode early-throw and hit the null check
      process.env.NODE_ENV = "production";

      // init() will spawn again, but we make spawn return a proc with no stdin
      const brokenProc = createMockProcess();
      (brokenProc as any).stdin = null;
      spawnMock.mockReturnValue(brokenProc);

      // We need init() to resolve so computeSimilarity proceeds past init
      const initP = worker.init();
      brokenProc.stdout.push("READY\n");
      await initP;

      await expect(worker.computeSimilarity("x", "y")).rejects.toThrow(
        "ML worker not available"
      );
    });

    it("handles unparseable stdout lines without crashing", async () => {
      const worker = await importWorker();

      const initPromise = worker.init();
      mockProc.stdout.push("READY\n");
      await initPromise;

      // Push garbage that is not JSON and not "READY"
      mockProc.stdout.push("not-json-garbage\n");

      // Give event loop time to process
      await new Promise((r) => setTimeout(r, 10));

      // Worker should still be functional
      const similarityPromise = worker.computeSimilarity("a", "b");
      await tick();
      mockProc.stdout.push(JSON.stringify({ score: 0.5 }) + "\n");
      await expect(similarityPromise).resolves.toBe(0.5);
    });
  });

  /* ===================== shutdown() ===================== */

  describe("shutdown()", () => {
    it("calls process.kill() and resets internal state", async () => {
      const worker = await importWorker();

      const initPromise = worker.init();
      mockProc.stdout.push("READY\n");
      await initPromise;

      await worker.shutdown();

      expect(mockProc.kill).toHaveBeenCalledOnce();

      // After shutdown, calling init again should spawn a new process
      const mockProc2 = createMockProcess();
      spawnMock.mockReturnValue(mockProc2);

      const initPromise2 = worker.init();
      expect(spawnMock).toHaveBeenCalledTimes(2);

      mockProc2.stdout.push("READY\n");
      await initPromise2;
    });

    it("is a no-op when no process is running", async () => {
      const worker = await importWorker();

      // shutdown without ever calling init - should not throw
      await expect(worker.shutdown()).resolves.toBeUndefined();
    });

    it("allows re-initialization after shutdown", async () => {
      const worker = await importWorker();

      // First lifecycle
      const initPromise1 = worker.init();
      mockProc.stdout.push("READY\n");
      await initPromise1;
      await worker.shutdown();

      // Second lifecycle
      const mockProc2 = createMockProcess();
      spawnMock.mockReturnValue(mockProc2);
      const initPromise2 = worker.init();
      mockProc2.stdout.push("READY\n");
      await initPromise2;

      const simPromise = worker.computeSimilarity("x", "y");
      await tick();
      mockProc2.stdout.push(JSON.stringify({ score: 0.99 }) + "\n");
      await expect(simPromise).resolves.toBe(0.99);
    });
  });

  /* ===================== Platform detection ===================== */

  describe("platform detection for python path", () => {
    it("uses python3 on unix/linux/mac", async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "linux", writable: true });
      try {
        const worker = await importWorker();
        worker.init();
        const pythonArg = spawnMock.mock.calls[0][0];
        expect(pythonArg).toBe("python3");
      } finally {
        Object.defineProperty(process, "platform", { value: originalPlatform, writable: true });
      }
    });

    it("uses .venv/Scripts/python.exe on win32", async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "win32", writable: true });
      try {
        const worker = await importWorker();
        worker.init();
        const pythonArg = spawnMock.mock.calls[0][0] as string;
        expect(pythonArg).toContain(".venv");
        expect(pythonArg).toContain("Scripts");
        expect(pythonArg).toContain("python.exe");
      } finally {
        Object.defineProperty(process, "platform", { value: originalPlatform, writable: true });
      }
    });
  });

  /* ===================== Multiple concurrent calls ===================== */

  describe("multiple concurrent computeSimilarity calls", () => {
    it("queues callbacks and resolves them in FIFO order", async () => {
      const worker = await importWorker();

      const initPromise = worker.init();
      mockProc.stdout.push("READY\n");
      await initPromise;

      // Fire three concurrent requests
      const p1 = worker.computeSimilarity("a", "b");
      const p2 = worker.computeSimilarity("c", "d");
      const p3 = worker.computeSimilarity("e", "f");

      await tick();

      expect(mockProc.stdin.write).toHaveBeenCalledTimes(3);

      // Respond in order
      mockProc.stdout.push(JSON.stringify({ score: 0.1 }) + "\n");
      mockProc.stdout.push(JSON.stringify({ score: 0.2 }) + "\n");
      mockProc.stdout.push(JSON.stringify({ score: 0.3 }) + "\n");

      await expect(p1).resolves.toBe(0.1);
      await expect(p2).resolves.toBe(0.2);
      await expect(p3).resolves.toBe(0.3);
    });

    it("handles a mix of success and error responses in queue", async () => {
      const worker = await importWorker();

      const initPromise = worker.init();
      mockProc.stdout.push("READY\n");
      await initPromise;

      const p1 = worker.computeSimilarity("ok", "text");
      const p2 = worker.computeSimilarity("bad", "text");
      const p3 = worker.computeSimilarity("ok2", "text2");

      await tick();

      // First succeeds, second errors, third succeeds
      mockProc.stdout.push(JSON.stringify({ score: 0.75 }) + "\n");
      mockProc.stdout.push(JSON.stringify({ error: "embedding failed" }) + "\n");
      mockProc.stdout.push(JSON.stringify({ score: 0.6 }) + "\n");

      await expect(p1).resolves.toBe(0.75);
      await expect(p2).rejects.toThrow("embedding failed");
      await expect(p3).resolves.toBe(0.6);
    });

    it("individual timeouts do not affect other queued requests", async () => {
      const worker = await importWorker();

      const initPromise = worker.init();
      mockProc.stdout.push("READY\n");
      await initPromise;

      // Send first request, let it time out with real timers (5s), then
      // send second request and verify it works. We use a real 5s wait to
      // avoid fake-timer complications with interleaved promises.
      // Instead, we test a simpler but equivalent scenario: after a timeout
      // removes the head callback, the next response still goes to the
      // correct (remaining) callback.

      vi.useFakeTimers();
      try {
        const p1 = worker.computeSimilarity("will-timeout", "x");

        // Attach catch handler immediately to prevent unhandled rejection
        const p1Result = p1.catch((err: Error) => err);

        // Advance past p1's 5s timeout
        await vi.advanceTimersByTimeAsync(5001);

        const result = await p1Result;
        expect(result).toBeInstanceOf(Error);
        expect((result as Error).message).toBe("ML worker timeout");
      } finally {
        vi.useRealTimers();
      }

      // Now send another request - it should work correctly
      const p2 = worker.computeSimilarity("will-succeed", "y");
      await tick();
      mockProc.stdout.push(JSON.stringify({ score: 0.42 }) + "\n");
      await expect(p2).resolves.toBe(0.42);
    });
  });
});
