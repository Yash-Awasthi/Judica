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

vi.mock("../../src/db/schema/research.js", () => ({
  researchJobs: {
    id: "researchJobs.id",
    userId: "researchJobs.userId",
    query: "researchJobs.query",
    status: "researchJobs.status",
    steps: "researchJobs.steps",
    report: "researchJobs.report",
    createdAt: "researchJobs.createdAt",
    updatedAt: "researchJobs.updatedAt",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: any[]) => args),
  and: vi.fn((...args: any[]) => args),
  desc: vi.fn((col: any) => col),
  count: vi.fn(() => "count"),
}));

vi.mock("../../src/middleware/fastifyAuth.js", () => ({
  fastifyRequireAuth: vi.fn(),
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

const mockRunResearch = vi.fn();
vi.mock("../../src/services/research.service.js", () => ({
  runResearch: (...args: any[]) => mockRunResearch(...args),
}));

vi.mock("crypto", () => ({
  randomUUID: vi.fn(() => "test-uuid-1234"),
}));

vi.mock("../../src/lib/logger.js", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ---- helpers to capture registered route handlers ----

const registeredRoutes: Record<string, { handler: Function; preHandler?: Function }> = {};

function createFastifyInstance(): any {
  const register = (method: string) =>
    vi.fn((path: string, opts: any, handler?: Function) => {
      const h = handler ?? opts;
      const pre = handler ? opts?.preHandler : undefined;
      registeredRoutes[`${method.toUpperCase()} ${path}`] = { handler: h, preHandler: pre };
    });

  return {
    get: register("GET"),
    post: register("POST"),
    put: register("PUT"),
    delete: register("DELETE"),
  };
}

function createRequest(overrides: Partial<{
  userId: number;
  body: any;
  params: any;
  query: any;
  headers: Record<string, string>;
  raw: any;
}> = {}): any {
  return {
    userId: overrides.userId ?? 1,
    body: overrides.body ?? {},
    params: overrides.params ?? {},
    query: overrides.query ?? {},
    headers: overrides.headers ?? { authorization: "Bearer token" },
    raw: overrides.raw ?? { on: vi.fn() },
  };
}

function createReply(): any {
  const reply: any = {
    statusCode: 200,
    code: vi.fn(function (this: any, c: number) {
      this.statusCode = c;
      return this;
    }),
    send: vi.fn(function (this: any, b: any) {
      this._body = b;
      return this;
    }),
    raw: {
      writeHead: vi.fn(),
      write: vi.fn(),
      end: vi.fn(),
    },
  };
  return reply;
}

// ---- import and register the plugin ----

let researchPlugin: any;

beforeEach(async () => {
  vi.clearAllMocks();
  for (const key of Object.keys(registeredRoutes)) {
    delete registeredRoutes[key];
  }

  const mod = await import("../../src/routes/research.js");
  researchPlugin = mod.default;
  await researchPlugin(createFastifyInstance());
});

// ---- POST / ----

describe("POST / — start research job", () => {
  it("registers POST / with preHandler auth", () => {
    const route = registeredRoutes["POST /"];
    expect(route).toBeDefined();
    expect(route.preHandler).toBeDefined();
  });

  it("throws 400 when query is missing", async () => {
    const handler = registeredRoutes["POST /"].handler;
    const request = createRequest({ body: {} });
    const reply = createReply();

    await expect(handler(request, reply)).rejects.toThrow("Query is required");
    try {
      await handler(request, reply);
    } catch (err: any) {
      expect(err.statusCode).toBe(400);
      expect(err.code).toBe("RESEARCH_QUERY_REQUIRED");
    }
  });

  it("throws 400 when query is empty string", async () => {
    const handler = registeredRoutes["POST /"].handler;
    const request = createRequest({ body: { query: "   " } });
    const reply = createReply();

    await expect(handler(request, reply)).rejects.toThrow("Query is required");
  });

  it("throws 400 when query is not a string", async () => {
    const handler = registeredRoutes["POST /"].handler;
    const request = createRequest({ body: { query: 123 } });
    const reply = createReply();

    await expect(handler(request, reply)).rejects.toThrow("Query is required");
  });

  it("throws 400 when query exceeds 2000 chars", async () => {
    const handler = registeredRoutes["POST /"].handler;
    const longQuery = "a".repeat(2001);
    const request = createRequest({ body: { query: longQuery } });
    const reply = createReply();

    await expect(handler(request, reply)).rejects.toThrow("Query too long");
    try {
      await handler(request, reply);
    } catch (err: any) {
      expect(err.statusCode).toBe(400);
      expect(err.code).toBe("RESEARCH_QUERY_TOO_LONG");
    }
  });

  it("throws 429 when user already has 2 running jobs", async () => {
    const handler = registeredRoutes["POST /"].handler;
    const request = createRequest({ body: { query: "test query" } });
    const reply = createReply();

    const chain = chainable({
      where: vi.fn(() => [{ value: 2 }]),
    });
    mockDb.select = vi.fn(() => chain);

    await expect(handler(request, reply)).rejects.toThrow("Maximum 2 concurrent research jobs");
    try {
      await handler(request, reply);
    } catch (err: any) {
      expect(err.statusCode).toBe(429);
      expect(err.code).toBe("RESEARCH_LIMIT");
    }
  });

  it("creates a job and returns 201 on success", async () => {
    const handler = registeredRoutes["POST /"].handler;
    const request = createRequest({ body: { query: "  test query  " } });
    const reply = createReply();

    const jobRecord = {
      id: "test-uuid-1234",
      userId: 1,
      query: "test query",
      status: "pending",
    };

    // First call: select count of running jobs
    const countChain = chainable({
      where: vi.fn(() => [{ value: 0 }]),
    });

    // Second call: insert
    const insertChain = chainable({
      returning: vi.fn(() => [jobRecord]),
    });

    let callIndex = 0;
    mockDb.select = vi.fn(() => {
      callIndex++;
      return countChain;
    });
    mockDb.insert = vi.fn(() => insertChain);

    mockRunResearch.mockResolvedValue(undefined);

    const result = await handler(request, reply);

    expect(reply.code).toHaveBeenCalledWith(201);
    expect(result).toEqual({
      id: "test-uuid-1234",
      status: "pending",
      query: "test query",
    });
    expect(mockDb.insert).toHaveBeenCalled();
    expect(mockRunResearch).toHaveBeenCalledWith("test-uuid-1234", 1, "test query");
  });

  it("trims the query before storing", async () => {
    const handler = registeredRoutes["POST /"].handler;
    const request = createRequest({ body: { query: "  trimmed query  " } });
    const reply = createReply();

    const jobRecord = { id: "test-uuid-1234", userId: 1, query: "trimmed query", status: "pending" };

    const countChain = chainable({
      where: vi.fn(() => [{ value: 0 }]),
    });
    const insertChain = chainable({
      returning: vi.fn(() => [jobRecord]),
    });

    mockDb.select = vi.fn(() => countChain);
    mockDb.insert = vi.fn(() => insertChain);
    mockRunResearch.mockResolvedValue(undefined);

    const result = await handler(request, reply);

    expect(result.query).toBe("trimmed query");
  });

  it("does not throw when runResearch fails asynchronously", async () => {
    const handler = registeredRoutes["POST /"].handler;
    const request = createRequest({ body: { query: "test query" } });
    const reply = createReply();

    const jobRecord = { id: "test-uuid-1234", userId: 1, query: "test query", status: "pending" };

    const countChain = chainable({
      where: vi.fn(() => [{ value: 0 }]),
    });
    const insertChain = chainable({
      returning: vi.fn(() => [jobRecord]),
    });

    mockDb.select = vi.fn(() => countChain);
    mockDb.insert = vi.fn(() => insertChain);
    mockRunResearch.mockRejectedValue(new Error("async failure"));

    const result = await handler(request, reply);

    // Should still return successfully since runResearch is fire-and-forget
    expect(result).toEqual({
      id: "test-uuid-1234",
      status: "pending",
      query: "test query",
    });
  });

  it("accepts a query of exactly 2000 chars", async () => {
    const handler = registeredRoutes["POST /"].handler;
    const exactQuery = "a".repeat(2000);
    const request = createRequest({ body: { query: exactQuery } });
    const reply = createReply();

    const jobRecord = { id: "test-uuid-1234", userId: 1, query: exactQuery, status: "pending" };

    const countChain = chainable({
      where: vi.fn(() => [{ value: 0 }]),
    });
    const insertChain = chainable({
      returning: vi.fn(() => [jobRecord]),
    });

    mockDb.select = vi.fn(() => countChain);
    mockDb.insert = vi.fn(() => insertChain);
    mockRunResearch.mockResolvedValue(undefined);

    const result = await handler(request, reply);

    expect(result.status).toBe("pending");
  });
});

// ---- GET / ----

describe("GET / — list research jobs", () => {
  it("registers GET / with preHandler auth", () => {
    const route = registeredRoutes["GET /"];
    expect(route).toBeDefined();
    expect(route.preHandler).toBeDefined();
  });

  it("returns jobs for the authenticated user", async () => {
    const handler = registeredRoutes["GET /"].handler;
    const request = createRequest({ userId: 42 });

    const jobs = [
      { id: "job-1", query: "q1", status: "done", createdAt: new Date(), updatedAt: new Date() },
      { id: "job-2", query: "q2", status: "running", createdAt: new Date(), updatedAt: new Date() },
    ];

    const chain = chainable({
      limit: vi.fn(() => jobs),
    });
    mockDb.select = vi.fn(() => chain);

    const result = await handler(request);

    expect(result).toEqual({ jobs });
    expect(mockDb.select).toHaveBeenCalled();
  });

  it("returns empty array when user has no jobs", async () => {
    const handler = registeredRoutes["GET /"].handler;
    const request = createRequest({ userId: 1 });

    const chain = chainable({
      limit: vi.fn(() => []),
    });
    mockDb.select = vi.fn(() => chain);

    const result = await handler(request);

    expect(result).toEqual({ jobs: [] });
  });
});

// ---- GET /:id ----

describe("GET /:id — get job detail", () => {
  it("registers GET /:id with preHandler auth", () => {
    const route = registeredRoutes["GET /:id"];
    expect(route).toBeDefined();
    expect(route.preHandler).toBeDefined();
  });

  it("returns the job when found", async () => {
    const handler = registeredRoutes["GET /:id"].handler;
    const request = createRequest({ params: { id: "job-abc" }, userId: 1 });

    const job = {
      id: "job-abc",
      userId: 1,
      query: "some query",
      status: "done",
      report: "findings",
      steps: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const chain = chainable({
      limit: vi.fn(() => [job]),
    });
    mockDb.select = vi.fn(() => chain);

    const result = await handler(request);

    expect(result).toEqual(job);
  });

  it("throws 404 when job not found", async () => {
    const handler = registeredRoutes["GET /:id"].handler;
    const request = createRequest({ params: { id: "nonexistent" }, userId: 1 });

    const chain = chainable({
      limit: vi.fn(() => []),
    });
    mockDb.select = vi.fn(() => chain);

    await expect(handler(request)).rejects.toThrow("Research job not found");
    try {
      await handler(request);
    } catch (err: any) {
      expect(err.statusCode).toBe(404);
      expect(err.code).toBe("RESEARCH_NOT_FOUND");
    }
  });
});

// ---- GET /:id/stream ----

describe("GET /:id/stream — SSE streaming", () => {
  it("registers GET /:id/stream with preHandler auth", () => {
    const route = registeredRoutes["GET /:id/stream"];
    expect(route).toBeDefined();
    expect(route.preHandler).toBeDefined();
  });

  it("throws 404 when job not found", async () => {
    const handler = registeredRoutes["GET /:id/stream"].handler;
    const request = createRequest({ params: { id: "nonexistent" }, userId: 1 });
    const reply = createReply();

    const chain = chainable({
      limit: vi.fn(() => []),
    });
    mockDb.select = vi.fn(() => chain);

    await expect(handler(request, reply)).rejects.toThrow("Research job not found");
    try {
      await handler(request, reply);
    } catch (err: any) {
      expect(err.statusCode).toBe(404);
      expect(err.code).toBe("RESEARCH_NOT_FOUND");
    }
  });

  it("sends report immediately when job status is done", async () => {
    const handler = registeredRoutes["GET /:id/stream"].handler;
    const request = createRequest({ params: { id: "job-done" }, userId: 1 });
    const reply = createReply();

    const job = {
      id: "job-done",
      userId: 1,
      query: "query",
      status: "done",
      report: "Final report text",
      steps: [],
    };

    const chain = chainable({
      limit: vi.fn(() => [job]),
    });
    mockDb.select = vi.fn(() => chain);

    await handler(request, reply);

    expect(reply.raw.writeHead).toHaveBeenCalledWith(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const writes = reply.raw.write.mock.calls.map((c: any[]) => c[0]);
    expect(writes[0]).toContain('"type":"report_ready"');
    expect(writes[0]).toContain('"report":"Final report text"');
    expect(writes[1]).toContain('"type":"done"');
    expect(writes[1]).toContain('"jobId":"job-done"');
    expect(reply.raw.end).toHaveBeenCalled();
  });

  it("sends error event when job status is failed", async () => {
    const handler = registeredRoutes["GET /:id/stream"].handler;
    const request = createRequest({ params: { id: "job-fail" }, userId: 1 });
    const reply = createReply();

    const job = {
      id: "job-fail",
      userId: 1,
      query: "query",
      status: "failed",
      report: null,
      steps: [],
    };

    const chain = chainable({
      limit: vi.fn(() => [job]),
    });
    mockDb.select = vi.fn(() => chain);

    await handler(request, reply);

    const writes = reply.raw.write.mock.calls.map((c: any[]) => c[0]);
    expect(writes[0]).toContain('"type":"error"');
    expect(writes[0]).toContain('"message":"Research failed"');
    expect(writes[1]).toContain('"type":"done"');
    expect(reply.raw.end).toHaveBeenCalled();
  });

  it("starts polling for pending/running jobs and registers close handler", async () => {
    vi.useFakeTimers();

    const handler = registeredRoutes["GET /:id/stream"].handler;
    const onClose = vi.fn();
    const request = createRequest({
      params: { id: "job-running" },
      userId: 1,
      raw: { on: onClose },
    });
    const reply = createReply();

    const job = {
      id: "job-running",
      userId: 1,
      query: "query",
      status: "running",
      report: null,
      steps: [],
    };

    const chain = chainable({
      limit: vi.fn(() => [job]),
    });
    mockDb.select = vi.fn(() => chain);

    await handler(request, reply);

    expect(reply.raw.writeHead).toHaveBeenCalledWith(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    // Close handler should be registered on raw request
    expect(onClose).toHaveBeenCalledWith("close", expect.any(Function));

    vi.useRealTimers();
  });

  it("sends step_complete events for new completed steps during polling", async () => {
    vi.useFakeTimers();

    const handler = registeredRoutes["GET /:id/stream"].handler;
    const request = createRequest({
      params: { id: "job-running" },
      userId: 1,
      raw: { on: vi.fn() },
    });
    const reply = createReply();

    const initialJob = {
      id: "job-running",
      userId: 1,
      query: "query",
      status: "running",
      report: null,
      steps: [],
    };

    // First select call returns the initial running job
    const initialChain = chainable({
      limit: vi.fn(() => [initialJob]),
    });
    mockDb.select = vi.fn(() => initialChain);

    await handler(request, reply);

    // Now set up the poll response with a completed step
    const updatedJob = {
      id: "job-running",
      userId: 1,
      query: "query",
      status: "running",
      report: null,
      steps: [{ status: "done", question: "Q1?", answer: "A1" }],
    };

    const pollChain = chainable({
      limit: vi.fn(() => [updatedJob]),
    });
    mockDb.select = vi.fn(() => pollChain);

    await vi.advanceTimersByTimeAsync(2000);

    const writes = reply.raw.write.mock.calls.map((c: any[]) => c[0]);
    const stepWrite = writes.find((w: string) => w.includes("step_complete"));
    expect(stepWrite).toBeDefined();
    expect(stepWrite).toContain('"question":"Q1?"');
    expect(stepWrite).toContain('"answer":"A1"');

    vi.useRealTimers();
  });

  it("sends report_ready and closes when poll detects done status", async () => {
    vi.useFakeTimers();

    const handler = registeredRoutes["GET /:id/stream"].handler;
    const request = createRequest({
      params: { id: "job-running" },
      userId: 1,
      raw: { on: vi.fn() },
    });
    const reply = createReply();

    const initialJob = {
      id: "job-running",
      userId: 1,
      query: "query",
      status: "running",
      report: null,
      steps: [],
    };

    const initialChain = chainable({
      limit: vi.fn(() => [initialJob]),
    });
    mockDb.select = vi.fn(() => initialChain);

    await handler(request, reply);

    // Poll returns completed job
    const doneJob = {
      id: "job-running",
      userId: 1,
      query: "query",
      status: "done",
      report: "Final result",
      steps: [],
    };

    const doneChain = chainable({
      limit: vi.fn(() => [doneJob]),
    });
    mockDb.select = vi.fn(() => doneChain);

    await vi.advanceTimersByTimeAsync(2000);

    const writes = reply.raw.write.mock.calls.map((c: any[]) => c[0]);
    expect(writes.some((w: string) => w.includes('"type":"report_ready"'))).toBe(true);
    expect(writes.some((w: string) => w.includes('"type":"done"'))).toBe(true);
    expect(reply.raw.end).toHaveBeenCalled();

    vi.useRealTimers();
  });

  it("sends error and closes when poll detects failed status", async () => {
    vi.useFakeTimers();

    const handler = registeredRoutes["GET /:id/stream"].handler;
    const request = createRequest({
      params: { id: "job-running" },
      userId: 1,
      raw: { on: vi.fn() },
    });
    const reply = createReply();

    const initialJob = {
      id: "job-running",
      userId: 1,
      query: "query",
      status: "running",
      report: null,
      steps: [],
    };

    const initialChain = chainable({
      limit: vi.fn(() => [initialJob]),
    });
    mockDb.select = vi.fn(() => initialChain);

    await handler(request, reply);

    // Poll returns failed job
    const failedJob = {
      id: "job-running",
      userId: 1,
      query: "query",
      status: "failed",
      report: null,
      steps: [],
    };

    const failChain = chainable({
      limit: vi.fn(() => [failedJob]),
    });
    mockDb.select = vi.fn(() => failChain);

    await vi.advanceTimersByTimeAsync(2000);

    const writes = reply.raw.write.mock.calls.map((c: any[]) => c[0]);
    expect(writes.some((w: string) => w.includes('"type":"error"'))).toBe(true);
    expect(reply.raw.end).toHaveBeenCalled();

    vi.useRealTimers();
  });

  it("ends stream when polled job no longer exists", async () => {
    vi.useFakeTimers();

    const handler = registeredRoutes["GET /:id/stream"].handler;
    const request = createRequest({
      params: { id: "job-running" },
      userId: 1,
      raw: { on: vi.fn() },
    });
    const reply = createReply();

    const initialJob = {
      id: "job-running",
      userId: 1,
      query: "query",
      status: "running",
      report: null,
      steps: [],
    };

    const initialChain = chainable({
      limit: vi.fn(() => [initialJob]),
    });
    mockDb.select = vi.fn(() => initialChain);

    await handler(request, reply);

    // Poll returns no job (deleted)
    const emptyChain = chainable({
      limit: vi.fn(() => []),
    });
    mockDb.select = vi.fn(() => emptyChain);

    await vi.advanceTimersByTimeAsync(2000);

    expect(reply.raw.end).toHaveBeenCalled();

    vi.useRealTimers();
  });
});

// ---- DELETE /:id ----

describe("DELETE /:id — delete research job", () => {
  it("registers DELETE /:id with preHandler auth", () => {
    const route = registeredRoutes["DELETE /:id"];
    expect(route).toBeDefined();
    expect(route.preHandler).toBeDefined();
  });

  it("deletes the job and returns success", async () => {
    const handler = registeredRoutes["DELETE /:id"].handler;
    const request = createRequest({ params: { id: "job-del" }, userId: 1 });

    const job = {
      id: "job-del",
      userId: 1,
      query: "query",
      status: "done",
    };

    // select chain for finding the job
    const selectChain = chainable({
      limit: vi.fn(() => [job]),
    });
    mockDb.select = vi.fn(() => selectChain);

    // delete chain
    const deleteChain = chainable();
    mockDb.delete = vi.fn(() => deleteChain);

    const result = await handler(request);

    expect(result).toEqual({ success: true });
    expect(mockDb.delete).toHaveBeenCalled();
  });

  it("throws 404 when job not found", async () => {
    const handler = registeredRoutes["DELETE /:id"].handler;
    const request = createRequest({ params: { id: "nonexistent" }, userId: 1 });

    const chain = chainable({
      limit: vi.fn(() => []),
    });
    mockDb.select = vi.fn(() => chain);

    await expect(handler(request)).rejects.toThrow("Research job not found");
    try {
      await handler(request);
    } catch (err: any) {
      expect(err.statusCode).toBe(404);
      expect(err.code).toBe("RESEARCH_NOT_FOUND");
    }
  });
});

// ---- route registration ----

describe("route registration", () => {
  it("registers all 5 expected routes", () => {
    expect(registeredRoutes["POST /"]).toBeDefined();
    expect(registeredRoutes["GET /"]).toBeDefined();
    expect(registeredRoutes["GET /:id"]).toBeDefined();
    expect(registeredRoutes["GET /:id/stream"]).toBeDefined();
    expect(registeredRoutes["DELETE /:id"]).toBeDefined();
  });

  it("all routes use fastifyRequireAuth preHandler", () => {
    for (const key of Object.keys(registeredRoutes)) {
      expect(registeredRoutes[key].preHandler).toBeDefined();
    }
  });
});
