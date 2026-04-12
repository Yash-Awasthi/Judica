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

  describe("worker processor functions", () => {
    const mockStoreChunk = vi.fn().mockResolvedValue(undefined);
    const mockIngestGitHubRepo = vi.fn().mockResolvedValue(undefined);
    const mockRunResearch = vi.fn().mockResolvedValue(undefined);
    const mockCompact = vi.fn().mockResolvedValue(undefined);

    beforeEach(() => {
      mockStoreChunk.mockClear();
      mockIngestGitHubRepo.mockClear();
      mockRunResearch.mockClear();
      mockCompact.mockClear();

      vi.doMock("../../src/services/vectorStore.service.js", () => ({
        storeChunk: mockStoreChunk,
      }));
      vi.doMock("../../src/services/repoIngestion.service.js", () => ({
        ingestGitHubRepo: mockIngestGitHubRepo,
      }));
      vi.doMock("../../src/services/research.service.js", () => ({
        runResearch: mockRunResearch,
      }));
      vi.doMock("../../src/services/memoryCompaction.service.js", () => ({
        compact: mockCompact,
      }));
    });

    it("ingestion worker should call storeChunk with destructured job data", async () => {
      const { startWorkers } = await import("../../src/queue/workers.js");
      startWorkers();

      const ingestionWorker = workerInstances.find((w) => w.name === "ingestion");
      expect(ingestionWorker).toBeDefined();

      const job = {
        id: "ingest-1",
        data: {
          userId: 10,
          kbId: "kb-abc",
          content: "some text content",
          chunkIndex: 3,
          sourceName: "doc.pdf",
          sourceUrl: "https://example.com/doc.pdf",
        },
      };

      await ingestionWorker!.processor(job);

      expect(mockStoreChunk).toHaveBeenCalledWith(
        10, "kb-abc", "some text content", 3, "doc.pdf", "https://example.com/doc.pdf"
      );
    });

    it("repo-ingestion worker should call ingestGitHubRepo with destructured job data", async () => {
      const { startWorkers } = await import("../../src/queue/workers.js");
      startWorkers();

      const repoWorker = workerInstances.find((w) => w.name === "repo-ingestion");
      expect(repoWorker).toBeDefined();

      const job = {
        id: "repo-1",
        data: {
          userId: 20,
          owner: "octocat",
          repo: "hello-world",
        },
      };

      await repoWorker!.processor(job);

      expect(mockIngestGitHubRepo).toHaveBeenCalledWith(20, "octocat", "hello-world");
    });

    it("research worker should call runResearch with destructured job data", async () => {
      const { startWorkers } = await import("../../src/queue/workers.js");
      startWorkers();

      const researchWorker = workerInstances.find((w) => w.name === "research");
      expect(researchWorker).toBeDefined();

      const job = {
        id: "research-1",
        data: {
          jobId: "rj-42",
          userId: 30,
          query: "What is BullMQ?",
        },
      };

      await researchWorker!.processor(job);

      expect(mockRunResearch).toHaveBeenCalledWith("rj-42", 30, "What is BullMQ?");
    });

    it("compaction worker should call compact with userId from job data", async () => {
      const { startWorkers } = await import("../../src/queue/workers.js");
      startWorkers();

      const compactionWorker = workerInstances.find((w) => w.name === "compaction");
      expect(compactionWorker).toBeDefined();

      const job = {
        id: "compact-1",
        data: {
          userId: 40,
        },
      };

      await compactionWorker!.processor(job);

      expect(mockCompact).toHaveBeenCalledWith(40);
    });

    it("ingestion worker processor should propagate service errors", async () => {
      mockStoreChunk.mockRejectedValueOnce(new Error("Vector store unavailable"));

      const { startWorkers } = await import("../../src/queue/workers.js");
      startWorkers();

      const ingestionWorker = workerInstances.find((w) => w.name === "ingestion");
      const job = {
        id: "ingest-err",
        data: {
          userId: 1,
          kbId: "kb-1",
          content: "text",
          chunkIndex: 0,
          sourceName: "file.txt",
          sourceUrl: "https://example.com/file.txt",
        },
      };

      await expect(ingestionWorker!.processor(job)).rejects.toThrow("Vector store unavailable");
    });
  });

  describe("completed event handler", () => {
    it("should log job completion with jobId and queue name", async () => {
      const logger = (await import("../../src/lib/logger.js")).default;
      (logger.info as ReturnType<typeof vi.fn>).mockClear();

      const { startWorkers } = await import("../../src/queue/workers.js");
      startWorkers();

      const worker = workerInstances.find((w) => w.eventHandlers["completed"]);
      expect(worker).toBeDefined();

      const completedHandler = worker!.eventHandlers["completed"];
      const completedJob = { id: "done-99" };

      completedHandler(completedJob);

      expect(logger.info).toHaveBeenCalledWith(
        { jobId: "done-99", queue: worker!.name },
        "Worker job completed"
      );
    });

    it("should handle completed event when job is undefined", async () => {
      const logger = (await import("../../src/lib/logger.js")).default;
      (logger.info as ReturnType<typeof vi.fn>).mockClear();

      const { startWorkers } = await import("../../src/queue/workers.js");
      startWorkers();

      const worker = workerInstances.find((w) => w.eventHandlers["completed"]);
      const completedHandler = worker!.eventHandlers["completed"];

      // Should not throw when job is undefined
      completedHandler(undefined);

      expect(logger.info).toHaveBeenCalledWith(
        { jobId: undefined, queue: worker!.name },
        "Worker job completed"
      );
    });
  });

  describe("DLQ error path", () => {
    it("should log error when deadLetterQueue.add rejects", async () => {
      const { startWorkers } = await import("../../src/queue/workers.js");
      const { deadLetterQueue } = await import("../../src/queue/queues.js");
      const logger = (await import("../../src/lib/logger.js")).default;

      (deadLetterQueue.add as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("Redis connection lost")
      );
      (logger.error as ReturnType<typeof vi.fn>).mockClear();

      startWorkers();

      const worker = workerInstances.find((w) => w.eventHandlers["failed"]);
      const failedHandler = worker!.eventHandlers["failed"];

      const exhaustedJob = {
        id: "job-dlq-err",
        name: "failing-job",
        data: { key: "value" },
        attemptsMade: 3,
        opts: { attempts: 3 },
        stacktrace: ["Error: boom"],
      };

      await failedHandler(exhaustedJob, new Error("Original failure"));

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          jobId: "job-dlq-err",
          queue: worker!.name,
          err: expect.any(Error),
        }),
        "Failed to move job to dead-letter queue"
      );
    });
  });

  describe("failed handler edge cases", () => {
    it("should not move to DLQ when job is undefined", async () => {
      const { startWorkers } = await import("../../src/queue/workers.js");
      const { deadLetterQueue } = await import("../../src/queue/queues.js");
      (deadLetterQueue.add as ReturnType<typeof vi.fn>).mockClear();

      startWorkers();

      const worker = workerInstances.find((w) => w.eventHandlers["failed"]);
      const failedHandler = worker!.eventHandlers["failed"];

      await failedHandler(undefined, new Error("Unknown failure"));

      expect(deadLetterQueue.add).not.toHaveBeenCalled();
    });

    it("should default to 3 attempts when job.opts.attempts is undefined", async () => {
      const { startWorkers } = await import("../../src/queue/workers.js");
      const { deadLetterQueue } = await import("../../src/queue/queues.js");
      (deadLetterQueue.add as ReturnType<typeof vi.fn>).mockClear();

      startWorkers();

      const worker = workerInstances.find((w) => w.eventHandlers["failed"]);
      const failedHandler = worker!.eventHandlers["failed"];

      // attemptsMade equals the default of 3 (opts.attempts is undefined)
      const job = {
        id: "job-default-attempts",
        name: "test-job",
        data: {},
        attemptsMade: 3,
        opts: {},
        stacktrace: [],
      };

      await failedHandler(job, new Error("Failed"));

      expect(deadLetterQueue.add).toHaveBeenCalledWith(
        "dead-letter",
        expect.objectContaining({ originalJobId: "job-default-attempts" })
      );
    });
  });
});
