import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/lib/logger.js", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { fastifyOrgIsolation, fastifyRequireOrg } from "../../src/middleware/orgIsolation.js";
import logger from "../../src/lib/logger.js";

function createRequest(overrides: any = {}): any {
  return {
    url: "/test",
    method: "GET",
    ...overrides,
  };
}

function createReply(): any {
  const reply: any = {
    statusCode: 200,
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

describe("fastifyOrgIsolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sets orgId to userId when userId is present", async () => {
    const request = createRequest({ userId: 42 });
    const reply = createReply();
    await fastifyOrgIsolation(request, reply);
    expect(request.orgId).toBe(42);
  });

  it("does nothing when userId is absent", async () => {
    const request = createRequest({});
    const reply = createReply();
    await fastifyOrgIsolation(request, reply);
    expect(request.orgId).toBeUndefined();
  });

  it("does nothing when userId is 0 (falsy)", async () => {
    const request = createRequest({ userId: 0 });
    const reply = createReply();
    await fastifyOrgIsolation(request, reply);
    expect(request.orgId).toBeUndefined();
  });
});

describe("fastifyRequireOrg", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 403 when orgId is missing", async () => {
    const request = createRequest({ userId: 1, url: "/api/test" });
    const reply = createReply();
    await fastifyRequireOrg(request, reply);
    expect(reply.code).toHaveBeenCalledWith(403);
    expect(reply.send).toHaveBeenCalledWith({ error: "Organization context required" });
    expect(logger.warn).toHaveBeenCalled();
  });

  it("allows through when orgId is present", async () => {
    const request = createRequest({ userId: 1, orgId: 1 });
    const reply = createReply();
    await fastifyRequireOrg(request, reply);
    expect(reply.code).not.toHaveBeenCalled();
    expect(reply.send).not.toHaveBeenCalled();
  });

  it("logs userId and url when blocking", async () => {
    const request = createRequest({ userId: 99, url: "/api/data" });
    const reply = createReply();
    await fastifyRequireOrg(request, reply);
    expect(logger.warn).toHaveBeenCalledWith(
      { userId: 99, url: "/api/data" },
      "Request without org context"
    );
  });
});
