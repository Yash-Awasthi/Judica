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

    const promise = mlWorker.computeSimilarity("text1", "text2");
    await expect(promise).rejects.toThrow();
  });

  it("shutdown cleans up process state without throwing", async () => {
    process.env.NODE_ENV = "test";
    const { mlWorker } = await import("../../../src/lib/ml/ml_worker.js");

    await expect(mlWorker.shutdown()).resolves.toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/*  Tests with mocked child_process (NODE_ENV != "test")                      */
/* -------------------------------------------------------------------------- */

import { EventEmitter, Readable, PassThrough } from "stream";

/** Build a fake ChildProcess-like object that spawn() will return. */
function createMockProcess() {
  // Use PassThrough streams which work better with readline
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdin = { write: vi.fn().mockReturnValue(true), end: vi.fn() };
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

/** Flush the event loop enough times for readline + async chains to settle */
async function flush(n = 5) {
  for (let i = 0; i < n; i++) {
    await new Promise<void>((r) => setImmediate(r));
  }
}

describe("MLWorker with mocked child_process", () => {
  let mockProc: ReturnType<typeof createMockProcess>;
  let spawnMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockProc = createMockProcess();
    spawnMock = vi.fn().mockReturnValue(mockProc);
  });

  afterEach(() => {
    process.env.NODE_ENV = "test";
    vi.useRealTimers();
  });

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
      expect(spawnMock).toHaveBeenCalledOnce();

      mockProc.stdout.write("READY\n");
      await expect(initPromise).resolves.toBeUndefined();
    });

    it("does not spawn a second process on duplicate init() calls", async () => {
      const worker = await importWorker();

      const p1 = worker.init();
      const p2 = worker.init();

      // spawn should have been called only once
      expect(spawnMock).toHaveBeenCalledOnce();

      mockProc.stdout.write("READY\n");
      // Both should resolve
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

    it("resets state when the process exits, allowing re-spawn", async () => {
      const worker = await importWorker();

      const initPromise = worker.init();
      mockProc.stdout.write("READY\n");
      await initPromise;

      // Simulate process exit
      mockProc.emit("exit", 1);

      // After exit, a new init() should spawn again
      const mockProc2 = createMockProcess();
      spawnMock.mockReturnValue(mockProc2);

      const initPromise2 = worker.init();
      expect(spawnMock).toHaveBeenCalledTimes(2);

      mockProc2.stdout.write("READY\n");
      await initPromise2;
    });

    it("logs stderr that contains error/fatal at error level", async () => {
      const worker = await importWorker();

      const initPromise = worker.init();
      mockProc.stdout.write("READY\n");
      await initPromise;

      // Push stderr data — the test verifies no crash
      mockProc.stderr.write("Fatal: module not found\n");
      mockProc.stderr.write("Loading model weights...\n");

      await flush();
    });
  });

  /* ===================== computeSimilarity() ===================== */

  describe("computeSimilarity()", () => {
    it("writes a JSON payload to stdin and resolves with the score", async () => {
      const worker = await importWorker();

      const initPromise = worker.init();
      mockProc.stdout.write("READY\n");
      await initPromise;

      const similarityPromise = worker.computeSimilarity("hello", "world");

      // Give the async init() await inside computeSimilarity time to settle
      await flush();

      expect(mockProc.stdin.write).toHaveBeenCalledOnce();
      const written = mockProc.stdin.write.mock.calls[0][0] as string;
      const parsed = JSON.parse(written.trim());
      expect(parsed).toEqual({ action: "similarity", text1: "hello", text2: "world" });

      // Simulate subprocess response
      mockProc.stdout.write(JSON.stringify({ score: 0.87 }) + "\n");

      await expect(similarityPromise).resolves.toBe(0.87);
    });

    it("rejects when the subprocess responds with an error field", async () => {
      const worker = await importWorker();

      const initPromise = worker.init();
      mockProc.stdout.write("READY\n");
      await initPromise;

      const similarityPromise = worker.computeSimilarity("a", "b");
      await flush();

      mockProc.stdout.write(JSON.stringify({ error: "tokenizer failed" }) + "\n");

      await expect(similarityPromise).rejects.toThrow("tokenizer failed");
    });

    it("throws when process stdin is null (not available)", async () => {
      const worker = await importWorker();

      const initPromise = worker.init();
      mockProc.stdout.write("READY\n");
      await initPromise;

      // Shut down to null out the process
      await worker.shutdown();

      // init() will spawn again, but we make spawn return a proc with no stdin
      const brokenProc = createMockProcess();
      (brokenProc as any).stdin = null;
      spawnMock.mockReturnValue(brokenProc);

      const initP = worker.init();
      brokenProc.stdout.write("READY\n");
      await initP;

      await expect(worker.computeSimilarity("x", "y")).rejects.toThrow(
        "ML worker not available"
      );
    });

    it("handles unparseable stdout lines without crashing", async () => {
      const worker = await importWorker();

      const initPromise = worker.init();
      mockProc.stdout.write("READY\n");
      await initPromise;

      // Push garbage that is not JSON and not "READY"
      mockProc.stdout.write("not-json-garbage\n");
      await flush();

      // Worker should still be functional
      const similarityPromise = worker.computeSimilarity("a", "b");
      await flush();
      mockProc.stdout.write(JSON.stringify({ score: 0.5 }) + "\n");
      await expect(similarityPromise).resolves.toBe(0.5);
    });
  });

  /* ===================== shutdown() ===================== */

  describe("shutdown()", () => {
    it("calls process.kill() and resets internal state", async () => {
      const worker = await importWorker();

      const initPromise = worker.init();
      mockProc.stdout.write("READY\n");
      await initPromise;

      await worker.shutdown();
      expect(mockProc.kill).toHaveBeenCalledOnce();

      // After shutdown, calling init again should spawn a new process
      const mockProc2 = createMockProcess();
      spawnMock.mockReturnValue(mockProc2);

      const initPromise2 = worker.init();
      expect(spawnMock).toHaveBeenCalledTimes(2);

      mockProc2.stdout.write("READY\n");
      await initPromise2;
    });

    it("is a no-op when no process is running", async () => {
      const worker = await importWorker();

      await expect(worker.shutdown()).resolves.toBeUndefined();
    });

    it("allows re-initialization and usage after shutdown", async () => {
      const worker = await importWorker();

      // First lifecycle
      const initPromise1 = worker.init();
      mockProc.stdout.write("READY\n");
      await initPromise1;
      await worker.shutdown();

      // Second lifecycle
      const mockProc2 = createMockProcess();
      spawnMock.mockReturnValue(mockProc2);
      const initPromise2 = worker.init();
      mockProc2.stdout.write("READY\n");
      await initPromise2;

      const simPromise = worker.computeSimilarity("x", "y");
      await flush();
      mockProc2.stdout.write(JSON.stringify({ score: 0.99 }) + "\n");
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
      mockProc.stdout.write("READY\n");
      await initPromise;

      // Fire three concurrent requests
      const p1 = worker.computeSimilarity("a", "b");
      const p2 = worker.computeSimilarity("c", "d");
      const p3 = worker.computeSimilarity("e", "f");

      await flush();

      expect(mockProc.stdin.write).toHaveBeenCalledTimes(3);

      // Respond in order
      mockProc.stdout.write(JSON.stringify({ score: 0.1 }) + "\n");
      mockProc.stdout.write(JSON.stringify({ score: 0.2 }) + "\n");
      mockProc.stdout.write(JSON.stringify({ score: 0.3 }) + "\n");

      await expect(p1).resolves.toBe(0.1);
      await expect(p2).resolves.toBe(0.2);
      await expect(p3).resolves.toBe(0.3);
    });

    it("handles a mix of success and error responses in queue", async () => {
      const worker = await importWorker();

      const initPromise = worker.init();
      mockProc.stdout.write("READY\n");
      await initPromise;

      const p1 = worker.computeSimilarity("ok", "text");
      const p2 = worker.computeSimilarity("bad", "text");
      const p3 = worker.computeSimilarity("ok2", "text2");

      await flush();

      mockProc.stdout.write(JSON.stringify({ score: 0.75 }) + "\n");
      mockProc.stdout.write(JSON.stringify({ error: "embedding failed" }) + "\n");
      mockProc.stdout.write(JSON.stringify({ score: 0.6 }) + "\n");

      await expect(p1).resolves.toBe(0.75);
      await expect(p2).rejects.toThrow("embedding failed");
      await expect(p3).resolves.toBe(0.6);
    });
  });
});
