import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/middleware/fastifyAuth.js", () => ({
  fastifyRequireAuth: vi.fn(),
  fastifyRequireAdmin: vi.fn(),
}));

vi.mock("../../src/services/webScraping.service.js", () => ({
  scrapeUrl: vi.fn().mockResolvedValue({ url: "https://example.com", content: "page content", title: "Example" }),
  firecrawlCrawl: vi.fn().mockResolvedValue([
    { url: "https://example.com", content: "page 1" },
    { url: "https://example.com/about", content: "page 2" },
  ]),
  exaSearch: vi.fn().mockResolvedValue([
    { url: "https://exa.com/result", title: "Exa Result", text: "content" },
  ]),
  exaGetContents: vi.fn().mockResolvedValue([
    { url: "https://example.com", text: "extracted content" },
  ]),
  listAvailableScrapingProviders: vi.fn().mockReturnValue(["firecrawl", "native"]),
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

import webScrapingPlugin from "../../src/routes/webScraping.js";
import {
  scrapeUrl,
  firecrawlCrawl,
  exaSearch,
  exaGetContents,
  listAvailableScrapingProviders,
} from "../../src/services/webScraping.service.js";

describe("webScraping routes", () => {
  let fastify: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    Object.keys(registeredRoutes).forEach((k) => delete registeredRoutes[k]);
    fastify = createFastifyInstance();
    await webScrapingPlugin(fastify);
  });

  describe("GET /providers", () => {
    it("registers GET /providers route", () => {
      expect(registeredRoutes["GET /providers"]).toBeDefined();
    });

    it("returns list of available scraping providers", async () => {
      const handler = registeredRoutes["GET /providers"].handler;
      const req = makeReq();
      const reply = makeReply();

      await handler(req, reply);

      expect(reply.send).toHaveBeenCalledWith({ providers: ["firecrawl", "native"] });
    });

    it("calls listAvailableScrapingProviders", async () => {
      const handler = registeredRoutes["GET /providers"].handler;
      await handler(makeReq(), makeReply());
      expect(listAvailableScrapingProviders).toHaveBeenCalled();
    });
  });

  describe("POST /scrape", () => {
    it("registers POST /scrape route", () => {
      expect(registeredRoutes["POST /scrape"]).toBeDefined();
    });

    it("scrapes a valid URL and returns result", async () => {
      const handler = registeredRoutes["POST /scrape"].handler;
      const req = makeReq({ body: { url: "https://example.com" } });
      const reply = makeReply();

      await handler(req, reply);

      expect(scrapeUrl).toHaveBeenCalledWith("https://example.com");
      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({ url: "https://example.com", content: "page content" })
      );
    });

    it("passes the url from request body", async () => {
      const handler = registeredRoutes["POST /scrape"].handler;
      const req = makeReq({ body: { url: "https://custom-site.org/page" } });
      const reply = makeReply();

      await handler(req, reply);

      expect(scrapeUrl).toHaveBeenCalledWith("https://custom-site.org/page");
    });

    it("returns scrape result directly", async () => {
      const handler = registeredRoutes["POST /scrape"].handler;
      const req = makeReq({ body: { url: "https://example.com" } });
      const reply = makeReply();

      await handler(req, reply);

      const sentArg = (reply.send as any).mock.calls[0][0];
      expect(sentArg).toHaveProperty("content");
      expect(sentArg).toHaveProperty("title");
    });
  });

  describe("POST /crawl", () => {
    it("registers POST /crawl route", () => {
      expect(registeredRoutes["POST /crawl"]).toBeDefined();
    });

    it("crawls a URL and returns pages array", async () => {
      const handler = registeredRoutes["POST /crawl"].handler;
      const req = makeReq({ body: { url: "https://example.com" } });
      const reply = makeReply();

      await handler(req, reply);

      expect(firecrawlCrawl).toHaveBeenCalledWith(
        expect.objectContaining({ url: "https://example.com" })
      );
      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({ pages: expect.any(Array), count: 2 })
      );
    });

    it("passes maxPages and maxDepth options", async () => {
      const handler = registeredRoutes["POST /crawl"].handler;
      const req = makeReq({ body: { url: "https://example.com", maxPages: 20, maxDepth: 3 } });
      const reply = makeReply();

      await handler(req, reply);

      expect(firecrawlCrawl).toHaveBeenCalledWith(
        expect.objectContaining({ maxPages: 20, maxDepth: 3 })
      );
    });

    it("returns count matching pages length", async () => {
      const handler = registeredRoutes["POST /crawl"].handler;
      const req = makeReq({ body: { url: "https://example.com" } });
      const reply = makeReply();

      await handler(req, reply);

      const sentArg = (reply.send as any).mock.calls[0][0];
      expect(sentArg.count).toBe(sentArg.pages.length);
    });
  });

  describe("POST /exa/search", () => {
    it("registers POST /exa/search route", () => {
      expect(registeredRoutes["POST /exa/search"]).toBeDefined();
    });

    it("performs exa search with valid query", async () => {
      const handler = registeredRoutes["POST /exa/search"].handler;
      const req = makeReq({ body: { query: "machine learning" } });
      const reply = makeReply();

      await handler(req, reply);

      expect(exaSearch).toHaveBeenCalledWith(
        expect.objectContaining({ query: "machine learning" })
      );
    });

    it("returns results with count", async () => {
      const handler = registeredRoutes["POST /exa/search"].handler;
      const req = makeReq({ body: { query: "AI research" } });
      const reply = makeReply();

      await handler(req, reply);

      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({ results: expect.any(Array), count: 1 })
      );
    });

    it("passes all options to exaSearch", async () => {
      const handler = registeredRoutes["POST /exa/search"].handler;
      const req = makeReq({
        body: {
          query: "test",
          numResults: 5,
          type: "neural",
          useAutoprompt: false,
          includeContent: true,
        },
      });
      const reply = makeReply();

      await handler(req, reply);

      expect(exaSearch).toHaveBeenCalledWith(
        expect.objectContaining({
          numResults: 5,
          type: "neural",
          useAutoprompt: false,
          includeContent: true,
        })
      );
    });
  });

  describe("POST /exa/contents", () => {
    it("registers POST /exa/contents route", () => {
      expect(registeredRoutes["POST /exa/contents"]).toBeDefined();
    });

    it("fetches contents for provided URLs", async () => {
      const handler = registeredRoutes["POST /exa/contents"].handler;
      const urls = ["https://example.com", "https://another.com"];
      const req = makeReq({ body: { urls } });
      const reply = makeReply();

      await handler(req, reply);

      expect(exaGetContents).toHaveBeenCalledWith(urls);
    });

    it("returns results with count", async () => {
      const handler = registeredRoutes["POST /exa/contents"].handler;
      const req = makeReq({ body: { urls: ["https://example.com"] } });
      const reply = makeReply();

      await handler(req, reply);

      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({ results: expect.any(Array), count: 1 })
      );
    });

    it("count matches results length", async () => {
      const handler = registeredRoutes["POST /exa/contents"].handler;
      const req = makeReq({ body: { urls: ["https://example.com"] } });
      const reply = makeReply();

      await handler(req, reply);

      const sentArg = (reply.send as any).mock.calls[0][0];
      expect(sentArg.count).toBe(sentArg.results.length);
    });
  });
});
