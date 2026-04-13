import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock ioredis
vi.mock("ioredis", () => {
  class MockIORedis {
    status = "ready";
  }
  return { default: MockIORedis };
});

// Track Worker instances
const workerInstances: Array<{
  name: string;
  processor: Function;
  opts: any;
  close: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  eventHandlers: Record<string, Function>;
}> = [];

vi.mock("bullmq", () => {
  class MockWorker {
    name: string;
    processor: Function;
    opts: any;
    close = vi.fn().mockResolvedValue(undefined);
    on: ReturnType<typeof vi.fn>;
    eventHandlers: Record<string, Function> = {};
    constructor(name: string, processor: Function, opts: any) {
      this.name = name;
      this.processor = processor;
      this.opts = opts;
      this.on = vi.fn((event: string, handler: Function) => {
        this.eventHandlers[event] = handler;
      });
      workerInstances.push(this);
    }
  }
  class MockQueue {
    name: string;
    opts: any;
    add = vi.fn().mockResolvedValue(undefined);
    close = vi.fn();
    constructor(name: string, opts: any) {
      this.name = name;
      this.opts = opts;
    }
  }
  return { Worker: MockWorker, Queue: MockQueue };
});

// Mock connection
vi.mock("../../src/queue/connection.js", () => ({
  default: { status: "ready" },
}));

// Mock logger
vi.mock("../../src/lib/logger.js", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe("workers", () => {
  beforeEach(() => {
    workerInstances.length = 0;
  });

  it("startWorkers should create 4 workers", async () => {
    const { startWorkers } = await import("../../src/queue/workers.js");
    startWorkers();

    expect(workerInstances).toHaveLength(4);

    const names = workerInstances.map((w) => w.name);
    expect(names).toContain("ingestion");
    expect(names).toContain("repo-ingestion");
    expect(names).toContain("research");
    expect(names).toContain("compaction");
  });

  it("stopWorkers should call close on all workers", async () => {
    const { startWorkers, stopWorkers } = await import("../../src/queue/workers.js");
    startWorkers();

    await stopWorkers();

    for (const worker of workerInstances) {
      expect(worker.close).toHaveBeenCalled();
    }
  });

  it("failed handler should move job to DLQ when attempts are exhausted", async () => {
    const { startWorkers } = await import("../../src/queue/workers.js");
    const { deadLetterQueue } = await import("../../src/queue/queues.js");

    startWorkers();

    // Get any worker's failed handler
    const worker = workerInstances.find((w) => w.eventHandlers["failed"]);
    expect(worker).toBeDefined();

    const failedHandler = worker!.eventHandlers["failed"];

    // Simulate a job that has exhausted all attempts
    const exhaustedJob = {
      id: "job-123",
      name: "test-job",
      data: { foo: "bar" },
      attemptsMade: 3,
      opts: { attempts: 3 },
      stacktrace: ["Error: something failed"],
    };
    const error = new Error("Processing failed");

    await failedHandler(exhaustedJob, error);

    expect(deadLetterQueue.add).toHaveBeenCalledWith(
      "dead-letter",
      expect.objectContaining({
        originalJobId: "job-123",
        originalJobName: "test-job",
        failedReason: "Processing failed",
      })
    );
  });

  it("failed handler should NOT move to DLQ when attempts remain", async () => {
    const { startWorkers } = await import("../../src/queue/workers.js");
    const { deadLetterQueue } = await import("../../src/queue/queues.js");

    // Clear previous add calls
    (deadLetterQueue.add as ReturnType<typeof vi.fn>).mockClear();

    startWorkers();

    const worker = workerInstances.find((w) => w.eventHandlers["failed"]);
    const failedHandler = worker!.eventHandlers["failed"];

    // Job with attempts remaining
    const retryableJob = {
      id: "job-456",
      name: "test-job",
      data: {},
      attemptsMade: 1,
      opts: { attempts: 3 },
      stacktrace: [],
    };

    await failedHandler(retryableJob, new Error("Temporary failure"));

    expect(deadLetterQueue.add).not.toHaveBeenCalled();
  });
});
