import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock all external dependencies at top level
vi.mock("../../src/config/env.js", () => ({
  env: {
    SLACK_SIGNING_SECRET: undefined,
    CONFLUENCE_WEBHOOK_TOKEN: undefined,
    GITHUB_WEBHOOK_SECRET: undefined,
    NOTION_WEBHOOK_TOKEN: undefined,
    GOOGLE_DRIVE_WEBHOOK_TOKEN: undefined,
  },
}));

vi.mock("../../src/services/webhookIngestion.service.js", () => ({
  processWebhookEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/lib/logger.js", () => ({
  default: {
    child: () => ({
      warn: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
    }),
  },
}));

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return {
    ...actual,
    createHmac: actual.createHmac,
    timingSafeEqual: actual.timingSafeEqual,
  };
});

// Helper to capture Fastify route handlers
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
    patch: register("PATCH"),
    addHook: vi.fn(),
    addContentTypeParser: vi.fn(),
    register: vi.fn(),
  };
}

// Mock request/reply helpers
function makeReq(overrides = {}): any {
  return { userId: 1, role: "member", body: {}, params: {}, query: {}, headers: {}, ...overrides };
}
function makeReply(): any {
  const r: any = { _code: 200, _body: undefined };
  r.code = vi.fn((c: number) => { r._code = c; return r; });
  r.send = vi.fn((b?: any) => { r._body = b; return r; });
  r.header = vi.fn(() => r);
  return r;
}

describe("webhooks routes", () => {
  let fastify: any;
  let processWebhookEvent: any;
  let envModule: any;

  beforeEach(async () => {
    for (const key of Object.keys(registeredRoutes)) {
      delete registeredRoutes[key];
    }
    vi.clearAllMocks();

    fastify = createFastifyInstance();

    const svc = await import("../../src/services/webhookIngestion.service.js");
    processWebhookEvent = svc.processWebhookEvent as any;

    envModule = await import("../../src/config/env.js");
    // Reset all secrets to undefined by default
    envModule.env.SLACK_SIGNING_SECRET = undefined;
    envModule.env.CONFLUENCE_WEBHOOK_TOKEN = undefined;
    envModule.env.GITHUB_WEBHOOK_SECRET = undefined;
    envModule.env.NOTION_WEBHOOK_TOKEN = undefined;
    envModule.env.GOOGLE_DRIVE_WEBHOOK_TOKEN = undefined;

    const { default: webhooksPlugin } = await import("../../src/routes/webhooks.js");
    await webhooksPlugin(fastify, {});
  });

  describe("registration", () => {
    it("registers addContentTypeParser for application/json", () => {
      expect(fastify.addContentTypeParser).toHaveBeenCalledWith(
        "application/json",
        expect.objectContaining({ parseAs: "buffer" }),
        expect.any(Function),
      );
    });

    it("registers POST /slack/events", () => {
      expect(registeredRoutes["POST /slack/events"]).toBeDefined();
    });

    it("registers POST /confluence", () => {
      expect(registeredRoutes["POST /confluence"]).toBeDefined();
    });

    it("registers POST /github", () => {
      expect(registeredRoutes["POST /github"]).toBeDefined();
    });

    it("registers POST /notion", () => {
      expect(registeredRoutes["POST /notion"]).toBeDefined();
    });

    it("registers POST /google-drive", () => {
      expect(registeredRoutes["POST /google-drive"]).toBeDefined();
    });
  });

  describe("POST /slack/events", () => {
    it("returns 200 with ok: true for a valid event_callback payload (no secret configured)", async () => {
      const { handler } = registeredRoutes["POST /slack/events"];
      const payload = {
        type: "event_callback",
        event: { type: "message", channel: "C123", ts: "1234567890.123" },
      };
      const req = makeReq({
        body: Buffer.from(JSON.stringify(payload)),
        headers: {},
      });
      const reply = makeReply();
      await handler(req, reply);
      expect(reply.code).toHaveBeenCalledWith(200);
      expect(reply.send).toHaveBeenCalledWith({ ok: true });
    });

    it("handles Slack URL verification challenge", async () => {
      const { handler } = registeredRoutes["POST /slack/events"];
      const payload = { type: "url_verification", challenge: "my-challenge-token" };
      const req = makeReq({
        body: Buffer.from(JSON.stringify(payload)),
        headers: {},
      });
      const reply = makeReply();
      const result = await handler(req, reply);
      expect(result).toEqual({ challenge: "my-challenge-token" });
    });

    it("returns 400 for invalid JSON body", async () => {
      const { handler } = registeredRoutes["POST /slack/events"];
      const req = makeReq({
        body: Buffer.from("not-valid-json{{{"),
        headers: {},
      });
      const reply = makeReply();
      await handler(req, reply);
      expect(reply.code).toHaveBeenCalledWith(400);
      expect(reply.send).toHaveBeenCalledWith({ error: "Invalid JSON" });
    });

    it("returns 401 when signing secret is set and signature is invalid", async () => {
      envModule.env.SLACK_SIGNING_SECRET = "my-secret";
      const { handler } = registeredRoutes["POST /slack/events"];
      const payload = { type: "event_callback", event: { type: "message" } };
      // Use a timestamp far in the future to bypass replay check, but wrong signature
      const req = makeReq({
        body: Buffer.from(JSON.stringify(payload)),
        headers: {
          "x-slack-request-timestamp": String(Math.floor(Date.now() / 1000)),
          "x-slack-signature": "v0=invalidsignature",
        },
      });
      const reply = makeReply();
      await handler(req, reply);
      expect(reply.code).toHaveBeenCalledWith(401);
      expect(reply.send).toHaveBeenCalledWith({ error: "Invalid signature" });
    });

    it("enqueues a processWebhookEvent for event_callback", async () => {
      const { handler } = registeredRoutes["POST /slack/events"];
      const payload = {
        type: "event_callback",
        event: { type: "message", channel: "C999", ts: "111.222" },
      };
      const req = makeReq({
        body: Buffer.from(JSON.stringify(payload)),
        headers: {},
      });
      const reply = makeReply();
      await handler(req, reply);
      // processWebhookEvent is fire-and-forget so wait for next tick
      await Promise.resolve();
      expect(processWebhookEvent).toHaveBeenCalledWith("slack", expect.objectContaining({ source: "slack" }));
    });
  });

  describe("POST /confluence", () => {
    it("returns 200 with ok: true for a valid payload (no token configured)", async () => {
      const { handler } = registeredRoutes["POST /confluence"];
      const payload = { event: "page_updated", page: { id: "pg-1", self: "http://conf/pg-1" } };
      const req = makeReq({
        body: Buffer.from(JSON.stringify(payload)),
        headers: {},
      });
      const reply = makeReply();
      await handler(req, reply);
      expect(reply.code).toHaveBeenCalledWith(200);
      expect(reply.send).toHaveBeenCalledWith({ ok: true });
    });

    it("returns 400 for invalid JSON body", async () => {
      const { handler } = registeredRoutes["POST /confluence"];
      const req = makeReq({
        body: Buffer.from("bad-json!!!"),
        headers: {},
      });
      const reply = makeReply();
      await handler(req, reply);
      expect(reply.code).toHaveBeenCalledWith(400);
      expect(reply.send).toHaveBeenCalledWith({ error: "Invalid JSON" });
    });

    it("returns 401 when token is set and wrong token provided", async () => {
      envModule.env.CONFLUENCE_WEBHOOK_TOKEN = "correct-token";
      const { handler } = registeredRoutes["POST /confluence"];
      const payload = { event: "page_updated" };
      const req = makeReq({
        body: Buffer.from(JSON.stringify(payload)),
        headers: { "x-confluence-webhook-token": "wrong-token-xyz" },
      });
      const reply = makeReply();
      await handler(req, reply);
      expect(reply.code).toHaveBeenCalledWith(401);
      expect(reply.send).toHaveBeenCalledWith({ error: "Invalid token" });
    });

    it("accepts Bearer token in Authorization header", async () => {
      envModule.env.CONFLUENCE_WEBHOOK_TOKEN = "secret123";
      const { handler } = registeredRoutes["POST /confluence"];
      const payload = { event: "page_updated", page: { id: "pg-2" } };
      const req = makeReq({
        body: Buffer.from(JSON.stringify(payload)),
        headers: { authorization: "Bearer secret123" },
      });
      const reply = makeReply();
      await handler(req, reply);
      expect(reply.code).toHaveBeenCalledWith(200);
    });
  });

  describe("POST /github", () => {
    it("returns 200 with ok: true for a valid push event (no secret configured)", async () => {
      const { handler } = registeredRoutes["POST /github"];
      const payload = {
        ref: "refs/heads/main",
        repository: { full_name: "org/repo" },
      };
      const req = makeReq({
        body: Buffer.from(JSON.stringify(payload)),
        headers: { "x-github-event": "push" },
      });
      const reply = makeReply();
      await handler(req, reply);
      expect(reply.code).toHaveBeenCalledWith(200);
      expect(reply.send).toHaveBeenCalledWith({ ok: true });
    });

    it("returns 400 for invalid JSON body", async () => {
      const { handler } = registeredRoutes["POST /github"];
      const req = makeReq({
        body: Buffer.from("{invalid"),
        headers: { "x-github-event": "push" },
      });
      const reply = makeReply();
      await handler(req, reply);
      expect(reply.code).toHaveBeenCalledWith(400);
      expect(reply.send).toHaveBeenCalledWith({ error: "Invalid JSON" });
    });

    it("returns 401 when secret is set and signature is missing", async () => {
      envModule.env.GITHUB_WEBHOOK_SECRET = "gh-secret";
      const { handler } = registeredRoutes["POST /github"];
      const payload = { repository: { full_name: "org/repo" } };
      const req = makeReq({
        body: Buffer.from(JSON.stringify(payload)),
        headers: { "x-github-event": "push" },
      });
      const reply = makeReply();
      await handler(req, reply);
      expect(reply.code).toHaveBeenCalledWith(401);
    });
  });

  describe("POST /notion", () => {
    it("returns 200 with ok: true for a valid payload (no token configured)", async () => {
      const { handler } = registeredRoutes["POST /notion"];
      const payload = { type: "page.updated", entity: { id: "page-id-1" } };
      const req = makeReq({
        body: Buffer.from(JSON.stringify(payload)),
        headers: {},
      });
      const reply = makeReply();
      await handler(req, reply);
      expect(reply.code).toHaveBeenCalledWith(200);
      expect(reply.send).toHaveBeenCalledWith({ ok: true });
    });

    it("returns 400 for invalid JSON body", async () => {
      const { handler } = registeredRoutes["POST /notion"];
      const req = makeReq({
        body: Buffer.from("not json"),
        headers: {},
      });
      const reply = makeReply();
      await handler(req, reply);
      expect(reply.code).toHaveBeenCalledWith(400);
      expect(reply.send).toHaveBeenCalledWith({ error: "Invalid JSON" });
    });

    it("returns 401 when token is set and wrong authorization provided", async () => {
      envModule.env.NOTION_WEBHOOK_TOKEN = "notion-secret";
      const { handler } = registeredRoutes["POST /notion"];
      const payload = { type: "page.updated", entity: { id: "page-1" } };
      const req = makeReq({
        body: Buffer.from(JSON.stringify(payload)),
        headers: { authorization: "Bearer wrong-token" },
      });
      const reply = makeReply();
      await handler(req, reply);
      expect(reply.code).toHaveBeenCalledWith(401);
      expect(reply.send).toHaveBeenCalledWith({ error: "Invalid token" });
    });
  });

  describe("POST /google-drive", () => {
    it("returns 200 for a valid push notification (no token configured)", async () => {
      const { handler } = registeredRoutes["POST /google-drive"];
      const req = makeReq({
        body: Buffer.from(""),
        headers: {
          "x-goog-resource-id": "resource-123",
          "x-goog-resource-state": "change",
          "x-goog-resource-uri": "https://www.googleapis.com/drive/v3/files/file-abc",
        },
      });
      const reply = makeReply();
      await handler(req, reply);
      expect(reply.code).toHaveBeenCalledWith(200);
      expect(reply.send).toHaveBeenCalled();
    });

    it("extracts file ID from resource URI", async () => {
      const { handler } = registeredRoutes["POST /google-drive"];
      const req = makeReq({
        body: Buffer.from(""),
        headers: {
          "x-goog-resource-id": "resource-123",
          "x-goog-resource-state": "update",
          "x-goog-resource-uri": "https://www.googleapis.com/drive/v3/files/myFileId123",
        },
      });
      const reply = makeReply();
      await handler(req, reply);
      await Promise.resolve();
      expect(processWebhookEvent).toHaveBeenCalledWith(
        "google_drive",
        expect.objectContaining({ entityId: "myFileId123" }),
      );
    });

    it("returns 401 when token is set and wrong channel token provided", async () => {
      envModule.env.GOOGLE_DRIVE_WEBHOOK_TOKEN = "drive-token";
      const { handler } = registeredRoutes["POST /google-drive"];
      const req = makeReq({
        body: Buffer.from(""),
        headers: {
          "x-goog-channel-token": "wrong-drive-token",
          "x-goog-resource-id": "res-1",
          "x-goog-resource-state": "change",
        },
      });
      const reply = makeReply();
      await handler(req, reply);
      expect(reply.code).toHaveBeenCalledWith(401);
      expect(reply.send).toHaveBeenCalledWith({ error: "Invalid token" });
    });
  });
});
