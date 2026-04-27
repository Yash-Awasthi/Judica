import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/middleware/fastifyAuth.js", () => ({
  fastifyRequireAuth: vi.fn(),
  fastifyRequireAdmin: vi.fn(),
}));

vi.mock("../../src/services/webSearch.service.js", () => ({
  webSearch: vi.fn().mockResolvedValue([
    { title: "t", url: "u", content: "c", score: 0.9 },
  ]),
  listAvailableSearchProviders: vi.fn().mockReturnValue(["tavily"]),
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
  r.status = vi.fn(() => r);
  return r;
}

import webSearchPlugin from "../../src/routes/webSearch.js";
import {
  webSearch,
  listAvailableSearchProviders,
} from "../../src/services/webSearch.service.js";

describe("webSearch routes", () => {
  let fastify: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    Object.keys(registeredRoutes).forEach((k) => delete registeredRoutes[k]);
    fastify = createFastifyInstance();
    await webSearchPlugin(fastify);
  });

  describe("GET /providers", () => {
    it("registers GET /providers route", () => {
      expect(registeredRoutes["GET /providers"]).toBeDefined();
    });

    it("returns providers list and preferred", async () => {
      const handler = registeredRoutes["GET /providers"].handler;
      const req = makeReq();
      const reply = makeReply();

      await handler(req, reply);

      expect(reply.send).toHaveBeenCalledWith({
        providers: ["tavily"],
        preferred: null,
      });
    });

    it("calls listAvailableSearchProviders", async () => {
      const handler = registeredRoutes["GET /providers"].handler;
      const req = makeReq();
      const reply = makeReply();

      await handler(req, reply);

      expect(listAvailableSearchProviders).toHaveBeenCalled();
    });

    it("returns preferred from env variable if set", async () => {
      process.env.WEB_SEARCH_PROVIDER = "brave";
      const handler = registeredRoutes["GET /providers"].handler;
      const req = makeReq();
      const reply = makeReply();

      await handler(req, reply);

      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({ preferred: "brave" })
      );
      delete process.env.WEB_SEARCH_PROVIDER;
    });
  });

  describe("POST /", () => {
    it("registers POST / route", () => {
      expect(registeredRoutes["POST /"]).toBeDefined();
    });

    it("returns results array for valid query", async () => {
      const handler = registeredRoutes["POST /"].handler;
      const req = makeReq({ body: { query: "test query" } });
      const reply = makeReply();

      await handler(req, reply);

      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          results: [{ title: "t", url: "u", content: "c", score: 0.9 }],
        })
      );
    });

    it("calls webSearch with the query", async () => {
      const handler = registeredRoutes["POST /"].handler;
      const req = makeReq({ body: { query: "hello world" } });
      const reply = makeReply();

      await handler(req, reply);

      expect(webSearch).toHaveBeenCalledWith(
        expect.objectContaining({ query: "hello world" })
      );
    });

    it("returns provider field in response", async () => {
      const handler = registeredRoutes["POST /"].handler;
      const req = makeReq({ body: { query: "test" } });
      const reply = makeReply();

      await handler(req, reply);

      const sentArg = (reply.send as any).mock.calls[0][0];
      expect(sentArg).toHaveProperty("provider");
    });

    it("uses provider from request body when specified", async () => {
      const handler = registeredRoutes["POST /"].handler;
      const req = makeReq({
        body: { query: "test", provider: "serpapi" },
      });
      const reply = makeReply();

      await handler(req, reply);

      expect(webSearch).toHaveBeenCalledWith(
        expect.objectContaining({ provider: "serpapi" })
      );
      const sentArg = (reply.send as any).mock.calls[0][0];
      expect(sentArg.provider).toBe("serpapi");
    });

    it("passes maxResults and depth to webSearch", async () => {
      const handler = registeredRoutes["POST /"].handler;
      const req = makeReq({
        body: { query: "test", maxResults: 10, depth: "advanced" },
      });
      const reply = makeReply();

      await handler(req, reply);

      expect(webSearch).toHaveBeenCalledWith(
        expect.objectContaining({ maxResults: 10, depth: "advanced" })
      );
    });

    it("falls back to available providers when no provider given", async () => {
      delete process.env.WEB_SEARCH_PROVIDER;
      const handler = registeredRoutes["POST /"].handler;
      const req = makeReq({ body: { query: "test" } });
      const reply = makeReply();

      await handler(req, reply);

      const sentArg = (reply.send as any).mock.calls[0][0];
      expect(["tavily", "none"]).toContain(sentArg.provider);
    });
  });
});
