import { describe, it, expect, vi, beforeEach } from "vitest";

// Set up chainable db mock
const mockReturning = vi.fn().mockResolvedValue([{ id: 1 }]);
const mockValues = vi.fn().mockReturnValue({ returning: mockReturning });
const mockInsert = vi.fn().mockReturnValue({ values: mockValues });

const mockWhereSelect = vi.fn().mockReturnValue({
  orderBy: vi.fn().mockReturnValue({
    limit: vi.fn().mockReturnValue({
      offset: vi.fn().mockResolvedValue([]),
    }),
    then: vi.fn().mockResolvedValue([]),
  }),
  groupBy: vi.fn().mockResolvedValue([]),
  then: vi.fn().mockResolvedValue([]),
});

const mockWhereDelete = vi.fn().mockResolvedValue(undefined);

const mockFromSelect = vi.fn().mockReturnValue({ where: mockWhereSelect });
const mockSelect = vi.fn().mockReturnValue({ from: mockFromSelect });

const mockDelete = vi.fn().mockReturnValue({
  where: mockWhereDelete,
});

vi.mock("../../src/lib/drizzle.js", () => ({
  db: {
    get select() { return mockSelect; },
    get insert() { return mockInsert; },
    get delete() { return mockDelete; },
  },
}));

vi.mock("../../src/db/schema/workflowRunLogs.js", () => ({
  workflowRunLogs: {
    id: "id",
    runId: "runId",
    workflowId: "workflowId",
    userId: "userId",
    createdAt: "createdAt",
    durationMs: "durationMs",
    eventType: "eventType",
    nodeId: "nodeId",
    nodeType: "nodeType",
  },
}));

vi.mock("../../src/db/schema/workflows.js", () => ({
  workflowRuns: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a, b) => ({ eq: true, a, b })),
  and: vi.fn((...args) => ({ and: true, args })),
  desc: vi.fn((col) => ({ desc: true, col })),
  sql: vi.fn().mockReturnValue("sql"),
}));

const registeredRoutes: Record<string, { handler: Function }> = {};
function createFastifyInstance(): any {
  const register = (method: string) =>
    vi.fn((path: string, opts: any, handler?: Function) => {
      registeredRoutes[`${method.toUpperCase()} ${path}`] = {
        handler: handler ?? opts,
      };
    });
  return {
    get: register("GET"),
    post: register("POST"),
    put: register("PUT"),
    delete: register("DELETE"),
    patch: register("PATCH"),
    addHook: vi.fn(),
    addContentTypeParser: vi.fn(),
    register: vi.fn(),
  };
}
function makeReq(overrides = {}): any {
  return {
    userId: 1,
    role: "member",
    body: {},
    params: {},
    query: {},
    headers: {},
    ...overrides,
  };
}
function makeReply(): any {
  const r: any = {};
  r.code = vi.fn(() => r);
  r.send = vi.fn(() => r);
  r.header = vi.fn(() => r);
  r.status = vi.fn().mockImplementation((code: number) => { r._status = code; return r; });
  return r;
}

import { workflowRunLogsPlugin } from "../../src/routes/workflow-run-logs.js";

describe("workflow-run-logs routes", () => {
  let fastify: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    Object.keys(registeredRoutes).forEach((k) => delete registeredRoutes[k]);
    fastify = createFastifyInstance();

    // Reset insert mock
    mockReturning.mockResolvedValue([{ id: 1 }]);
    mockValues.mockReturnValue({ returning: mockReturning });
    mockInsert.mockReturnValue({ values: mockValues });

    // Reset select mock for chaining
    mockWhereSelect.mockReturnValue({
      orderBy: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({
          offset: vi.fn().mockResolvedValue([]),
        }),
        then: (_res: any) => Promise.resolve([]),
      }),
      groupBy: vi.fn().mockResolvedValue([]),
    });
    mockFromSelect.mockReturnValue({ where: mockWhereSelect });
    mockSelect.mockReturnValue({ from: mockFromSelect });

    await workflowRunLogsPlugin(fastify);
  });

  describe("POST /workflow-logs", () => {
    it("registers the route", () => {
      expect(registeredRoutes["POST /workflow-logs"]).toBeDefined();
    });

    it("inserts a valid log entry and returns 201", async () => {
      const handler = registeredRoutes["POST /workflow-logs"].handler;
      const req = makeReq({
        userId: 1,
        body: {
          runId: "run-1",
          workflowId: "wf-1",
          eventType: "node_start",
        },
      });
      const reply = makeReply();

      await handler(req, reply);

      expect(reply.status).toHaveBeenCalledWith(201);
      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({ success: true })
      );
    });

    it("returns 401 when no userId", async () => {
      const handler = registeredRoutes["POST /workflow-logs"].handler;
      const req = makeReq({ userId: undefined, body: {} });
      const reply = makeReply();

      await handler(req, reply);

      expect(reply.status).toHaveBeenCalledWith(401);
    });

    it("returns 400 for invalid eventType", async () => {
      const handler = registeredRoutes["POST /workflow-logs"].handler;
      const req = makeReq({
        userId: 1,
        body: {
          runId: "run-1",
          workflowId: "wf-1",
          eventType: "invalid_event",
        },
      });
      const reply = makeReply();

      await handler(req, reply);

      expect(reply.status).toHaveBeenCalledWith(400);
    });

    it("returns 400 when runId is missing", async () => {
      const handler = registeredRoutes["POST /workflow-logs"].handler;
      const req = makeReq({
        userId: 1,
        body: { workflowId: "wf-1", eventType: "node_start" },
      });
      const reply = makeReply();

      await handler(req, reply);

      expect(reply.status).toHaveBeenCalledWith(400);
    });

    it("inserts with all optional fields", async () => {
      const handler = registeredRoutes["POST /workflow-logs"].handler;
      const req = makeReq({
        userId: 1,
        body: {
          runId: "run-1",
          workflowId: "wf-1",
          nodeId: "node-a",
          nodeType: "llm",
          eventType: "node_complete",
          status: "success",
          message: "Node completed",
          durationMs: 250,
          data: { output: "result" },
        },
      });
      const reply = makeReply();

      await handler(req, reply);

      expect(mockInsert).toHaveBeenCalled();
      expect(reply.status).toHaveBeenCalledWith(201);
    });
  });

  describe("POST /workflow-logs/batch", () => {
    it("registers the route", () => {
      expect(registeredRoutes["POST /workflow-logs/batch"]).toBeDefined();
    });

    it("inserts batch of log entries and returns count", async () => {
      mockReturning.mockResolvedValue([{ id: 1 }, { id: 2 }]);
      const handler = registeredRoutes["POST /workflow-logs/batch"].handler;
      const req = makeReq({
        userId: 1,
        body: {
          entries: [
            { runId: "run-1", workflowId: "wf-1", eventType: "node_start" },
            { runId: "run-1", workflowId: "wf-1", eventType: "node_complete" },
          ],
        },
      });
      const reply = makeReply();

      await handler(req, reply);

      expect(reply.status).toHaveBeenCalledWith(201);
      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, count: 2 })
      );
    });

    it("returns 401 when no userId", async () => {
      const handler = registeredRoutes["POST /workflow-logs/batch"].handler;
      const req = makeReq({ userId: undefined, body: {} });
      const reply = makeReply();

      await handler(req, reply);

      expect(reply.status).toHaveBeenCalledWith(401);
    });

    it("returns 400 when entries is empty", async () => {
      const handler = registeredRoutes["POST /workflow-logs/batch"].handler;
      const req = makeReq({ userId: 1, body: { entries: [] } });
      const reply = makeReply();

      await handler(req, reply);

      expect(reply.status).toHaveBeenCalledWith(400);
    });

    it("returns 400 when entries is missing", async () => {
      const handler = registeredRoutes["POST /workflow-logs/batch"].handler;
      const req = makeReq({ userId: 1, body: {} });
      const reply = makeReply();

      await handler(req, reply);

      expect(reply.status).toHaveBeenCalledWith(400);
    });
  });

  describe("GET /workflow-logs/run/:runId", () => {
    it("registers the route", () => {
      expect(registeredRoutes["GET /workflow-logs/run/:runId"]).toBeDefined();
    });

    it("returns log entries for a run", async () => {
      mockWhereSelect.mockReturnValue({
        orderBy: vi.fn().mockResolvedValue([
          { id: 1, runId: "run-1", eventType: "node_start" },
        ]),
      });
      const handler = registeredRoutes["GET /workflow-logs/run/:runId"].handler;
      const req = makeReq({ userId: 1, params: { runId: "run-1" } });
      const reply = makeReply();

      const result = await handler(req, reply);

      expect(result).toHaveProperty("success", true);
      expect(result).toHaveProperty("runId", "run-1");
      expect(result).toHaveProperty("entries");
    });

    it("returns 401 when no userId", async () => {
      const handler = registeredRoutes["GET /workflow-logs/run/:runId"].handler;
      const req = makeReq({ userId: undefined, params: { runId: "run-1" } });
      const reply = makeReply();

      await handler(req, reply);

      expect(reply.status).toHaveBeenCalledWith(401);
    });

    it("returns empty entries for unknown runId", async () => {
      mockWhereSelect.mockReturnValue({
        orderBy: vi.fn().mockResolvedValue([]),
      });
      const handler = registeredRoutes["GET /workflow-logs/run/:runId"].handler;
      const req = makeReq({ userId: 1, params: { runId: "unknown-run" } });
      const reply = makeReply();

      const result = await handler(req, reply);

      expect(result.entries).toHaveLength(0);
      expect(result.count).toBe(0);
    });
  });

  describe("GET /workflow-logs/workflow/:workflowId", () => {
    it("registers the route", () => {
      expect(registeredRoutes["GET /workflow-logs/workflow/:workflowId"]).toBeDefined();
    });

    it("returns log entries for a workflow", async () => {
      mockWhereSelect.mockReturnValue({
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            offset: vi.fn().mockResolvedValue([]),
          }),
        }),
      });
      const handler = registeredRoutes["GET /workflow-logs/workflow/:workflowId"].handler;
      const req = makeReq({ userId: 1, params: { workflowId: "wf-1" }, query: {} });
      const reply = makeReply();

      const result = await handler(req, reply);

      expect(result).toHaveProperty("success", true);
      expect(result).toHaveProperty("workflowId", "wf-1");
    });

    it("returns 401 when no userId", async () => {
      const handler = registeredRoutes["GET /workflow-logs/workflow/:workflowId"].handler;
      const req = makeReq({ userId: undefined, params: { workflowId: "wf-1" } });
      const reply = makeReply();

      await handler(req, reply);

      expect(reply.status).toHaveBeenCalledWith(401);
    });
  });

  describe("GET /workflow-logs/stats/:workflowId", () => {
    it("registers the route", () => {
      expect(registeredRoutes["GET /workflow-logs/stats/:workflowId"]).toBeDefined();
    });

    it("returns stats for a workflow", async () => {
      // First select (nodeStats): select -> from -> where -> groupBy -> []
      mockWhereSelect
        .mockReturnValueOnce({
          groupBy: vi.fn().mockResolvedValue([]),
        })
        // Second select (totalRuns): select -> from -> where -> await [{ count: 0 }]
        .mockResolvedValueOnce([{ count: 0 }]);
      const handler = registeredRoutes["GET /workflow-logs/stats/:workflowId"].handler;
      const req = makeReq({ userId: 1, params: { workflowId: "wf-1" } });
      const reply = makeReply();

      const result = await handler(req, reply);

      expect(result).toHaveProperty("success", true);
      expect(result).toHaveProperty("workflowId", "wf-1");
      expect(result).toHaveProperty("nodeStats");
    });

    it("returns 401 when no userId", async () => {
      const handler = registeredRoutes["GET /workflow-logs/stats/:workflowId"].handler;
      const req = makeReq({ userId: undefined, params: { workflowId: "wf-1" } });
      const reply = makeReply();

      await handler(req, reply);

      expect(reply.status).toHaveBeenCalledWith(401);
    });
  });

  describe("DELETE /workflow-logs/run/:runId", () => {
    it("registers the route", () => {
      expect(registeredRoutes["DELETE /workflow-logs/run/:runId"]).toBeDefined();
    });

    it("deletes logs for a run and returns success", async () => {
      const handler = registeredRoutes["DELETE /workflow-logs/run/:runId"].handler;
      const req = makeReq({ userId: 1, params: { runId: "run-1" } });
      const reply = makeReply();

      const result = await handler(req, reply);

      expect(result).toHaveProperty("success", true);
      expect(mockDelete).toHaveBeenCalled();
    });

    it("returns 401 when no userId", async () => {
      const handler = registeredRoutes["DELETE /workflow-logs/run/:runId"].handler;
      const req = makeReq({ userId: undefined, params: { runId: "run-1" } });
      const reply = makeReply();

      await handler(req, reply);

      expect(reply.status).toHaveBeenCalledWith(401);
    });
  });
});
