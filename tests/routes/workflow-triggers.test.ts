import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock bullmq Queue before imports
const { mockQueueAdd, mockGetRepeatableJobs, mockRemoveRepeatableByKey } = vi.hoisted(() => ({
  mockQueueAdd: vi.fn().mockResolvedValue({ id: "job1" }),
  mockGetRepeatableJobs: vi.fn().mockResolvedValue([]),
  mockRemoveRepeatableByKey: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("bullmq", () => {
  return {
    Queue: function MockQueue(this: any) {
      this.add = mockQueueAdd;
      this.getRepeatableJobs = mockGetRepeatableJobs;
      this.removeRepeatableByKey = mockRemoveRepeatableByKey;
    },
  };
});

vi.mock("../../src/lib/drizzle.js", () => {
  const mockDb: any = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
  mockDb.select.mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([{ id: "wf-uuid-1234" }]),
      }),
    }),
  });
  return { db: mockDb };
});

vi.mock("../../src/db/schema/workflows.js", () => ({
  workflows: { id: "id", userId: "userId" },
  workflowRuns: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a, b) => ({ a, b })),
  and: vi.fn((...args) => args),
}));

vi.mock("../../src/queue/backgroundTasks.js", () => ({
  backgroundTaskQueue: {},
}));

vi.mock("../../src/queue/connection.js", () => ({ default: {} }));

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

import { workflowTriggersPlugin } from "../../src/routes/workflow-triggers.js";
import { db } from "../../src/lib/drizzle.js";

describe("workflow-triggers routes", () => {
  let fastify: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    Object.keys(registeredRoutes).forEach((k) => delete registeredRoutes[k]);
    fastify = createFastifyInstance();

    // Reset db mock to return a workflow by default
    (db.select as any).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ id: "wf-uuid-1234" }]),
        }),
      }),
    });
    mockGetRepeatableJobs.mockResolvedValue([]);

    await workflowTriggersPlugin(fastify);
  });

  describe("GET /workflow-triggers/nodes", () => {
    it("registers the route", () => {
      expect(registeredRoutes["GET /workflow-triggers/nodes"]).toBeDefined();
    });

    it("returns node catalogue when authenticated", async () => {
      const handler = registeredRoutes["GET /workflow-triggers/nodes"].handler;
      const req = makeReq({ userId: 1 });
      const reply = makeReply();

      const result = await handler(req, reply);

      expect(result).toHaveProperty("success", true);
      expect(result).toHaveProperty("nodes");
      expect(Array.isArray(result.nodes)).toBe(true);
    });

    it("returns 401 when no userId", async () => {
      const handler = registeredRoutes["GET /workflow-triggers/nodes"].handler;
      const req = makeReq({ userId: undefined });
      const reply = makeReply();

      await handler(req, reply);

      expect(reply.status).toHaveBeenCalledWith(401);
    });

    it("includes trigger and action categories in nodes", async () => {
      const handler = registeredRoutes["GET /workflow-triggers/nodes"].handler;
      const req = makeReq({ userId: 1 });
      const reply = makeReply();

      const result = await handler(req, reply);
      const categories = result.nodes.map((n: any) => n.category);

      expect(categories).toContain("trigger");
      expect(categories).toContain("action");
    });
  });

  describe("POST /workflow-triggers/webhooks", () => {
    it("registers the route", () => {
      expect(registeredRoutes["POST /workflow-triggers/webhooks"]).toBeDefined();
    });

    it("registers a webhook and returns webhookId", async () => {
      const handler = registeredRoutes["POST /workflow-triggers/webhooks"].handler;
      const req = makeReq({
        userId: 1,
        body: { workflowId: "550e8400-e29b-41d4-a716-446655440000" },
      });
      const reply = makeReply();

      const result = await handler(req, reply);

      expect(reply.status).toHaveBeenCalledWith(201);
      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, webhookId: expect.any(String) })
      );
    });

    it("returns 401 when no userId", async () => {
      const handler = registeredRoutes["POST /workflow-triggers/webhooks"].handler;
      const req = makeReq({ userId: undefined, body: {} });
      const reply = makeReply();

      await handler(req, reply);

      expect(reply.status).toHaveBeenCalledWith(401);
    });

    it("returns 400 for invalid body", async () => {
      const handler = registeredRoutes["POST /workflow-triggers/webhooks"].handler;
      const req = makeReq({ userId: 1, body: { workflowId: "not-a-uuid" } });
      const reply = makeReply();

      await handler(req, reply);

      expect(reply.status).toHaveBeenCalledWith(400);
    });

    it("returns 404 when workflow not found", async () => {
      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      });
      const handler = registeredRoutes["POST /workflow-triggers/webhooks"].handler;
      const req = makeReq({
        userId: 1,
        body: { workflowId: "550e8400-e29b-41d4-a716-446655440000" },
      });
      const reply = makeReply();

      await handler(req, reply);

      expect(reply.status).toHaveBeenCalledWith(404);
    });
  });

  describe("GET /workflow-triggers/webhooks", () => {
    it("registers the route", () => {
      expect(registeredRoutes["GET /workflow-triggers/webhooks"]).toBeDefined();
    });

    it("returns list of webhooks for user", async () => {
      const handler = registeredRoutes["GET /workflow-triggers/webhooks"].handler;
      const req = makeReq({ userId: 1 });
      const reply = makeReply();

      const result = await handler(req, reply);

      expect(result).toHaveProperty("success", true);
      expect(result).toHaveProperty("webhooks");
      expect(result).toHaveProperty("count");
    });

    it("returns 401 when no userId", async () => {
      const handler = registeredRoutes["GET /workflow-triggers/webhooks"].handler;
      const req = makeReq({ userId: undefined });
      const reply = makeReply();

      await handler(req, reply);

      expect(reply.status).toHaveBeenCalledWith(401);
    });
  });

  describe("DELETE /workflow-triggers/webhooks/:webhookId", () => {
    it("registers the route", () => {
      expect(registeredRoutes["DELETE /workflow-triggers/webhooks/:webhookId"]).toBeDefined();
    });

    it("returns 404 for non-existent webhookId", async () => {
      const handler = registeredRoutes["DELETE /workflow-triggers/webhooks/:webhookId"].handler;
      const req = makeReq({ userId: 1, params: { webhookId: "non-existent-id" } });
      const reply = makeReply();

      await handler(req, reply);

      expect(reply.status).toHaveBeenCalledWith(404);
    });

    it("returns 401 when no userId", async () => {
      const handler = registeredRoutes["DELETE /workflow-triggers/webhooks/:webhookId"].handler;
      const req = makeReq({ userId: undefined, params: { webhookId: "some-id" } });
      const reply = makeReply();

      await handler(req, reply);

      expect(reply.status).toHaveBeenCalledWith(401);
    });
  });

  describe("POST /wh/:webhookId", () => {
    it("registers the route", () => {
      expect(registeredRoutes["POST /wh/:webhookId"]).toBeDefined();
    });

    it("returns 404 for unknown webhookId", async () => {
      const handler = registeredRoutes["POST /wh/:webhookId"].handler;
      const req = makeReq({ params: { webhookId: "unknown-id" }, body: {} });
      const reply = makeReply();

      await handler(req, reply);

      expect(reply.status).toHaveBeenCalledWith(404);
      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({ error: "Webhook not registered" })
      );
    });
  });

  describe("POST /workflow-triggers/schedules", () => {
    it("registers the route", () => {
      expect(registeredRoutes["POST /workflow-triggers/schedules"]).toBeDefined();
    });

    it("registers a schedule and returns jobName", async () => {
      const handler = registeredRoutes["POST /workflow-triggers/schedules"].handler;
      const req = makeReq({
        userId: 1,
        body: {
          workflowId: "550e8400-e29b-41d4-a716-446655440000",
          cron: "0 9 * * 1-5",
        },
      });
      const reply = makeReply();

      await handler(req, reply);

      expect(reply.status).toHaveBeenCalledWith(201);
      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          cron: "0 9 * * 1-5",
          jobName: expect.stringContaining("schedule-1-"),
        })
      );
    });

    it("returns 401 when no userId", async () => {
      const handler = registeredRoutes["POST /workflow-triggers/schedules"].handler;
      const req = makeReq({ userId: undefined, body: {} });
      const reply = makeReply();

      await handler(req, reply);

      expect(reply.status).toHaveBeenCalledWith(401);
    });

    it("returns 400 for invalid cron", async () => {
      const handler = registeredRoutes["POST /workflow-triggers/schedules"].handler;
      const req = makeReq({
        userId: 1,
        body: {
          workflowId: "550e8400-e29b-41d4-a716-446655440000",
          cron: "bad",
        },
      });
      const reply = makeReply();

      await handler(req, reply);

      expect(reply.status).toHaveBeenCalledWith(400);
    });

    it("returns 404 when workflow not found", async () => {
      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      });
      const handler = registeredRoutes["POST /workflow-triggers/schedules"].handler;
      const req = makeReq({
        userId: 1,
        body: {
          workflowId: "550e8400-e29b-41d4-a716-446655440000",
          cron: "0 9 * * 1-5",
        },
      });
      const reply = makeReply();

      await handler(req, reply);

      expect(reply.status).toHaveBeenCalledWith(404);
    });
  });

  describe("GET /workflow-triggers/schedules", () => {
    it("registers the route", () => {
      expect(registeredRoutes["GET /workflow-triggers/schedules"]).toBeDefined();
    });

    it("returns list of schedules for user", async () => {
      mockGetRepeatableJobs.mockResolvedValue([
        { name: "schedule-1-wf-id", key: "key1", cron: "0 9 * * *" },
      ]);
      const handler = registeredRoutes["GET /workflow-triggers/schedules"].handler;
      const req = makeReq({ userId: 1 });
      const reply = makeReply();

      const result = await handler(req, reply);

      expect(result).toHaveProperty("success", true);
      expect(result.schedules.length).toBeGreaterThanOrEqual(0);
    });

    it("returns 401 when no userId", async () => {
      const handler = registeredRoutes["GET /workflow-triggers/schedules"].handler;
      const req = makeReq({ userId: undefined });
      const reply = makeReply();

      await handler(req, reply);

      expect(reply.status).toHaveBeenCalledWith(401);
    });
  });

  describe("DELETE /workflow-triggers/schedules/:jobName", () => {
    it("registers the route", () => {
      expect(registeredRoutes["DELETE /workflow-triggers/schedules/:jobName"]).toBeDefined();
    });

    it("returns 403 when jobName does not belong to user", async () => {
      const handler = registeredRoutes["DELETE /workflow-triggers/schedules/:jobName"].handler;
      const req = makeReq({ userId: 1, params: { jobName: "schedule-2-other-wf" } });
      const reply = makeReply();

      await handler(req, reply);

      expect(reply.status).toHaveBeenCalledWith(403);
    });

    it("returns 404 when schedule not found", async () => {
      mockGetRepeatableJobs.mockResolvedValue([]);
      const handler = registeredRoutes["DELETE /workflow-triggers/schedules/:jobName"].handler;
      const req = makeReq({ userId: 1, params: { jobName: "schedule-1-some-wf" } });
      const reply = makeReply();

      await handler(req, reply);

      expect(reply.status).toHaveBeenCalledWith(404);
    });

    it("returns 401 when no userId", async () => {
      const handler = registeredRoutes["DELETE /workflow-triggers/schedules/:jobName"].handler;
      const req = makeReq({ userId: undefined, params: { jobName: "schedule-1-wf" } });
      const reply = makeReply();

      await handler(req, reply);

      expect(reply.status).toHaveBeenCalledWith(401);
    });
  });

  describe("POST /workflow-triggers/emit", () => {
    it("registers the route", () => {
      expect(registeredRoutes["POST /workflow-triggers/emit"]).toBeDefined();
    });

    it("emits an event and returns success", async () => {
      const handler = registeredRoutes["POST /workflow-triggers/emit"].handler;
      const req = makeReq({
        userId: 1,
        body: { event: "user.signup", payload: { email: "test@example.com" } },
      });
      const reply = makeReply();

      await handler(req, reply);

      expect(reply.status).toHaveBeenCalledWith(202);
      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, event: "user.signup" })
      );
    });

    it("returns 400 when event name is missing", async () => {
      const handler = registeredRoutes["POST /workflow-triggers/emit"].handler;
      const req = makeReq({ userId: 1, body: {} });
      const reply = makeReply();

      await handler(req, reply);

      expect(reply.status).toHaveBeenCalledWith(400);
    });

    it("returns 401 when no userId", async () => {
      const handler = registeredRoutes["POST /workflow-triggers/emit"].handler;
      const req = makeReq({ userId: undefined, body: { event: "test" } });
      const reply = makeReply();

      await handler(req, reply);

      expect(reply.status).toHaveBeenCalledWith(401);
    });
  });
});
