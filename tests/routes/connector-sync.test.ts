import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockService = {
  createSyncJob: vi.fn().mockResolvedValue({ id: "job-1" }),
  executeSyncJob: vi.fn().mockResolvedValue({
    jobId: "job-1",
    status: "completed",
    documentsProcessed: 5,
    documentsDeleted: 0,
  }),
  getSyncJobs: vi.fn().mockResolvedValue([]),
  getSyncJobById: vi.fn().mockResolvedValue(null),
  cancelSyncJob: vi.fn().mockResolvedValue(null),
  createSyncSchedule: vi.fn().mockResolvedValue({ id: "sched-1" }),
  getSyncSchedules: vi.fn().mockResolvedValue([]),
  updateSyncSchedule: vi.fn().mockResolvedValue(null),
  deleteSyncSchedule: vi.fn().mockResolvedValue(null),
  SyncMode: { LOAD: "load", POLL: "poll", SLIM: "slim" },
  SyncJobStatus: { PENDING: "pending", RUNNING: "running", COMPLETED: "completed", FAILED: "failed" },
};

vi.mock("../../src/services/connectorSync.service.js", () => mockService);

vi.mock("../../src/middleware/fastifyAuth.js", () => ({
  fastifyRequireAuth: vi.fn(),
  fastifyRequireRole: vi.fn(),
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

vi.mock("../../src/lib/logger.js", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    })),
  },
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

const registeredRoutes: Record<string, { handler: Function; preHandler?: Function }> = {};

function createFastifyInstance(): any {
  const register = (method: string) =>
    vi.fn((path: string, opts: any, handler?: Function) => {
      const h = handler ?? opts;
      const pre = handler ? opts?.preHandler : undefined;
      registeredRoutes[`${method.toUpperCase()} ${path}`] = { handler: h, preHandler: pre };
    });

  return {
    register: vi.fn().mockResolvedValue(undefined),
    addHook: vi.fn().mockReturnThis(),
    get: register("GET"),
    post: register("POST"),
    put: register("PUT"),
    patch: register("PATCH"),
    delete: register("DELETE"),
  };
}

function createRequest(overrides: any = {}) {
  return {
    params: {},
    body: {},
    query: {},
    userId: 42,
    headers: { authorization: "Bearer token" },
    ...overrides,
  };
}

function createReply(): any {
  const reply: any = {
    statusCode: 200,
    status: vi.fn(function (this: any, c: number) {
      this.statusCode = c;
      return this;
    }),
    code: vi.fn(function (this: any, c: number) {
      this.statusCode = c;
      return this;
    }),
    send: vi.fn(function (this: any) {
      return this;
    }),
  };
  return reply;
}

// ─── Import & register ───────────────────────────────────────────────────────

let connectorSyncPlugin: any;

beforeEach(async () => {
  vi.clearAllMocks();
  for (const key of Object.keys(registeredRoutes)) {
    delete registeredRoutes[key];
  }

  // Reset default mock returns
  mockService.createSyncJob.mockResolvedValue({ id: "job-1" });
  mockService.executeSyncJob.mockResolvedValue({
    jobId: "job-1",
    status: "completed",
    documentsProcessed: 5,
    documentsDeleted: 0,
  });
  mockService.getSyncJobs.mockResolvedValue([]);
  mockService.getSyncJobById.mockResolvedValue(null);
  mockService.cancelSyncJob.mockResolvedValue(null);
  mockService.createSyncSchedule.mockResolvedValue({ id: "sched-1" });
  mockService.getSyncSchedules.mockResolvedValue([]);
  mockService.updateSyncSchedule.mockResolvedValue(null);
  mockService.deleteSyncSchedule.mockResolvedValue(null);

  const mod = await import("../../src/routes/connector-sync.js");
  connectorSyncPlugin = mod.default;
  const fastify = createFastifyInstance();
  await connectorSyncPlugin(fastify);
});

// ─── POST /:connectorId/sync ─────────────────────────────────────────────────
describe("POST /:connectorId/sync", () => {
  it("triggers a load sync and returns job result", async () => {
    const { handler } = registeredRoutes["POST /:connectorId/sync"];
    const request = createRequest({
      params: { connectorId: "conn-1" },
      body: { mode: "load" },
    });
    const reply = createReply();
    const result = await handler(request, reply);

    expect(mockService.createSyncJob).toHaveBeenCalledWith("conn-1", 42, "load");
    expect(mockService.executeSyncJob).toHaveBeenCalledWith("job-1");
    expect(reply.status).toHaveBeenCalledWith(201);
    expect(result).toEqual(
      expect.objectContaining({
        jobId: "job-1",
        status: "completed",
        documentsProcessed: 5,
      }),
    );
  });

  it("triggers a poll sync", async () => {
    const { handler } = registeredRoutes["POST /:connectorId/sync"];
    const request = createRequest({
      params: { connectorId: "conn-1" },
      body: { mode: "poll" },
    });
    await handler(request, createReply());
    expect(mockService.createSyncJob).toHaveBeenCalledWith("conn-1", 42, "poll");
  });

  it("triggers a slim sync", async () => {
    const { handler } = registeredRoutes["POST /:connectorId/sync"];
    const request = createRequest({
      params: { connectorId: "conn-1" },
      body: { mode: "slim" },
    });
    await handler(request, createReply());
    expect(mockService.createSyncJob).toHaveBeenCalledWith("conn-1", 42, "slim");
  });

  it("rejects invalid sync mode", async () => {
    const { handler } = registeredRoutes["POST /:connectorId/sync"];
    const request = createRequest({
      params: { connectorId: "conn-1" },
      body: { mode: "invalid" },
    });
    await expect(handler(request, createReply())).rejects.toThrow("Invalid sync mode");
  });
});

// ─── GET /:connectorId/sync/jobs ─────────────────────────────────────────────
describe("GET /:connectorId/sync/jobs", () => {
  it("returns sync jobs list", async () => {
    const mockJobs = [
      { id: "job-1", syncMode: "load", status: "completed" },
      { id: "job-2", syncMode: "poll", status: "running" },
    ];
    mockService.getSyncJobs.mockResolvedValueOnce(mockJobs);

    const { handler } = registeredRoutes["GET /:connectorId/sync/jobs"];
    const request = createRequest({ params: { connectorId: "conn-1" }, query: {} });
    const result = await handler(request);
    expect(result).toEqual({ jobs: mockJobs });
  });

  it("passes pagination and filter options", async () => {
    const { handler } = registeredRoutes["GET /:connectorId/sync/jobs"];
    const request = createRequest({
      params: { connectorId: "conn-1" },
      query: { limit: "5", offset: "10", status: "running", syncMode: "poll" },
    });
    await handler(request);
    expect(mockService.getSyncJobs).toHaveBeenCalledWith("conn-1", 42, {
      limit: 5,
      offset: 10,
      status: "running",
      syncMode: "poll",
    });
  });
});

// ─── GET /:connectorId/sync/jobs/:jobId ──────────────────────────────────────
describe("GET /:connectorId/sync/jobs/:jobId", () => {
  it("returns a sync job", async () => {
    const mockJob = { id: "job-1", syncMode: "load", status: "completed" };
    mockService.getSyncJobById.mockResolvedValueOnce(mockJob);

    const { handler } = registeredRoutes["GET /:connectorId/sync/jobs/:jobId"];
    const request = createRequest({ params: { connectorId: "conn-1", jobId: "job-1" } });
    const result = await handler(request);
    expect(result).toEqual(mockJob);
  });

  it("throws 404 when job not found", async () => {
    mockService.getSyncJobById.mockResolvedValueOnce(null);

    const { handler } = registeredRoutes["GET /:connectorId/sync/jobs/:jobId"];
    const request = createRequest({ params: { connectorId: "conn-1", jobId: "nonexistent" } });
    await expect(handler(request)).rejects.toThrow("Sync job not found");
  });
});

// ─── DELETE /:connectorId/sync/jobs/:jobId ───────────────────────────────────
describe("DELETE /:connectorId/sync/jobs/:jobId", () => {
  it("cancels a running job", async () => {
    mockService.cancelSyncJob.mockResolvedValueOnce({ cancelled: true });

    const { handler } = registeredRoutes["DELETE /:connectorId/sync/jobs/:jobId"];
    const request = createRequest({ params: { connectorId: "conn-1", jobId: "job-1" } });
    const result = await handler(request);
    expect(result).toEqual({ cancelled: true });
  });

  it("throws 404 when job not found", async () => {
    mockService.cancelSyncJob.mockResolvedValueOnce(null);

    const { handler } = registeredRoutes["DELETE /:connectorId/sync/jobs/:jobId"];
    const request = createRequest({ params: { connectorId: "conn-1", jobId: "nonexistent" } });
    await expect(handler(request)).rejects.toThrow("Sync job not found");
  });

  it("throws 400 when job already completed", async () => {
    mockService.cancelSyncJob.mockResolvedValueOnce({ error: "Cannot cancel a job that has already finished" });

    const { handler } = registeredRoutes["DELETE /:connectorId/sync/jobs/:jobId"];
    const request = createRequest({ params: { connectorId: "conn-1", jobId: "job-1" } });
    await expect(handler(request)).rejects.toThrow("Cannot cancel a job that has already finished");
  });
});

// ─── POST /:connectorId/sync/schedules ───────────────────────────────────────
describe("POST /:connectorId/sync/schedules", () => {
  it("creates a schedule", async () => {
    const { handler } = registeredRoutes["POST /:connectorId/sync/schedules"];
    const request = createRequest({
      params: { connectorId: "conn-1" },
      body: { syncMode: "poll", cronExpression: "0 */6 * * *" },
    });
    const reply = createReply();
    const result = await handler(request, reply);
    expect(reply.status).toHaveBeenCalledWith(201);
    expect(result).toEqual({ id: "sched-1" });
    expect(mockService.createSyncSchedule).toHaveBeenCalledWith(
      expect.objectContaining({
        connectorId: "conn-1",
        userId: 42,
        syncMode: "poll",
        cronExpression: "0 */6 * * *",
      }),
    );
  });

  it("rejects invalid sync mode", async () => {
    const { handler } = registeredRoutes["POST /:connectorId/sync/schedules"];
    const request = createRequest({
      params: { connectorId: "conn-1" },
      body: { syncMode: "nope", cronExpression: "0 * * * *" },
    });
    await expect(handler(request, createReply())).rejects.toThrow("Invalid sync mode");
  });

  it("rejects empty cron expression", async () => {
    const { handler } = registeredRoutes["POST /:connectorId/sync/schedules"];
    const request = createRequest({
      params: { connectorId: "conn-1" },
      body: { syncMode: "load", cronExpression: "" },
    });
    await expect(handler(request, createReply())).rejects.toThrow("cronExpression is required");
  });
});

// ─── GET /:connectorId/sync/schedules ────────────────────────────────────────
describe("GET /:connectorId/sync/schedules", () => {
  it("returns schedules list", async () => {
    const mockSchedules = [{ id: "sched-1", syncMode: "poll", cronExpression: "0 * * * *" }];
    mockService.getSyncSchedules.mockResolvedValueOnce(mockSchedules);

    const { handler } = registeredRoutes["GET /:connectorId/sync/schedules"];
    const request = createRequest({ params: { connectorId: "conn-1" } });
    const result = await handler(request);
    expect(result).toEqual({ schedules: mockSchedules });
  });
});

// ─── PUT /:connectorId/sync/schedules/:scheduleId ───────────────────────────
describe("PUT /:connectorId/sync/schedules/:scheduleId", () => {
  it("updates a schedule", async () => {
    mockService.updateSyncSchedule.mockResolvedValueOnce({ updated: true });

    const { handler } = registeredRoutes["PUT /:connectorId/sync/schedules/:scheduleId"];
    const request = createRequest({
      params: { connectorId: "conn-1", scheduleId: "sched-1" },
      body: { enabled: false },
    });
    const result = await handler(request);
    expect(result).toEqual({ updated: true });
  });

  it("throws 404 for nonexistent schedule", async () => {
    mockService.updateSyncSchedule.mockResolvedValueOnce(null);

    const { handler } = registeredRoutes["PUT /:connectorId/sync/schedules/:scheduleId"];
    const request = createRequest({
      params: { connectorId: "conn-1", scheduleId: "nonexistent" },
      body: { enabled: true },
    });
    await expect(handler(request)).rejects.toThrow("Schedule not found");
  });
});

// ─── DELETE /:connectorId/sync/schedules/:scheduleId ─────────────────────────
describe("DELETE /:connectorId/sync/schedules/:scheduleId", () => {
  it("deletes a schedule", async () => {
    mockService.deleteSyncSchedule.mockResolvedValueOnce({ deleted: true });

    const { handler } = registeredRoutes["DELETE /:connectorId/sync/schedules/:scheduleId"];
    const request = createRequest({
      params: { connectorId: "conn-1", scheduleId: "sched-1" },
    });
    const result = await handler(request);
    expect(result).toEqual({ deleted: true });
  });

  it("throws 404 for nonexistent schedule", async () => {
    mockService.deleteSyncSchedule.mockResolvedValueOnce(null);

    const { handler } = registeredRoutes["DELETE /:connectorId/sync/schedules/:scheduleId"];
    const request = createRequest({
      params: { connectorId: "conn-1", scheduleId: "nonexistent" },
    });
    await expect(handler(request)).rejects.toThrow("Schedule not found");
  });
});
