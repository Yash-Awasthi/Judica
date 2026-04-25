import { describe, it, expect, vi, beforeEach } from "vitest";

// ---- mocks ----

const mockDb: any = {};

function chainable(overrides: Record<string, any> = {}): any {
  const chain: any = {};
  const methods = [
    "select",
    "from",
    "where",
    "limit",
    "orderBy",
    "update",
    "set",
    "insert",
    "values",
    "returning",
    "delete",
  ];
  for (const m of methods) {
    chain[m] = overrides[m] ?? vi.fn(() => chain);
  }
  return chain;
}

vi.mock("../../src/lib/drizzle.js", () => ({
  db: mockDb,
}));

vi.mock("../../src/db/schema/users.js", () => ({
  users: { id: "users.id", role: "users.role" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: any[]) => args),
}));

vi.mock("../../src/middleware/fastifyAuth.js", () => ({
  fastifyRequireAuth: vi.fn(),
  fastifyRequireAdmin: vi.fn(),
}));

vi.mock("../../src/middleware/errorHandler.js", () => ({
  AppError: class AppError extends Error {
    statusCode: number;
    code: string;
    constructor(statusCode: number, message: string, code: string = "INTERNAL_ERROR") {
      super(message);
      this.statusCode = statusCode;
      this.code = code;
    }
  },
}));

const mockGetActiveCount = vi.fn();
const mockGetWaitingCount = vi.fn();
const mockGetCompletedCount = vi.fn();
const mockGetFailedCount = vi.fn();
const mockGetJob = vi.fn();

function createMockQueue() {
  return {
    getActiveCount: mockGetActiveCount,
    getWaitingCount: mockGetWaitingCount,
    getCompletedCount: mockGetCompletedCount,
    getFailedCount: mockGetFailedCount,
    getJob: mockGetJob,
  };
}

const mockIngestionQueue = createMockQueue();
const mockResearchQueue = createMockQueue();
const mockRepoQueue = createMockQueue();
const mockCompactionQueue = createMockQueue();

vi.mock("../../src/queue/queues.js", () => ({
  ingestionQueue: mockIngestionQueue,
  researchQueue: mockResearchQueue,
  repoQueue: mockRepoQueue,
  compactionQueue: mockCompactionQueue,
}));

// ---- helpers to capture registered route handlers ----

const registeredRoutes: Record<string, { handler: Function; preHandler?: Function; onRequest?: Function }> = {};

function createFastifyInstance(): any {
  const register = (method: string) =>
    vi.fn((path: string, opts: any, handler?: Function) => {
      const h = handler ?? opts;
      const pre = handler ? opts?.preHandler : undefined;
      const onReq = handler ? opts?.onRequest : undefined;
      registeredRoutes[`${method.toUpperCase()} ${path}`] = { handler: h, preHandler: pre, onRequest: onReq };
    });

  return {
    get: register("GET"),
    post: register("POST"),
    put: register("PUT"),
    delete: register("DELETE"),
  };
}

function createRequest(overrides: Partial<{ userId: number; body: any; params: any; headers: Record<string, string> }> = {}): any {
  return {
    userId: overrides.userId ?? 1,
    body: overrides.body ?? {},
    params: overrides.params ?? {},
    headers: overrides.headers ?? { authorization: "Bearer token" },
  };
}

function createReply(): any {
  const reply: any = {
    statusCode: 200,
    sent: false,
    code: vi.fn(function (this: any, c: number) {
      this.statusCode = c;
      return this;
    }),
    send: vi.fn(function (this: any, b: any) {
      this._body = b;
      return this;
    }),
  };
  return reply;
}

// ---- import and register the plugin ----

let queuePlugin: any;

beforeEach(async () => {
  vi.clearAllMocks();
  for (const key of Object.keys(registeredRoutes)) {
    delete registeredRoutes[key];
  }

  const mod = await import("../../src/routes/queue.js");
  queuePlugin = mod.default;
  const fastify = createFastifyInstance();
  await queuePlugin(fastify);
});

// ================================================================
// Route registration
// ================================================================
describe("route registration", () => {
  it("registers GET /stats", () => {
    expect(registeredRoutes["GET /stats"]).toBeDefined();
    expect(registeredRoutes["GET /stats"].handler).toBeInstanceOf(Function);
  });

  it("registers GET /jobs/:queueName/:jobId", () => {
    expect(registeredRoutes["GET /jobs/:queueName/:jobId"]).toBeDefined();
  });

  it("registers DELETE /jobs/:queueName/:jobId", () => {
    expect(registeredRoutes["DELETE /jobs/:queueName/:jobId"]).toBeDefined();
  });

  it("sets preHandler hook for GET /stats with admin role check", () => {
    expect(registeredRoutes["GET /stats"].preHandler).toBeDefined();
  });

  it("sets preHandler for GET /jobs/:queueName/:jobId with admin role check", () => {
    expect(registeredRoutes["GET /jobs/:queueName/:jobId"].preHandler).toBeDefined();
  });

  it("sets preHandler for DELETE /jobs/:queueName/:jobId with admin role check", () => {
    expect(registeredRoutes["DELETE /jobs/:queueName/:jobId"].preHandler).toBeDefined();
  });
});

// ================================================================
// GET /stats
// ================================================================
describe("GET /stats", () => {
  it("returns stats for all four queues", async () => {
    mockGetActiveCount.mockResolvedValue(1);
    mockGetWaitingCount.mockResolvedValue(2);
    mockGetCompletedCount.mockResolvedValue(10);
    mockGetFailedCount.mockResolvedValue(3);

    const request = createRequest();
    const reply = createReply();

    const result = await registeredRoutes["GET /stats"].handler(request, reply);

    expect(result).toEqual({
      data: {
        ingestion: { active: 1, waiting: 2, completed: 10, failed: 3 },
        research: { active: 1, waiting: 2, completed: 10, failed: 3 },
        "repo-ingestion": { active: 1, waiting: 2, completed: 10, failed: 3 },
        compaction: { active: 1, waiting: 2, completed: 10, failed: 3 },
      },
    });
  });

  it("calls getActiveCount, getWaitingCount, getCompletedCount, getFailedCount for each queue", async () => {
    mockGetActiveCount.mockResolvedValue(0);
    mockGetWaitingCount.mockResolvedValue(0);
    mockGetCompletedCount.mockResolvedValue(0);
    mockGetFailedCount.mockResolvedValue(0);

    const request = createRequest();
    const reply = createReply();

    await registeredRoutes["GET /stats"].handler(request, reply);

    // Each of the 4 queues calls all 4 stat methods
    expect(mockGetActiveCount).toHaveBeenCalledTimes(4);
    expect(mockGetWaitingCount).toHaveBeenCalledTimes(4);
    expect(mockGetCompletedCount).toHaveBeenCalledTimes(4);
    expect(mockGetFailedCount).toHaveBeenCalledTimes(4);
  });

  it("propagates errors from queue stats", async () => {
    mockGetActiveCount.mockRejectedValue(new Error("Redis connection failed"));
    mockGetWaitingCount.mockResolvedValue(0);
    mockGetCompletedCount.mockResolvedValue(0);
    mockGetFailedCount.mockResolvedValue(0);

    const request = createRequest();
    const reply = createReply();

    await expect(registeredRoutes["GET /stats"].handler(request, reply)).rejects.toThrow("Redis connection failed");
  });
});

// ================================================================
// GET /jobs/:queueName/:jobId
// ================================================================
describe("GET /jobs/:queueName/:jobId", () => {
  it("returns job details for a valid queue and job", async () => {
    const mockJob = {
      id: "job-123",
      name: "processDocument",
      data: { docId: "abc" },
      progress: 50,
      attemptsMade: 1,
      timestamp: 1700000000000,
      finishedOn: null,
      failedReason: null,
      getState: vi.fn().mockResolvedValue("active"),
    };
    mockGetJob.mockResolvedValue(mockJob);

    const request = createRequest({ params: { queueName: "ingestion", jobId: "job-123" } });
    const reply = createReply();

    const result = await registeredRoutes["GET /jobs/:queueName/:jobId"].handler(request, reply);

    expect(result).toEqual({
      data: {
        id: "job-123",
        name: "processDocument",
        state: "active",
        data: { docId: "abc" },
        progress: 50,
        attemptsMade: 1,
        timestamp: 1700000000000,
        finishedOn: null,
        failedReason: null,
      },
    });
  });

  it("returns 404 for an unknown queue name", async () => {
    const request = createRequest({ params: { queueName: "nonexistent", jobId: "job-1" } });
    const reply = createReply();

    await registeredRoutes["GET /jobs/:queueName/:jobId"].handler(request, reply);

    expect(reply.code).toHaveBeenCalledWith(404);
    expect(reply.send).toHaveBeenCalledWith({ error: "Queue not found" });
  });

  it("returns 404 when job is not found", async () => {
    mockGetJob.mockResolvedValue(null);

    const request = createRequest({ params: { queueName: "research", jobId: "missing-job" } });
    const reply = createReply();

    await registeredRoutes["GET /jobs/:queueName/:jobId"].handler(request, reply);

    expect(reply.code).toHaveBeenCalledWith(404);
    expect(reply.send).toHaveBeenCalledWith({ error: "Job not found" });
  });

  it("works for the research queue", async () => {
    const mockJob = {
      id: "r-1",
      name: "research",
      data: {},
      progress: 100,
      attemptsMade: 0,
      timestamp: 1700000000000,
      finishedOn: 1700000001000,
      failedReason: null,
      getState: vi.fn().mockResolvedValue("completed"),
    };
    mockGetJob.mockResolvedValue(mockJob);

    const request = createRequest({ params: { queueName: "research", jobId: "r-1" } });
    const reply = createReply();

    const result = await registeredRoutes["GET /jobs/:queueName/:jobId"].handler(request, reply);

    expect(result!.data.state).toBe("completed");
    expect(result!.data.finishedOn).toBe(1700000001000);
  });

  it("works for the repo-ingestion queue", async () => {
    const mockJob = {
      id: "repo-1",
      name: "ingestRepo",
      data: { repoUrl: "https://github.com/test/repo" },
      progress: 0,
      attemptsMade: 2,
      timestamp: 1700000000000,
      finishedOn: null,
      failedReason: "timeout",
      getState: vi.fn().mockResolvedValue("failed"),
    };
    mockGetJob.mockResolvedValue(mockJob);

    const request = createRequest({ params: { queueName: "repo-ingestion", jobId: "repo-1" } });
    const reply = createReply();

    const result = await registeredRoutes["GET /jobs/:queueName/:jobId"].handler(request, reply);

    expect(result!.data.state).toBe("failed");
    expect(result!.data.failedReason).toBe("timeout");
  });

  it("works for the compaction queue", async () => {
    const mockJob = {
      id: "c-1",
      name: "compact",
      data: {},
      progress: 0,
      attemptsMade: 0,
      timestamp: 1700000000000,
      finishedOn: null,
      failedReason: null,
      getState: vi.fn().mockResolvedValue("waiting"),
    };
    mockGetJob.mockResolvedValue(mockJob);

    const request = createRequest({ params: { queueName: "compaction", jobId: "c-1" } });
    const reply = createReply();

    const result = await registeredRoutes["GET /jobs/:queueName/:jobId"].handler(request, reply);

    expect(result!.data.state).toBe("waiting");
  });

  it("propagates errors from queue.getJob", async () => {
    mockGetJob.mockRejectedValue(new Error("Redis error"));

    const request = createRequest({ params: { queueName: "ingestion", jobId: "job-1" } });
    const reply = createReply();

    await expect(
      registeredRoutes["GET /jobs/:queueName/:jobId"].handler(request, reply)
    ).rejects.toThrow("Redis error");
  });
});

// ================================================================
// DELETE /jobs/:queueName/:jobId
// ================================================================
describe("DELETE /jobs/:queueName/:jobId", () => {
  it("returns 404 for an unknown queue name", async () => {
    const request = createRequest({ params: { queueName: "badqueue", jobId: "j-1" } });
    const reply = createReply();

    await registeredRoutes["DELETE /jobs/:queueName/:jobId"].handler(request, reply);

    expect(reply.code).toHaveBeenCalledWith(404);
    expect(reply.send).toHaveBeenCalledWith({ error: "Queue not found" });
  });

  it("returns 404 when job is not found", async () => {
    mockGetJob.mockResolvedValue(null);

    const request = createRequest({ params: { queueName: "ingestion", jobId: "missing" } });
    const reply = createReply();

    await registeredRoutes["DELETE /jobs/:queueName/:jobId"].handler(request, reply);

    expect(reply.code).toHaveBeenCalledWith(404);
    expect(reply.send).toHaveBeenCalledWith({ error: "Job not found" });
  });

  it("moves active job to failed state", async () => {
    const mockMoveToFailed = vi.fn().mockResolvedValue(undefined);
    const mockJob = {
      id: "j-1",
      getState: vi.fn().mockResolvedValue("active"),
      moveToFailed: mockMoveToFailed,
      remove: vi.fn(),
    };
    mockGetJob.mockResolvedValue(mockJob);

    const request = createRequest({ params: { queueName: "ingestion", jobId: "j-1" } });
    const reply = createReply();

    const result = await registeredRoutes["DELETE /jobs/:queueName/:jobId"].handler(request, reply);

    expect(mockMoveToFailed).toHaveBeenCalledTimes(1);
    expect(mockMoveToFailed).toHaveBeenCalledWith(expect.any(Error), "0");
    expect(mockMoveToFailed.mock.calls[0][0].message).toBe("Cancelled by admin");
    expect(mockJob.remove).not.toHaveBeenCalled();
    expect(result).toEqual({ message: "Job cancelled", jobId: "j-1", previousState: "active" });
  });

  it("removes waiting job", async () => {
    const mockRemove = vi.fn().mockResolvedValue(undefined);
    const mockJob = {
      id: "j-2",
      getState: vi.fn().mockResolvedValue("waiting"),
      moveToFailed: vi.fn(),
      remove: mockRemove,
    };
    mockGetJob.mockResolvedValue(mockJob);

    const request = createRequest({ params: { queueName: "research", jobId: "j-2" } });
    const reply = createReply();

    const result = await registeredRoutes["DELETE /jobs/:queueName/:jobId"].handler(request, reply);

    expect(mockRemove).toHaveBeenCalledTimes(1);
    expect(mockJob.moveToFailed).not.toHaveBeenCalled();
    expect(result).toEqual({ message: "Job cancelled", jobId: "j-2", previousState: "waiting" });
  });

  it("removes delayed job", async () => {
    const mockRemove = vi.fn().mockResolvedValue(undefined);
    const mockJob = {
      id: "j-3",
      getState: vi.fn().mockResolvedValue("delayed"),
      moveToFailed: vi.fn(),
      remove: mockRemove,
    };
    mockGetJob.mockResolvedValue(mockJob);

    const request = createRequest({ params: { queueName: "compaction", jobId: "j-3" } });
    const reply = createReply();

    const result = await registeredRoutes["DELETE /jobs/:queueName/:jobId"].handler(request, reply);

    expect(mockRemove).toHaveBeenCalledTimes(1);
    expect(mockJob.moveToFailed).not.toHaveBeenCalled();
    expect(result).toEqual({ message: "Job cancelled", jobId: "j-3", previousState: "delayed" });
  });

  it("returns 400 when job is in completed state", async () => {
    const mockJob = {
      id: "j-4",
      getState: vi.fn().mockResolvedValue("completed"),
      moveToFailed: vi.fn(),
      remove: vi.fn(),
    };
    mockGetJob.mockResolvedValue(mockJob);

    const request = createRequest({ params: { queueName: "ingestion", jobId: "j-4" } });
    const reply = createReply();

    await registeredRoutes["DELETE /jobs/:queueName/:jobId"].handler(request, reply);

    expect(reply.code).toHaveBeenCalledWith(400);
    expect(reply.send).toHaveBeenCalledWith({ error: "Cannot cancel job in 'completed' state" });
    expect(mockJob.moveToFailed).not.toHaveBeenCalled();
    expect(mockJob.remove).not.toHaveBeenCalled();
  });

  it("returns 400 when job is in failed state", async () => {
    const mockJob = {
      id: "j-5",
      getState: vi.fn().mockResolvedValue("failed"),
      moveToFailed: vi.fn(),
      remove: vi.fn(),
    };
    mockGetJob.mockResolvedValue(mockJob);

    const request = createRequest({ params: { queueName: "ingestion", jobId: "j-5" } });
    const reply = createReply();

    await registeredRoutes["DELETE /jobs/:queueName/:jobId"].handler(request, reply);

    expect(reply.code).toHaveBeenCalledWith(400);
    expect(reply.send).toHaveBeenCalledWith({ error: "Cannot cancel job in 'failed' state" });
  });

  it("works for the repo-ingestion queue", async () => {
    const mockJob = {
      id: "repo-j-1",
      getState: vi.fn().mockResolvedValue("waiting"),
      moveToFailed: vi.fn(),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    mockGetJob.mockResolvedValue(mockJob);

    const request = createRequest({ params: { queueName: "repo-ingestion", jobId: "repo-j-1" } });
    const reply = createReply();

    const result = await registeredRoutes["DELETE /jobs/:queueName/:jobId"].handler(request, reply);

    expect(result).toEqual({ message: "Job cancelled", jobId: "repo-j-1", previousState: "waiting" });
  });

  it("propagates errors from job.moveToFailed", async () => {
    const mockJob = {
      id: "j-err",
      getState: vi.fn().mockResolvedValue("active"),
      moveToFailed: vi.fn().mockRejectedValue(new Error("Move failed")),
      remove: vi.fn(),
    };
    mockGetJob.mockResolvedValue(mockJob);

    const request = createRequest({ params: { queueName: "ingestion", jobId: "j-err" } });
    const reply = createReply();

    await expect(
      registeredRoutes["DELETE /jobs/:queueName/:jobId"].handler(request, reply)
    ).rejects.toThrow("Move failed");
  });

  it("propagates errors from job.remove", async () => {
    const mockJob = {
      id: "j-err2",
      getState: vi.fn().mockResolvedValue("waiting"),
      moveToFailed: vi.fn(),
      remove: vi.fn().mockRejectedValue(new Error("Remove failed")),
    };
    mockGetJob.mockResolvedValue(mockJob);

    const request = createRequest({ params: { queueName: "ingestion", jobId: "j-err2" } });
    const reply = createReply();

    await expect(
      registeredRoutes["DELETE /jobs/:queueName/:jobId"].handler(request, reply)
    ).rejects.toThrow("Remove failed");
  });
});

// ================================================================
// fastifyRequireAdmin middleware
// ================================================================
describe("fastifyRequireAdmin middleware", () => {
  it("uses fastifyRequireAdmin as preHandler for GET /stats", async () => {
    const { fastifyRequireAdmin } = await import("../../src/middleware/fastifyAuth.js");
    expect(registeredRoutes["GET /stats"].preHandler).toBe(fastifyRequireAdmin);
  });

  it("uses fastifyRequireAdmin as preHandler for GET /jobs/:queueName/:jobId", async () => {
    const { fastifyRequireAdmin } = await import("../../src/middleware/fastifyAuth.js");
    expect(registeredRoutes["GET /jobs/:queueName/:jobId"].preHandler).toBe(fastifyRequireAdmin);
  });

  it("uses fastifyRequireAdmin as preHandler for DELETE /jobs/:queueName/:jobId", async () => {
    const { fastifyRequireAdmin } = await import("../../src/middleware/fastifyAuth.js");
    expect(registeredRoutes["DELETE /jobs/:queueName/:jobId"].preHandler).toBe(fastifyRequireAdmin);
  });

  it("fastifyRequireAdmin is a function", async () => {
    const { fastifyRequireAdmin } = await import("../../src/middleware/fastifyAuth.js");
    expect(fastifyRequireAdmin).toBeInstanceOf(Function);
  });

  it("all admin routes have preHandler defined", () => {
    expect(registeredRoutes["GET /stats"].preHandler).toBeDefined();
    expect(registeredRoutes["GET /jobs/:queueName/:jobId"].preHandler).toBeDefined();
    expect(registeredRoutes["DELETE /jobs/:queueName/:jobId"].preHandler).toBeDefined();
  });
});
