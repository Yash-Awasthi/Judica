import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/middleware/fastifyAuth.js", () => ({
  fastifyRequireAuth: vi.fn(),
  fastifyRequireAdmin: vi.fn(),
}));

vi.mock("../../src/adapters/objectStorage.adapter.js", () => ({
  objectStorage: {
    upload: vi.fn().mockResolvedValue("https://cdn/key"),
    getSignedUrl: vi.fn().mockResolvedValue("https://cdn/signed"),
    delete: vi.fn().mockResolvedValue(undefined),
    listKeys: vi.fn().mockResolvedValue(["key1", "key2"]),
  },
}));

vi.mock("../../src/middleware/errorHandler.js", () => ({
  AppError: class AppError extends Error {
    statusCode: number;
    constructor(statusCode: number, message: string) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

vi.mock("../../src/lib/logger.js", () => ({
  default: { info: vi.fn() },
}));

vi.mock("@fastify/multipart", () => ({ default: vi.fn() }));

vi.mock("crypto", () => ({
  randomUUID: vi.fn().mockReturnValue("mock-uuid"),
  default: { randomUUID: vi.fn().mockReturnValue("mock-uuid") },
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
    register: vi.fn((plugin: any, opts: any, cb?: Function) => {
      if (cb) cb();
    }),
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

import storagePlugin from "../../src/routes/storage.js";
import { objectStorage } from "../../src/adapters/objectStorage.adapter.js";
import { AppError } from "../../src/middleware/errorHandler.js";

describe("storage routes", () => {
  let fastify: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    Object.keys(registeredRoutes).forEach((k) => delete registeredRoutes[k]);
    fastify = createFastifyInstance();
    // storagePlugin calls fastify.register(multipart) internally
    // We need to directly set up route handlers after registration
    await storagePlugin(fastify);
  });

  describe("POST /upload", () => {
    it("registers POST /upload route", () => {
      expect(registeredRoutes["POST /upload"]).toBeDefined();
    });

    it("uploads file and returns key and url", async () => {
      const handler = registeredRoutes["POST /upload"].handler;
      const mockFileStream = {
        [Symbol.asyncIterator]: async function* () {
          yield Buffer.from("file content");
        },
        truncated: false,
      };
      const req = makeReq({
        userId: 42,
        file: vi.fn().mockResolvedValue({
          filename: "test.txt",
          mimetype: "text/plain",
          file: mockFileStream,
        }),
      });
      const reply = makeReply();

      const result = await handler(req, reply);

      expect(objectStorage.upload).toHaveBeenCalled();
      expect(reply.code).toHaveBeenCalledWith(201);
    });

    it("throws 400 when no file is provided", async () => {
      const handler = registeredRoutes["POST /upload"].handler;
      const req = makeReq({
        file: vi.fn().mockResolvedValue(null),
      });
      const reply = makeReply();

      await expect(handler(req, reply)).rejects.toThrow();
    });

    it("generates a unique key for the uploaded file", async () => {
      const handler = registeredRoutes["POST /upload"].handler;
      const mockFileStream = {
        [Symbol.asyncIterator]: async function* () {
          yield Buffer.from("data");
        },
        truncated: false,
      };
      const req = makeReq({
        userId: 5,
        file: vi.fn().mockResolvedValue({
          filename: "image.png",
          mimetype: "image/png",
          file: mockFileStream,
        }),
      });
      const reply = makeReply();

      await handler(req, reply);

      const [key] = (objectStorage.upload as any).mock.calls[0];
      expect(key).toContain("uploads/5/");
      expect(key).toContain(".png");
    });

    it("throws 413 when file is truncated", async () => {
      const handler = registeredRoutes["POST /upload"].handler;
      const mockFileStream = {
        [Symbol.asyncIterator]: async function* () {
          yield Buffer.from("too big data");
        },
        truncated: true,
      };
      const req = makeReq({
        file: vi.fn().mockResolvedValue({
          filename: "big.bin",
          mimetype: "application/octet-stream",
          file: mockFileStream,
        }),
      });
      const reply = makeReply();

      await expect(handler(req, reply)).rejects.toThrow();
    });
  });

  describe("GET /url/:key", () => {
    it("registers GET /url/:key route", () => {
      expect(registeredRoutes["GET /url/:key"]).toBeDefined();
    });

    it("returns signed URL for a valid key", async () => {
      const handler = registeredRoutes["GET /url/:key"].handler;
      const req = makeReq({ params: { key: "uploads/1/abc.png" }, query: {} });
      const reply = makeReply();

      const result = await handler(req, reply);

      expect(objectStorage.getSignedUrl).toHaveBeenCalledWith("uploads/1/abc.png", expect.any(Number));
      expect(result).toMatchObject({ key: "uploads/1/abc.png", url: "https://cdn/signed" });
    });

    it("throws 400 when key is empty", async () => {
      const handler = registeredRoutes["GET /url/:key"].handler;
      const req = makeReq({ params: { key: "   " }, query: {} });
      const reply = makeReply();

      await expect(handler(req, reply)).rejects.toThrow();
    });

    it("uses default expiry of 3600 seconds", async () => {
      const handler = registeredRoutes["GET /url/:key"].handler;
      const req = makeReq({ params: { key: "somekey" }, query: {} });
      const reply = makeReply();

      const result = await handler(req, reply);

      expect(result.expiresIn).toBe(3600);
    });

    it("uses custom expiry from query param", async () => {
      const handler = registeredRoutes["GET /url/:key"].handler;
      const req = makeReq({ params: { key: "somekey" }, query: { expiry: "7200" } });
      const reply = makeReply();

      const result = await handler(req, reply);

      expect(result.expiresIn).toBe(7200);
    });

    it("clamps expiry to minimum 60 seconds", async () => {
      const handler = registeredRoutes["GET /url/:key"].handler;
      const req = makeReq({ params: { key: "somekey" }, query: { expiry: "10" } });
      const reply = makeReply();

      const result = await handler(req, reply);

      expect(result.expiresIn).toBe(60);
    });

    it("clamps expiry to maximum 86400 seconds", async () => {
      const handler = registeredRoutes["GET /url/:key"].handler;
      const req = makeReq({ params: { key: "somekey" }, query: { expiry: "99999" } });
      const reply = makeReply();

      const result = await handler(req, reply);

      expect(result.expiresIn).toBe(86400);
    });
  });

  describe("DELETE /:key", () => {
    it("registers DELETE /:key route", () => {
      expect(registeredRoutes["DELETE /:key"]).toBeDefined();
    });

    it("deletes file and returns 204", async () => {
      const handler = registeredRoutes["DELETE /:key"].handler;
      const req = makeReq({ params: { key: "uploads/1/test.png" } });
      const reply = makeReply();

      await handler(req, reply);

      expect(objectStorage.delete).toHaveBeenCalledWith("uploads/1/test.png");
      expect(reply.code).toHaveBeenCalledWith(204);
    });

    it("throws 400 when key is empty", async () => {
      const handler = registeredRoutes["DELETE /:key"].handler;
      const req = makeReq({ params: { key: "  " } });
      const reply = makeReply();

      await expect(handler(req, reply)).rejects.toThrow();
    });
  });

  describe("GET /list", () => {
    it("registers GET /list route", () => {
      expect(registeredRoutes["GET /list"]).toBeDefined();
    });

    it("returns keys, count, and prefix", async () => {
      const handler = registeredRoutes["GET /list"].handler;
      const req = makeReq({ query: {} });
      const reply = makeReply();

      const result = await handler(req, reply);

      expect(result).toMatchObject({
        keys: ["key1", "key2"],
        count: 2,
        prefix: "",
      });
    });

    it("passes prefix to listKeys", async () => {
      const handler = registeredRoutes["GET /list"].handler;
      const req = makeReq({ query: { prefix: "uploads/5/" } });
      const reply = makeReply();

      await handler(req, reply);

      expect(objectStorage.listKeys).toHaveBeenCalledWith("uploads/5/");
    });

    it("returns correct count matching keys length", async () => {
      const handler = registeredRoutes["GET /list"].handler;
      const req = makeReq({ query: {} });
      const reply = makeReply();

      const result = await handler(req, reply);

      expect(result.count).toBe(result.keys.length);
    });
  });
});
