import { describe, it, expect, vi } from "vitest";

// Mock ioredis
vi.mock("ioredis", () => {
  class MockIORedis {
    status = "ready";
  }
  return { default: MockIORedis };
});

// Track Queue constructor calls
const queueInstances: Array<{ name: string; opts: any; add: any; close: any }> = [];

vi.mock("bullmq", () => {
  class MockQueue {
    name: string;
    opts: any;
    add = vi.fn();
    close = vi.fn();
    constructor(name: string, opts: any) {
      this.name = name;
      this.opts = opts;
      queueInstances.push(this);
    }
  }
  return { Queue: MockQueue };
});

// Mock connection
vi.mock("../../src/queue/connection.js", () => ({
  default: { status: "ready" },
}));

describe("queues", () => {
  it("should create all expected queues", async () => {
    const {
      ingestionQueue,
      researchQueue,
      repoQueue,
      compactionQueue,
      deadLetterQueue,
    } = await import("../../src/queue/queues.js");

    const queueNames = queueInstances.map((q) => q.name);
    expect(queueNames).toContain("ingestion");
    expect(queueNames).toContain("research");
    expect(queueNames).toContain("repo-ingestion");
    expect(queueNames).toContain("compaction");
    expect(queueNames).toContain("dead-letter");
  });

  it("should assign correct names to queue exports", async () => {
    const {
      ingestionQueue,
      researchQueue,
      repoQueue,
      compactionQueue,
      deadLetterQueue,
    } = await import("../../src/queue/queues.js");

    expect(ingestionQueue.name).toBe("ingestion");
    expect(researchQueue.name).toBe("research");
    expect(repoQueue.name).toBe("repo-ingestion");
    expect(compactionQueue.name).toBe("compaction");
    expect(deadLetterQueue.name).toBe("dead-letter");
  });
});
